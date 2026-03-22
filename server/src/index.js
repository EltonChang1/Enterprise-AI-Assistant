import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import { createServer } from 'http';
import multer from 'multer';
import OpenAI from 'openai';
import { WebSocketServer } from 'ws';
import { agentTools, executeToolCall } from './agents.js';
import {
  createDatabase,
  findUserByToken,
  getOrgChunks,
  getOrgKnowledgeSummary,
  insertChatLog,
  insertDocumentWithChunks
} from './db.js';

dotenv.config();

console.log('[Init] Starting Enterprise AI Assistant...');

const app = express();
const port = process.env.PORT || 4000;
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const apiKey = process.env.OPENAI_API_KEY;
const jsonBodyLimit = process.env.MAX_JSON_BODY || '1mb';
const uploadFileSizeBytes = Number(process.env.MAX_UPLOAD_BYTES || 2 * 1024 * 1024);
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const allowedUploadMimeTypes = new Set([
  'text/plain',
  'text/markdown',
  'application/json',
  'text/csv'
]);
const allowedMessageRoles = new Set(['system', 'user', 'assistant']);

console.log('[Init] Creating database...');
const db = createDatabase();
console.log('[Init] Database ready');
const openai = apiKey ? new OpenAI({ apiKey }) : null;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: uploadFileSizeBytes,
    files: 1
  },
  fileFilter: (_req, file, cb) => {
    if (allowedUploadMimeTypes.has(file.mimetype)) {
      cb(null, true);
      return;
    }
    cb(new Error('unsupported file type; use .txt, .md, .json, or .csv'));
  }
});
console.log('[Init] Middleware configured');

app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error('origin not allowed'));
    }
  })
);
app.use(express.json({ limit: jsonBodyLimit }));

function createRateLimiter({ windowMs, maxRequests }) {
  const hits = new Map();

  return (req, res, next) => {
    const key = extractToken(req) || req.ip || 'anonymous';
    const now = Date.now();
    const record = hits.get(key) || { count: 0, resetAt: now + windowMs };

    if (now > record.resetAt) {
      record.count = 0;
      record.resetAt = now + windowMs;
    }

    record.count += 1;
    hits.set(key, record);

    if (record.count > maxRequests) {
      const retryAfterSeconds = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(429).json({
        error: 'rate limit exceeded',
        retryAfterSeconds
      });
    }

    return next();
  };
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return 'messages array is required';
  }

  if (messages.length > 30) {
    return 'messages array is too large (max 30)';
  }

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      return 'each message must be an object';
    }
    if (!allowedMessageRoles.has(message.role)) {
      return 'message role must be one of system, user, assistant';
    }
    if (typeof message.content !== 'string' || message.content.trim().length === 0) {
      return 'message content must be a non-empty string';
    }
    if (message.content.length > 8000) {
      return 'message content exceeds max length (8000 characters)';
    }
  }

  return null;
}

function parseTopK(topKValue, fallback = 4) {
  const parsed = Number(topKValue);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(8, Math.max(1, Math.floor(parsed)));
}

const apiRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: Number(process.env.API_RATE_LIMIT_PER_MINUTE || 120)
});
const chatRateLimiter = createRateLimiter({
  windowMs: 60_000,
  maxRequests: Number(process.env.CHAT_RATE_LIMIT_PER_MINUTE || 30)
});

app.use('/api', apiRateLimiter);
app.use('/api/chat', chatRateLimiter);

