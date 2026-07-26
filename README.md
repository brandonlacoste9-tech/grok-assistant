# Grok Assistant

A clean personal AI chat app powered by **xAI Grok**.  
Built for **Netlify** (static frontend + serverless API) so your API key never ships to the browser.

## Stack

- **Vite + React + TypeScript** — UI
- **Netlify Functions** — `/api/chat` → xAI `chat/completions`
- **Local Vite middleware** — same API path during `npm run dev`
- Dark, Grok-style UI · chat history in `localStorage`

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
- Free-form chat only for now — easy to extend (streaming, tools, auth).
