/**
 * AMP Agency — Google Ads API Proxy
 * Cloudflare Worker
 *
 * Accepts requests from the dashboard, attaches the developer token
 * from environment variables, and proxies to the Google Ads API.
 *
 * Required environment variables (set in Cloudflare Dashboard):
 *   GOOGLE_DEVELOPER_TOKEN  — from your Google Ads MCC > API Center
 *   ALLOWED_ORIGIN          — your GitHub Pages URL, e.g. https://ampagency.github.io
 */

const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com/v17';

export default {
  async fetch(request, env) {

    // ── CORS ──────────────────────────────────────────
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-access-token',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // ── ROUTING ───────────────────────────────────────
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/campaigns') return await getCampaigns(request, env, corsHeaders);
      if (path === '/campaign-stats') return await getCampaignStats(request, env, corsHeaders);
      return json({ error: 'Not found' }, 404, corsHeaders);
    } catch (e) {
      return json({ error: e.message }, 500, corsHeaders);
    }
  }
};

/**
 * GET /campaigns
 * Headers: Authorization: Bearer {oauth_access_token}
 * Query:   customer_id=123-456-7890
 *
 * Returns all active/paused campaigns for the customer.
 */
async function getCampaigns(request, env, corsHeaders) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get('customer_id')?.replace(/-/g, '');
  const accessToken = request.headers.get('x-access-token');

  if (!customerId || !accessToken) {
    return json({ error: 'Missing customer_id or access token' }, 400, corsHeaders);
  }

  // Google Ads Query Language (GAQL)
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.ctr,
      metrics.average_cpc,
      metrics.cost_micros,
      metrics.conversions,
      metrics.cost_per_conversion
    FROM campaign
    WHERE campaign.status IN ('ENABLED', 'PAUSED')
      AND segments.date DURING LAST_30_DAYS
    ORDER BY metrics.cost_micros DESC
  `;

  const response = await fetch(
    `${GOOGLE_ADS_API_BASE}/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': env.GOOGLE_DEVELOPER_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    return json({ error: data.error?.message || 'Google Ads API error', details: data }, response.status, corsHeaders);
  }

  // Normalize response for the dashboard
  const campaigns = (data.results || []).map(r => ({
    id:                   r.campaign.id,
    name:                 r.campaign.name,
    status:               r.campaign.status,
    type:                 r.campaign.advertisingChannelType,
    budget_daily:         (r.campaignBudget?.amountMicros || 0) / 1_000_000,
    impressions:          Number(r.metrics.impressions || 0),
    clicks:               Number(r.metrics.clicks || 0),
    ctr:                  Number(r.metrics.ctr || 0) * 100,
    avg_cpc:              Number(r.metrics.averageCpc || 0) / 1_000_000,
    cost:                 Number(r.metrics.costMicros || 0) / 1_000_000,
    conversions:          Number(r.metrics.conversions || 0),
    cost_per_conversion:  Number(r.metrics.costPerConversion || 0) / 1_000_000,
  }));

  const totals = campaigns.reduce((acc, c) => ({
    impressions:          acc.impressions + c.impressions,
    clicks:               acc.clicks + c.clicks,
    cost:                 acc.cost + c.cost,
    conversions:          acc.conversions + c.conversions,
    cost_per_conversion:  campaigns.length ? campaigns.reduce((s,x)=>s+x.cost_per_conversion,0)/campaigns.length : 0,
  }), { impressions:0, clicks:0, cost:0, conversions:0, cost_per_conversion:0 });

  return json({ campaigns, totals }, 200, corsHeaders);
}

/**
 * GET /campaign-stats
 * Returns day-by-day spend for the chart overlay (last 30 days)
 */
async function getCampaignStats(request, env, corsHeaders) {
  const url = new URL(request.url);
  const customerId = url.searchParams.get('customer_id')?.replace(/-/g, '');
  const accessToken = request.headers.get('x-access-token');

  if (!customerId || !accessToken) {
    return json({ error: 'Missing parameters' }, 400, corsHeaders);
  }

  const query = `
    SELECT
      segments.date,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions
    FROM customer
    WHERE segments.date DURING LAST_30_DAYS
    ORDER BY segments.date ASC
  `;

  const response = await fetch(
    `${GOOGLE_ADS_API_BASE}/customers/${customerId}/googleAds:search`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'developer-token': env.GOOGLE_DEVELOPER_TOKEN,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query })
    }
  );

  const data = await response.json();
  if (!response.ok) return json({ error: data.error?.message }, response.status, corsHeaders);

  const daily = (data.results || []).map(r => ({
    date:        r.segments.date,
    cost:        Number(r.metrics.costMicros || 0) / 1_000_000,
    impressions: Number(r.metrics.impressions || 0),
    clicks:      Number(r.metrics.clicks || 0),
    conversions: Number(r.metrics.conversions || 0),
  }));

  return json({ daily }, 200, corsHeaders);
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}