function normalizeText(text) {
  return (text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
}

function tokenize(text) {
  return normalizeText(text)
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function termVector(tokens) {
  const map = new Map();
  for (const token of tokens) {
    map.set(token, (map.get(token) || 0) + 1);
  }
  return map;
}

function cosineSimilarity(a, b) {
  if (!a || !b || !a.length || !b.length || a.length !== b.length) {
    return 0;
  }

  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function lexicalSimilarity(query, chunkText) {
  const qMap = termVector(tokenize(query));
  const cMap = termVector(tokenize(chunkText));
  const qTerms = [...qMap.keys()];
  if (!qTerms.length) return 0;
  let overlap = 0;
  for (const term of qTerms) {
    if (cMap.has(term)) overlap += Math.min(qMap.get(term), cMap.get(term));
  }
  return overlap / qTerms.length;
}

function splitIntoChunks(text, maxLength = 1200, overlap = 180) {
  const clean = (text || '').replace(/\r/g, '').trim();
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + maxLength, clean.length);
    const value = clean.slice(start, end).trim();
    if (value) chunks.push(value);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

async function createEmbedding(text) {
  if (!openai) return null;
  const response = await openai.embeddings.create({
    model: embeddingModel,
    input: text
  });
  return response.data?.[0]?.embedding || null;
}

function extractToken(req) {
  const bearer = req.headers.authorization;
  if (bearer && bearer.toLowerCase().startsWith('bearer ')) {
    return bearer.slice(7).trim();
  }
  return req.headers['x-api-token'];
}

function authenticate(req, res, next) {
  const token = extractToken(req);
  if (!token) {
    return res.status(401).json({ error: 'missing authentication token' });
  }

  const user = findUserByToken(db, token);
  if (!user) {
    return res.status(401).json({ error: 'invalid authentication token' });
  }

  req.auth = user;
  return next();
}

function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.auth) {
      return res.status(401).json({ error: 'not authenticated' });
    }
    if (!allowedRoles.includes(req.auth.role)) {
      return res.status(403).json({ error: 'insufficient role permissions' });
    }
    return next();
  };
}

async function retrieveContextForOrg(orgId, query, topK = 4) {
  const rawChunks = getOrgChunks(db, orgId);
  if (!rawChunks.length) return [];

  const chunks = rawChunks.map((chunk) => ({
    ...chunk,
    embedding: chunk.embeddingJson ? JSON.parse(chunk.embeddingJson) : null
  }));

  const queryEmbedding = openai ? await createEmbedding(query) : null;

  return chunks
    .map((chunk) => {
      const lexical = lexicalSimilarity(query, chunk.text);
      const semantic = queryEmbedding && chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : 0;
      const score = semantic > 0 ? semantic * 0.8 + lexical * 0.2 : lexical;
      return {
        ...chunk,
        score
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

app.get('/api/health', (_req, res) => {
  const orgSummary = db.prepare('SELECT COUNT(*) as count FROM organizations').get();
  const userSummary = db.prepare('SELECT COUNT(*) as count FROM users').get();

  res.json({
    status: 'ok',
    service: 'enterprise-ai-assistant-server',
    phase: 4,
    organizations: orgSummary.count,
    users: userSummary.count,
    features: ['auth', 'rag', 'websocket', 'agents', 'analytics']
  });
});

app.get('/api/me', authenticate, (req, res) => {
  res.json({
    user: {
      id: req.auth.id,
      name: req.auth.name,
      email: req.auth.email,
      role: req.auth.role,
      orgId: req.auth.orgId,
      orgName: req.auth.orgName,
      orgSlug: req.auth.orgSlug
    }
  });
});

app.get('/api/knowledge', authenticate, (req, res) => {
  const summary = getOrgKnowledgeSummary(db, req.auth.orgId);
  res.json(summary);
});

app.post('/api/knowledge/upload', authenticate, requireRoles('admin', 'user'), upload.single('document'), async (req, res) => {
  const file = req.file;
  if (!file) {
    return res.status(400).json({ error: 'document file is required' });
  }

  try {
    const text = file.buffer.toString('utf-8');
    const chunks = splitIntoChunks(text);

    if (!chunks.length) {
      return res.status(400).json({ error: 'uploaded document had no readable text' });
    }

    const preparedChunks = [];
    for (const chunkText of chunks) {
      const embedding = await createEmbedding(chunkText);
      preparedChunks.push({
        text: chunkText,
        embeddingJson: embedding ? JSON.stringify(embedding) : null
      });
    }

    insertDocumentWithChunks(db, {
      orgId: req.auth.orgId,
      source: file.originalname,
      userId: req.auth.id,
      chunks: preparedChunks
    });

    const summary = getOrgKnowledgeSummary(db, req.auth.orgId);

    return res.json({
      message: 'document indexed',
      source: file.originalname,
      chunksAdded: preparedChunks.length,
      chunksIndexed: summary.chunksIndexed,
      mode: openai ? 'embedding' : 'lexical-fallback',
      org: req.auth.orgSlug
    });
  } catch (error) {
    return res.status(500).json({
      error: 'failed to index document',
      details: error?.message || 'unknown error'
    });
  }
});

app.post('/api/chat', authenticate, async (req, res) => {
  const { messages = [] } = req.body;
  const validationError = validateMessages(messages);
  if (validationError) return res.status(400).json({ error: validationError });

  const userLast = [...messages].reverse().find((m) => m.role === 'user');

  try {
    if (!openai) {
      const responseText =
        "OPENAI_API_KEY is not configured yet. This is a local fallback response. You said: " +
        (userLast?.content || '');

      insertChatLog(db, {
        orgId: req.auth.orgId,
        userId: req.auth.id,
        mode: 'chat',
        question: userLast?.content,
        answer: responseText
      });

      return res.json({
        message: responseText,
        provider: 'mock',
        org: req.auth.orgSlug
      });
    }

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            `You are an enterprise AI assistant for ${req.auth.orgName}. Give concise, accurate, business-friendly answers and cite uncertainty clearly.`
        },
        ...messages
      ],
      temperature: 0.3
    });

    const answer = completion.choices?.[0]?.message?.content || 'No response returned.';

    insertChatLog(db, {
      orgId: req.auth.orgId,
      userId: req.auth.id,
      mode: 'chat',
      question: userLast?.content,
      answer
    });

    return res.json({
      message: answer,
      provider: 'openai',
      model,
      org: req.auth.orgSlug
    });
  } catch (error) {
    return res.status(500).json({
      error: 'chat request failed',
      details: error?.message || 'unknown error'
    });
  }
});

