import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const embeddingModel = process.env.EMBEDDING_MODEL || 'text-embedding-3-small';
const apiKey = process.env.OPENAI_API_KEY;

const openai = apiKey ? new OpenAI({ apiKey }) : null;
const upload = multer({ storage: multer.memoryStorage() });
const knowledgeChunks = [];
let nextChunkId = 1;

app.use(cors());
app.use(express.json());

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

async function retrieveContext(query, topK = 4) {
  if (!knowledgeChunks.length) return [];

  if (openai) {
    const queryEmbedding = await createEmbedding(query);
    if (!queryEmbedding) return [];
    return knowledgeChunks
      .map((chunk) => ({
        ...chunk,
        score: cosineSimilarity(queryEmbedding, chunk.embedding)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  return knowledgeChunks
    .map((chunk) => ({
      ...chunk,
      score: lexicalSimilarity(query, chunk.text)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'enterprise-ai-assistant-server',
    phase: 2,
    chunksIndexed: knowledgeChunks.length
  });
});

app.get('/api/knowledge', (_req, res) => {
  res.json({
    chunksIndexed: knowledgeChunks.length,
    sources: [...new Set(knowledgeChunks.map((chunk) => chunk.source))]
  });
});

app.post('/api/knowledge/upload', upload.single('document'), async (req, res) => {
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

    const created = [];
    for (const chunkText of chunks) {
      const embedding = await createEmbedding(chunkText);
      created.push({
        id: nextChunkId,
        source: file.originalname,
        text: chunkText,
        embedding
      });
      nextChunkId += 1;
    }

    knowledgeChunks.push(...created);

    return res.json({
      message: 'document indexed',
      source: file.originalname,
      chunksAdded: created.length,
      chunksIndexed: knowledgeChunks.length,
      mode: openai ? 'embedding' : 'lexical-fallback'
    });
  } catch (error) {
    return res.status(500).json({
      error: 'failed to index document',
      details: error?.message || 'unknown error'
    });
  }
});

app.post('/api/chat', async (req, res) => {
  const { messages = [] } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    if (!openai) {
      const userLast = [...messages].reverse().find((m) => m.role === 'user');
      return res.json({
        message:
          "OPENAI_API_KEY is not configured yet. This is a local fallback response. You said: " +
          (userLast?.content || ''),
        provider: 'mock'
      });
    }

    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content:
            'You are an enterprise AI assistant. Give concise, accurate, business-friendly answers and cite uncertainty clearly.'
        },
        ...messages
      ],
      temperature: 0.3
    });

    const answer = completion.choices?.[0]?.message?.content || 'No response returned.';

    return res.json({
      message: answer,
      provider: 'openai',
      model
    });
  } catch (error) {
    return res.status(500).json({
      error: 'chat request failed',
      details: error?.message || 'unknown error'
    });
  }
});

app.post('/api/chat/rag', async (req, res) => {
  const { messages = [], topK = 4 } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  const userLast = [...messages].reverse().find((m) => m.role === 'user');
  const query = userLast?.content || '';

  try {
    const contextChunks = await retrieveContext(query, topK);
    const contextText = contextChunks
      .map(
        (chunk, index) =>
          `[Doc ${index + 1} | ${chunk.source}]\n${chunk.text.slice(0, 900)}`
      )
      .join('\n\n');

    if (!openai) {
      return res.json({
        message:
          `RAG fallback mode active. I found ${contextChunks.length} matching chunks. ` +
          `Top source: ${contextChunks[0]?.source || 'none'}. ` +
          `Your question: ${query}`,
        provider: 'mock-rag',
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
            'You are an enterprise assistant. Answer using the provided context first. If context is insufficient, explicitly say what is missing.'
        },
        {
          role: 'system',
          content: `Knowledge context:\n${contextText || 'No indexed context available.'}`
        },
        ...messages
      ]
    });

    const answer = completion.choices?.[0]?.message?.content || 'No response returned.';

    return res.json({
      message: answer,
      provider: 'openai-rag',
      model,
      contextUsed: contextChunks.map((c) => ({ source: c.source, score: Number(c.score.toFixed(4)) }))
    });
  } catch (error) {
    return res.status(500).json({
      error: 'rag chat request failed',
      details: error?.message || 'unknown error'
    });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
