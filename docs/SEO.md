# SEO checklist — Grok Assistant

## Live URLs
- Primary: https://grok-assistant.com/ (when DNS is live)
- Netlify: https://jocular-starship-2a6c4a.netlify.app/

## Implemented
- [x] Title + meta description + keywords
- [x] Canonical + hreflang
- [x] Open Graph + Twitter cards + `og.jpg`
- [x] `robots.txt` + `sitemap.xml`
- [x] JSON-LD (`WebSite`, `SoftwareApplication`, `FAQPage`, `Organization`)
- [x] Crawlable `#seo-landing` content in `index.html` (hidden after React boots)
- [x] Favicon + web manifest
- [x] Semantic H1 in empty state
- [x] Cache headers for assets / OG / robots / sitemap

## After DNS for grok-assistant.com
1. Google Search Console → add property `https://grok-assistant.com`
2. Submit sitemap: `https://grok-assistant.com/sitemap.xml`
3. Bing Webmaster Tools → same sitemap
4. Confirm OG preview: [opengraph.xyz](https://www.opengraph.xyz/) or Twitter card validator
5. Request indexing for `/`

## Content tips to rank higher
- Keep a unique, benefit-led title under ~60 characters of primary keywords
- Blog / changelog posts (if you add a `/blog` later) beat a pure SPA for long-tail
- Earn backlinks (Product Hunt, X, indie hacker posts)
- Core Web Vitals: keep main bundle lean; fonts already `display=swap`

## Honest limits of SPA SEO
Google can render JS, but **static HTML + JSON-LD + sitemap** still help.  
For competitive SERPs, add prerender or a few static marketing pages later.