app.post('/api/chat/rag', authenticate, async (req, res) => {
  const { messages = [] } = req.body;
  const topK = parseTopK(req.body?.topK, 4);
  const validationError = validateMessages(messages);
  if (validationError) return res.status(400).json({ error: validationError });

  const userLast = [...messages].reverse().find((m) => m.role === 'user');
  const query = userLast?.content || '';

  try {
    const contextChunks = await retrieveContextForOrg(req.auth.orgId, query, topK);
    const contextText = contextChunks
      .map(
        (chunk, index) =>
          `[Doc ${index + 1} | ${chunk.source}]\n${chunk.text.slice(0, 900)}`
      )
      .join('\n\n');

    if (!openai) {
      const responseText =
        `RAG fallback mode active for org ${req.auth.orgSlug}. I found ${contextChunks.length} matching chunks. ` +
        `Top source: ${contextChunks[0]?.source || 'none'}. ` +
        `Your question: ${query}`;

      insertChatLog(db, {
        orgId: req.auth.orgId,
        userId: req.auth.id,
        mode: 'rag',
        question: query,
        answer: responseText
      });

      return res.json({
        message: responseText,
        provider: 'mock-rag',
        org: req.auth.orgSlug,
        contextUsed: contextChunks.map((c) => ({ source: c.source, score: Number(c.score.toFixed(4)) }))
      });
    }

    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            `You are an enterprise assistant for ${req.auth.orgName}. Answer using the provided context first. If context is insufficient, explicitly say what is missing.`
        },
        {
          role: 'system',
          content: `Knowledge context:\n${contextText || 'No indexed context available.'}`
        },
        ...messages
      ]
    });

    const answer = completion.choices?.[0]?.message?.content || 'No response returned.';

    insertChatLog(db, {
      orgId: req.auth.orgId,
      userId: req.auth.id,
      mode: 'rag',
      question: query,
      answer
    });

    return res.json({
      message: answer,
      provider: 'openai-rag',
      model,
      org: req.auth.orgSlug,
      contextUsed: contextChunks.map((c) => ({ source: c.source, score: Number(c.score.toFixed(4)) }))
    });
  } catch (error) {
    return res.status(500).json({
      error: 'rag chat request failed',
      details: error?.message || 'unknown error'
    });
  }
});

