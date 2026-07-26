# Custom domain for Grok Assistant (Netlify)

Production site (default): **https://jocular-starship-2a6c4a.netlify.app**

## Add your domain

### Option A — Netlify UI (recommended)

1. Open [Netlify → jocular-starship-2a6c4a → Domain management](https://app.netlify.com/projects/jocular-starship-2a6c4a/domain-management)
2. **Add a domain** → enter e.g. `chat.yourdomain.com` or `yourdomain.com`
3. Netlify shows DNS records. At your DNS host (Cloudflare, Namecheap, etc.):

| Type | Name | Value |
|------|------|--------|
| **A** (apex) | `@` | Netlify load balancer IP shown in UI |
| **CNAME** (subdomain) | `chat` (or `www`) | `jocular-starship-2a6c4a.netlify.app` |

4. Wait for DNS (often 5–30 min). Netlify auto-provisions HTTPS (Let's Encrypt).

### Option B — Netlify CLI

```bash
npx netlify-cli login
npx netlify-cli link   # site: jocular-starship-2a6c4a
npx netlify-cli domains:add chat.yourdomain.com
```

Then add the DNS records Netlify prints.

## Checklist

- [ ] Domain owned and DNS editable
- [ ] Domain added on Netlify
- [ ] A / CNAME records correct
- [ ] HTTPS certificate **Issued** in Netlify
- [ ] (Optional) Force HTTPS + primary domain set

## Notes

- Do **not** put `XAI_API_KEY` on the client; domain only fronts the same Netlify functions.
- Apex (`example.com`) usually needs **A** records; subdomains use **CNAME**.
- Cloudflare: set the record to **DNS only** (grey cloud) if SSL loops; or Full (strict) once cert exists.
