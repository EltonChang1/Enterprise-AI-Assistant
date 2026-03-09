# Enterprise AI Assistant (Phases 1-4)

Phase 1 goal: ship a working enterprise assistant baseline with:
- React chat UI
- Express chat API
- Optional OpenAI integration
- Local fallback response when `OPENAI_API_KEY` is not set

Phase 2 additions:
- Document upload endpoint for knowledge ingestion
- Chunk indexing for uploaded files
- Retrieval-Augmented Generation (RAG) chat mode
- Context trace display in UI

Phase 3 additions:
- Multi-tenant persistent storage with SQLite
- Token-based authentication
- Role-based access control (admin/user/viewer)
- Organization-scoped knowledge retrieval and chat logs

Phase 4 additions:
- WebSocket streaming for real-time token-by-token responses
- Agent tools with function calling (search_knowledge, calculate, get_current_time)
- Analytics dashboard for admins (chat logs, document stats, activity metrics)
- Multi-mode chat interface (Regular/RAG/Streaming/Agent)

## Project Structure

- `server/` - API service
- `web/` - Vite + React frontend

## Quick Start

1. Install dependencies

```bash
npm --prefix server install
npm --prefix web install
```

2. Configure environment

```bash
cp server/.env.example server/.env
```

Then add `OPENAI_API_KEY` in `server/.env` if you want real model responses.
`DB_PATH` defaults to `./data/enterprise_ai.db` and stores persistent tenant data.

3. Start backend

```bash
npm --prefix server run dev
```

4. Start frontend

```bash
npm --prefix web run dev
```

Frontend runs on `http://localhost:5174` and calls backend at `http://localhost:4000`.

## API Endpoints

- `GET /api/health`
- `GET /api/me` (auth required)
- `GET /api/knowledge` (auth required)
- `POST /api/knowledge/upload` (auth required, roles: admin/user, multipart form-data field: `document`)
- `POST /api/chat` (auth required)
- `POST /api/chat/rag` (auth required)
- `POST /api/chat/agent` (auth required, Phase 4 - agent with tools)
- `GET /api/analytics/overview` (auth required, role: admin, Phase 4)
- WebSocket at `ws://localhost:4000` (auth via JSON message, Phase 4)

Use bearer token auth header:

```bash
Authorization: Bearer <token>
```

Seeded demo tokens:
- `acme-admin-token`
- `acme-user-token`
- `acme-viewer-token`

Request body for `/api/chat`:

```json
{
  "messages": [
    { "role": "user", "content": "How can I automate onboarding?" }
  ]
}
```

Request body for `/api/chat/rag`:

```json
{
  "messages": [
    { "role": "user", "content": "Summarize our onboarding policy" }
  ],
  "topK": 4
}
```

Request body for `/api/chat/agent`:

```json
{
  "messages": [
    { "role": "user", "content": "What time is it?" }
  ]
}
```

WebSocket message for streaming:

```json
{
  "type": "auth",
  "token": "acme-admin-token"
}
```

```json
{
  "type": "chat_stream",
  "messages": [{ "role": "user", "content": "Hello" }],
  "mode": "chat"
}
```
