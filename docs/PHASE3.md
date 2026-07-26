# Phase 3 — Habit layer

## Shipped

### Morning briefing
- Triggers: “Morning briefing”, “Good morning”, “Brief me”, “Start my day”, “Catch me up”
- Pulls: weather (default city / geo), tasks, calendar, email drafts, memory
- Empty state CTA: **✦ Morning briefing**

### PWA
- `public/sw.js` — shell cache + offline homepage fallback
- `site.webmanifest` + icons
- **Install app** when the browser fires `beforeinstallprompt`
- iOS: Share → Add to Home Screen (hint in empty state)

### Domain polish
- Banner on `*.netlify.app` pointing to **grok-assistant.com**
- Canonical / sitemap already prefer custom domain

## After deploy
1. Confirm DNS for grok-assistant.com
2. Chrome → Install app (desktop) or mobile Add to Home Screen
3. Set default city in Settings → run Morning briefing

## Not in this phase
- Neon cloud sync
- Full Google/Outlook OAuth
