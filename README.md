# AMP Practice Portal

Client-facing marketing dashboard for AMP Agency practices. Shows budget tracking, live ad performance (Google Ads + Meta Ads), lead data from HubSpot, and ad creative.

## Structure

```
amp-practice-portal/
├── index.html                  # The dashboard (single file, deploy as-is)
├── workers/
│   ├── google-ads/
│   │   ├── index.js            # Cloudflare Worker — Google Ads API proxy
│   │   └── wrangler.toml       # Worker config
│   ├── meta-ads/
│   │   ├── index.js            # Cloudflare Worker — Meta Marketing API proxy
│   │   └── wrangler.toml       # Worker config
│   └── hubspot/
│       ├── index.js            # Cloudflare Worker — HubSpot API proxy (optional)
│       └── wrangler.toml       # Worker config
└── .github/
    └── workflows/
        └── deploy.yml          # Auto-deploy index.html to GitHub Pages on push
```

## Deployment

### 1. GitHub Pages (the dashboard)

Push to `main` — GitHub Actions deploys `index.html` automatically to:
`https://[your-org].github.io/amp-practice-portal`

### 2. Cloudflare Workers (API proxies)

Each worker lives in its own folder. Deploy independently:

```bash
cd workers/google-ads
npm install
npx wrangler deploy
```

Repeat for `meta-ads` and `hubspot`.

### 3. Connect workers to the dashboard

Once deployed, update these constants at the top of `index.html`:

```js
const GOOGLE_PROXY_URL = 'https://google-ads-proxy.YOUR-SUBDOMAIN.workers.dev';
const META_PROXY_URL   = 'https://meta-ads-proxy.YOUR-SUBDOMAIN.workers.dev';
const HUBSPOT_PROXY_URL = 'https://hubspot-proxy.YOUR-SUBDOMAIN.workers.dev'; // optional
```

## API Credentials

Store all secrets in Cloudflare Workers environment variables — never in the repo.

| Secret | Where to set |
|--------|-------------|
| `GOOGLE_DEVELOPER_TOKEN` | Cloudflare Dashboard → Workers → google-ads-proxy → Settings → Variables |
| `GOOGLE_CLIENT_ID` | Same |
| `GOOGLE_CLIENT_SECRET` | Same |
| `META_APP_SECRET` | Cloudflare Dashboard → meta-ads-proxy → Settings → Variables |

User-provided tokens (OAuth access tokens, HubSpot private app tokens) are passed per-request from the dashboard — they are never stored server-side.

## Local Development

```bash
# Serve the dashboard locally
npx serve . 
# or just open index.html in a browser — no build step needed

# Test a worker locally
cd workers/google-ads
npx wrangler dev
```
