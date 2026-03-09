import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const port = process.env.PORT || 4000;
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const apiKey = process.env.OPENAI_API_KEY;

const openai = apiKey ? new OpenAI({ apiKey }) : null;

app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'enterprise-ai-assistant-server' });
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

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
