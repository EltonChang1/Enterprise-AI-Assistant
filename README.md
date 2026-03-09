# Enterprise AI Assistant (Phase 1)

Phase 1 goal: ship a working enterprise assistant baseline with:
- React chat UI
- Express chat API
- Optional OpenAI integration
- Local fallback response when `OPENAI_API_KEY` is not set

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
- `POST /api/chat`

Request body for `/api/chat`:

```json
{
  "messages": [
    { "role": "user", "content": "How can I automate onboarding?" }
  ]
}
```