// Analytics endpoints
app.get('/api/analytics/overview', authenticate, requireRoles('admin'), (req, res) => {
  const totalChats = db
    .prepare('SELECT COUNT(*) as count FROM chat_logs WHERE org_id = ?')
    .get(req.auth.orgId).count;

  const totalDocs = db
    .prepare('SELECT COUNT(*) as count FROM documents WHERE org_id = ?')
    .get(req.auth.orgId).count;

  const totalChunks = db
    .prepare('SELECT COUNT(*) as count FROM knowledge_chunks WHERE org_id = ?')
    .get(req.auth.orgId).count;

  const ragChats = db
    .prepare('SELECT COUNT(*) as count FROM chat_logs WHERE org_id = ? AND mode = ?')
    .get(req.auth.orgId, 'rag').count;

  const recentChats = db
    .prepare(
      `SELECT mode, COUNT(*) as count
       FROM chat_logs
       WHERE org_id = ? AND created_at > datetime('now', '-7 days')
       GROUP BY mode`
    )
    .all(req.auth.orgId);

  res.json({
    totalChats,
    totalDocuments: totalDocs,
    totalChunks,
    ragChats,
    regularChats: totalChats - ragChats,
    recentActivity: recentChats
  });
});

// Agent chat with tool calling
app.post('/api/chat/agent', authenticate, async (req, res) => {
  const { messages = [] } = req.body;
  const validationError = validateMessages(messages);
  if (validationError) return res.status(400).json({ error: validationError });

  const userLast = [...messages].reverse().find((m) => m.role === 'user');

  try {
    if (!openai) {
      return res.json({
        message: 'Agent mode requires OPENAI_API_KEY configuration.',
        provider: 'mock-agent',
        toolCalls: []
      });
    }

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            `You are an intelligent agent for ${req.auth.orgName}. You can use tools to help answer questions. Be concise and professional.`
        },
        ...messages
      ],
      tools: agentTools,
      temperature: 0.3
    });

    const responseMessage = completion.choices?.[0]?.message;
    const toolCalls = responseMessage?.tool_calls || [];
    const toolResults = [];

    if (toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        const toolArgs = JSON.parse(toolCall.function.arguments);
        const result = await executeToolCall(toolName, toolArgs, {
          db,
          retrieveContextForOrg,
          orgId: req.auth.orgId
        });
        toolResults.push({
          tool: toolName,
          arguments: toolArgs,
          result
        });
      }

      const secondCompletion = await openai.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content:
              `You are an intelligent agent for ${req.auth.orgName}. You can use tools to help answer questions. Be concise and professional.`
          },
          ...messages,
          responseMessage,
          ...toolCalls.map((tc, idx) => ({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(toolResults[idx].result)
          }))
        ],
        temperature: 0.3
      });

      const finalAnswer = secondCompletion.choices?.[0]?.message?.content || 'No response.';

      insertChatLog(db, {
        orgId: req.auth.orgId,
        userId: req.auth.id,
        mode: 'agent',
        question: userLast?.content,
        answer: finalAnswer
      });

      return res.json({
        message: finalAnswer,
        provider: 'openai-agent',
        model,
        toolCalls: toolResults
      });
    }

    const answer = responseMessage?.content || 'No response returned.';

    insertChatLog(db, {
      orgId: req.auth.orgId,
      userId: req.auth.id,
      mode: 'agent',
      question: userLast?.content,
      answer
    });

    return res.json({
      message: answer,
      provider: 'openai-agent',
      model,
      toolCalls: []
    });
  } catch (error) {
    return res.status(500).json({
      error: 'agent chat request failed',
      details: error?.message || 'unknown error'
    });
  }
});

