# Custom domain for Grok Assistant (Netlify)

| Role | URL |
|------|-----|
| **Primary custom domain** | **https://grok-assistant.com** (assigned on Netlify) |
| **www** | **https://www.grok-assistant.com** (alias) |
| Netlify default | https://jocular-starship-2a6c4a.netlify.app |

## Status

- Netlify project **jocular-starship-2a6c4a** has `custom_domain = grok-assistant.com`.
- You still need to **register/buy** the domain (if not already) and point **DNS** at Netlify.
- HTTPS is issued automatically after DNS validates.

## 1. Buy the domain (if needed)

Register **grok-assistant.com** at Cloudflare, Namecheap, Porkbun, Google Domains, etc.

## 2. DNS records (external DNS)

In your registrar’s DNS panel:

| Type | Name | Value |
|------|------|--------|
| **A** | `@` | `75.2.60.5` (Netlify load balancer — confirm in UI if different) |
| **CNAME** | `www` | `jocular-starship-2a6c4a.netlify.app` |

**Or** use Netlify DNS: Domain management → configure Netlify DNS → set nameservers at the registrar to what Netlify shows.

## 3. Netlify UI

1. Open [Domain management](https://app.netlify.com/projects/jocular-starship-2a6c4a/domain-management)
2. Confirm **grok-assistant.com** is primary
3. Wait until SSL shows **Issued** / HTTPS works
4. Optional: **Force HTTPS** + redirect `www` → apex (or the reverse)

## 4. Checklist

- [ ] Domain purchased
- [ ] DNS A + CNAME (or Netlify nameservers) set
- [ ] https://grok-assistant.com loads the app
- [ ] https://www.grok-assistant.com works
- [ ] Certificate issued (padlock)

## Notes

- Do **not** put `XAI_API_KEY` on the client.
- Cloudflare proxy: start with **DNS only** (grey cloud), then Full (strict) once cert exists.
- Brand note: “Grok” is an xAI trademark — fine for a personal project; be careful with public commercial use.
