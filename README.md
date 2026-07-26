# Grok Assistant

A clean personal AI chat app powered by **xAI Grok**.  
Built for **Netlify** (static frontend + serverless API) so your API key never ships to the browser.

## Stack

- **Vite + React + TypeScript** — UI
- **Netlify Functions** — chat + **Grok Voice**
  - `/api/chat` → Grok chat completions
  - `/api/tts` → Grok Text-to-Speech
  - `/api/stt` → Grok Speech-to-Text (mic)
- **Local Vite middleware** — same API paths during `npm run dev`
- Dark, Grok-style UI · chat history in `localStorage`
- **Multi-thread chats** — sidebar, rename, delete (localStorage)
- **Streaming text** — Grok replies token-by-token (SSE)
- **Vision** — attach JPG/PNG/WebP (or paste/drag) so Grok can see images
- **Tools** — optional **🔍 Search** (web_search + x_search via Responses API)
- **Imagine** — **✨** or prompts like “draw …” / `/imagine …` (Grok Imagine)
- **Voice**
  - **Live** — realtime speech-to-speech (`grok-voice-latest` WebSocket + ephemeral tokens)
  - Hold **🎙** — push-to-talk STT → chat → optional TTS
  - **🔊** — auto-speak text replies (TTS)
  - Voice picker: Eve / Ara / Rex / Sal / Leo
- **Memory** — “remember that…”, name, style, notes (local)
- **Auto-routing** — weather / Imagine / search / plan-my-day without hunting modes
- **Tasks** — “add task…”, “plan my day”, local todos
- **Reliability** — regenerate, edit & resend, stream retry
- **Backup** — export/import full JSON backup in Settings
- **Auth (Clerk)** — sign-in in the sidebar; chats/memory scoped per user on this device
- **Custom domain** — **grok-assistant.com** (Netlify); DNS in [docs/CUSTOM_DOMAIN.md](docs/CUSTOM_DOMAIN.md)

### Clerk env

```bash
# .env (local) / Netlify environment
VITE_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...   # server only, not required for SPA sign-in UI
```

In [Clerk Dashboard → Domains](https://dashboard.clerk.com/), allow:
- `http://localhost:5173`
- `https://jocular-starship-2a6c4a.netlify.app`
- `https://grok-assistant.com` (when DNS is live)

## Quick start (local)

```bash
cd grok-assistant
cp .env.example .env
# edit .env — set XAI_API_KEY from https://console.x.ai

npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

## Deploy to Netlify

1. Push this repo to GitHub.
2. Netlify → **Add new site** → import the repo.
3. Build settings (usually auto-detected from `netlify.toml`):
   - **Build command:** `npm run build`
   - **Publish directory:** `dist`
   - **Functions directory:** `netlify/functions`
4. **Site settings → Environment variables**
   - `XAI_API_KEY` = your key  
   - `XAI_MODEL` = `grok-4.3` (optional)
5. Deploy.

Or CLI:

```bash
npm i -g netlify-cli
netlify login
netlify init
netlify env:set XAI_API_KEY "xai-..."
netlify deploy --prod
```

## API

`POST /api/chat`

```json
{
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "temperature": 0.75,
  "max_tokens": 2048
}
```

Response:

```json
{
  "content": "…",
  "model": "grok-4.3",
  "usage": { }
}
```

## Project layout

```
src/                 React app
netlify/functions/   Production chat proxy
vite.config.ts       Dev /api/chat middleware
netlify.toml         Build + redirects
```

## Notes

- Do **not** put `XAI_API_KEY` in client code or commit `.env`.
- Chat, vision, search tools, Imagine, and Live voice are production-ready. Auth/accounts are a natural next step.
