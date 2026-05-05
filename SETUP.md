# Getting Live — Step by Step

## Step 1: Create the GitHub repo and push (10 minutes)

```bash
# Clone or init
git clone https://github.com/YOUR-ORG/amp-practice-portal.git
# or
git init amp-practice-portal

cd amp-practice-portal

# Copy your dashboard file in as index.html
# Copy all files from this zip into the folder

git add .
git commit -m "Initial portal setup"
git push origin main
```

Then in GitHub:
- Go to **Settings → Pages**
- Source: **GitHub Actions**
- Done — it deploys on every push to `main`

Your URL: `https://YOUR-ORG.github.io/amp-practice-portal`

---

## Step 2: HubSpot — works immediately, no backend needed (30 minutes)

1. Go to **HubSpot → Settings → Integrations → Private Apps**
2. Click **Create a private app**
3. Name: `AMP Portal`
4. Scopes needed:
   - `crm.objects.deals.read`
   - `crm.objects.contacts.read`
5. Copy the token
6. Paste it into the Leads tab in the dashboard

That's it — HubSpot works direct from the browser.

**Make sure the `marketing_channel_ashton` property exists:**
- HubSpot → Settings → Properties → Deal Properties
- If it doesn't exist, create it: Field type = **Dropdown** or **Single-line text**

---

## Step 3: Meta Ads proxy (2–3 hours)

### Get your Meta credentials

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create an App → Business type
3. Add product: **Marketing API**
4. Go to **Business Manager → System Users**
5. Create a System User, assign your Ad Accounts, generate a token with `ads_read` permission
6. Copy the token (it's long-lived — 60 days, renewable)

### Deploy the worker

```bash
# Install Wrangler CLI (one time)
npm install -g wrangler
wrangler login

cd workers/meta-ads

# Set your secrets
wrangler secret put ALLOWED_ORIGIN
# enter: https://YOUR-ORG.github.io

wrangler secret put META_APP_ID
# enter your app ID

wrangler secret put META_APP_SECRET
# enter your app secret

# Deploy
wrangler deploy
```

You'll get a URL like: `https://amp-meta-ads-proxy.YOUR-SUBDOMAIN.workers.dev`

### Connect it to the dashboard

In `index.html`, find this line near the top of the `<script>` section and update:

```js
const META_PROXY_URL = 'https://amp-meta-ads-proxy.YOUR-SUBDOMAIN.workers.dev';
```

Then in `connectMeta()`, replace the `callClaude()` call with:

```js
const [campResp, adsResp] = await Promise.all([
  fetch(`${META_PROXY_URL}/campaigns?account_id=${accountId}`, {
    headers: { 'x-access-token': accessToken }
  }),
  fetch(`${META_PROXY_URL}/ads?account_id=${accountId}`, {
    headers: { 'x-access-token': accessToken }
  })
]);
const campData = await campResp.json();
const adsData  = await adsResp.json();
```

---

## Step 4: Google Ads proxy (half day — requires standard API access approval)

### Get credentials

1. Go to your **Google Ads MCC** → Admin → API Center
2. Apply for a Developer Token (basic access approved same day for testing; standard access takes 1–2 business days)
3. Go to [console.cloud.google.com](https://console.cloud.google.com)
4. Create a project → Enable **Google Ads API**
5. Create OAuth 2.0 credentials (Web Application type)
6. Add your GitHub Pages URL as an authorized redirect URI

### Deploy the worker

```bash
cd workers/google-ads

wrangler secret put GOOGLE_DEVELOPER_TOKEN
wrangler secret put ALLOWED_ORIGIN

wrangler deploy
```

### OAuth flow note

Google requires a proper OAuth flow for user tokens. The simplest approach for internal use:
- Use the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) to generate a refresh token manually
- Store the refresh token in the worker as a secret
- The worker exchanges it for access tokens automatically

For a proper login flow, add a `/auth` route to the worker that handles the Google OAuth redirect.

---

## Step 5: Update the dashboard to use real proxies

Once workers are deployed, update these constants in `index.html`:

```js
// Add these near the top of your <script> block
const GOOGLE_PROXY_URL  = 'https://amp-google-ads-proxy.YOUR-SUBDOMAIN.workers.dev';
const META_PROXY_URL    = 'https://amp-meta-ads-proxy.YOUR-SUBDOMAIN.workers.dev';
const HUBSPOT_PROXY_URL = 'https://amp-hubspot-proxy.YOUR-SUBDOMAIN.workers.dev'; // optional
```

Then replace the `callClaude()` calls in each connect function with `fetch()` calls to those URLs.

---

## Competitor ads (future)

The worker is already stubbed at `workers/competitor-ads/index.js`.
When you're ready, the Meta Ad Library endpoint is already written — just needs to be wired to a new Competitors tab in the dashboard.

For SEMrush data, you're already connected via MCP — we can query competitor display ads and spend estimates directly from Claude without any additional setup.