// HTTP server with WebSocket support
const server = createServer(app);
const wss = new WebSocketServer({ server });

console.log('[Init] WebSocket configured');

wss.on('connection', (ws) => {
  let authenticated = false;
  let userAuth = null;

  ws.on('message', async (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());

      if (data.type === 'auth') {
        const user = findUserByToken(db, data.token);
        if (!user) {
          ws.send(JSON.stringify({ type: 'error', message: 'invalid token' }));
          ws.close();
          return;
        }
        authenticated = true;
        userAuth = user;
        ws.send(JSON.stringify({ type: 'auth_success', user: { name: user.name, role: user.role } }));
        return;
      }

      if (!authenticated) {
        ws.send(JSON.stringify({ type: 'error', message: 'not authenticated' }));
        return;
      }

      if (data.type === 'chat_stream') {
        const { messages = [], mode = 'chat' } = data;
        const validationError = validateMessages(messages);
        if (validationError) {
          ws.send(JSON.stringify({ type: 'error', message: validationError }));
          return;
        }
        if (!['chat', 'rag'].includes(mode)) {
          ws.send(JSON.stringify({ type: 'error', message: 'invalid stream mode' }));
          return;
        }

        if (!openai) {
          ws.send(
            JSON.stringify({
              type: 'chunk',
              content: 'Streaming requires OPENAI_API_KEY configuration.'
            })
          );
          ws.send(JSON.stringify({ type: 'done' }));
          return;
        }

        let systemPrompt = `You are an enterprise AI assistant for ${userAuth.orgName}.`;
        let contextText = '';

        if (mode === 'rag') {
          const userLast = [...messages].reverse().find((m) => m.role === 'user');
          const query = userLast?.content || '';
          const contextChunks = await retrieveContextForOrg(userAuth.orgId, query, 4);
          contextText = contextChunks
            .map((c, i) => `[Doc ${i + 1} | ${c.source}]\n${c.text.slice(0, 700)}`)
            .join('\n\n');
          systemPrompt +=
            ' Answer using the provided context first. If context is insufficient, explicitly say what is missing.';
        }

        const stream = await openai.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...(contextText ? [{ role: 'system', content: `Knowledge context:\n${contextText}` }] : []),
            ...messages
          ],
          temperature: mode === 'rag' ? 0.2 : 0.3,
          stream: true
        });

        let fullResponse = '';

        for await (const chunk of stream) {
          const content = chunk.choices?.[0]?.delta?.content || '';
          if (content) {
            fullResponse += content;
            ws.send(JSON.stringify({ type: 'chunk', content }));
          }
        }

        insertChatLog(db, {
          orgId: userAuth.orgId,
          userId: userAuth.id,
          mode,
          question: messages[messages.length - 1]?.content,
          answer: fullResponse
        });

        ws.send(JSON.stringify({ type: 'done' }));
      }
    } catch (error) {
      ws.send(JSON.stringify({ type: 'error', message: error.message }));
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

app.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `file exceeds ${uploadFileSizeBytes} byte limit`
      });
    }
    return res.status(400).json({ error: error.message });
  }

  if (error?.message === 'origin not allowed') {
    return res.status(403).json({ error: 'origin not allowed' });
  }

  if (error) {
    return res.status(500).json({
      error: 'internal server error',
      details: error.message
    });
  }

  return next();
});

server.listen(port, () => {
  console.log(`[Ready] Server running on http://localhost:${port}`);
  console.log('[Ready] WebSocket endpoint: ws://localhost:' + port);
  console.log('[Ready] Seed tokens: acme-admin-token, acme-user-token, acme-viewer-token');
});
