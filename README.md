# Enterprise AI Assistant (Phases 1-3)

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
