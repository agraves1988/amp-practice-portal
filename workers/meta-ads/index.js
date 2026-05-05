/**
 * AMP Agency — Meta Marketing API Proxy
 * Cloudflare Worker
 *
 * Proxies requests to Meta's Marketing API v18.
 * Handles campaigns, ad sets, ads, and creative (thumbnails).
 *
 * Required environment variables:
 *   META_APP_ID       — from developers.facebook.com
 *   META_APP_SECRET   — from developers.facebook.com
 *   ALLOWED_ORIGIN    — your GitHub Pages URL
 *
 * User access token is passed per-request in x-access-token header.
 */

const META_API_BASE = 'https://graph.facebook.com/v18.0';

export default {
  async fetch(request, env) {

    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-access-token',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === '/campaigns')  return await getCampaigns(request, env, corsHeaders);
      if (path === '/ads')        return await getAds(request, env, corsHeaders);
      if (path === '/creatives')  return await getCreatives(request, env, corsHeaders);
      return json({ error: 'Not found' }, 404, corsHeaders);
    } catch (e) {
      return json({ error: e.message }, 500, corsHeaders);
    }
  }
};

/**
 * GET /campaigns?account_id=act_xxxxxxxxxx
 *
 * Returns campaigns with 30-day insights.
 */
async function getCampaigns(request, env, corsHeaders) {
  const url = new URL(request.url);
  const accountId  = url.searchParams.get('account_id');
  const accessToken = request.headers.get('x-access-token');

  if (!accountId || !accessToken) {
    return json({ error: 'Missing account_id or access token' }, 400, corsHeaders);
  }

  const fields = [
    'id', 'name', 'status', 'objective', 'daily_budget',
    'insights.action_attribution_windows(["28d_click","1d_view"]){impressions,reach,clicks,ctr,cpc,spend,actions,cost_per_action_type,frequency}'
  ].join(',');

  const response = await fetch(
    `${META_API_BASE}/${accountId}/campaigns?fields=${fields}&date_preset=last_30d&access_token=${accessToken}`
  );

  const data = await response.json();
  if (!response.ok || data.error) {
    return json({ error: data.error?.message || 'Meta API error' }, response.status, corsHeaders);
  }

  const campaigns = (data.data || []).map(c => {
    const ins = c.insights?.data?.[0] || {};
    const leadAction = (ins.actions || []).find(a => a.action_type === 'lead');
    const leads = leadAction ? Number(leadAction.value) : 0;
    const spend = Number(ins.spend || 0);

    return {
      id:             c.id,
      name:           c.name,
      status:         c.status,
      objective:      c.objective,
      daily_budget:   Number(c.daily_budget || 0) / 100,
      impressions:    Number(ins.impressions || 0),
      reach:          Number(ins.reach || 0),
      clicks:         Number(ins.clicks || 0),
      ctr:            Number(ins.ctr || 0),
      cpc:            Number(ins.cpc || 0),
      spend,
      leads,
      cost_per_lead:  leads > 0 ? spend / leads : 0,
      frequency:      Number(ins.frequency || 0),
    };
  });

  const totals = campaigns.reduce((acc, c) => ({
    impressions:    acc.impressions + c.impressions,
    reach:          acc.reach + c.reach,
    clicks:         acc.clicks + c.clicks,
    spend:          acc.spend + c.spend,
    leads:          acc.leads + c.leads,
    cost_per_lead:  0, // calculated below
  }), { impressions:0, reach:0, clicks:0, spend:0, leads:0, cost_per_lead:0 });

  totals.cost_per_lead = totals.leads > 0 ? totals.spend / totals.leads : 0;

  return json({ campaigns, totals }, 200, corsHeaders);
}

/**
 * GET /ads?account_id=act_xxxxxxxxxx
 *
 * Returns individual ads with insights and creative references.
 */
async function getAds(request, env, corsHeaders) {
  const url = new URL(request.url);
  const accountId   = url.searchParams.get('account_id');
  const accessToken = request.headers.get('x-access-token');

  if (!accountId || !accessToken) {
    return json({ error: 'Missing parameters' }, 400, corsHeaders);
  }

  const fields = [
    'id', 'name', 'status', 'campaign_id',
    'creative{id,name,title,body,call_to_action_type,image_url,thumbnail_url,video_id,asset_feed_spec}',
    'insights.action_attribution_windows(["28d_click"]){impressions,clicks,spend,ctr,actions}'
  ].join(',');

  const response = await fetch(
    `${META_API_BASE}/${accountId}/ads?fields=${fields}&date_preset=last_30d&limit=20&access_token=${accessToken}`
  );

  const data = await response.json();
  if (!response.ok || data.error) {
    return json({ error: data.error?.message }, response.status, corsHeaders);
  }

  const ads = (data.data || []).map(ad => {
    const ins      = ad.insights?.data?.[0] || {};
    const creative = ad.creative || {};
    const leadAction = (ins.actions || []).find(a => a.action_type === 'lead');
    const leads = leadAction ? Number(leadAction.value) : 0;
    const spend = Number(ins.spend || 0);

    // Detect format from creative
    let format = 'Single Image';
    if (creative.video_id) format = 'Video';
    if (creative.asset_feed_spec?.videos?.length > 0) format = 'Video';
    if ((creative.asset_feed_spec?.images?.length || 0) > 1) format = 'Carousel';

    return {
      id:            ad.id,
      ad_name:       ad.name,
      campaign_id:   ad.campaign_id,
      status:        ad.status,
      format,
      headline:      creative.title || '',
      primary_text:  creative.body || '',
      cta:           (creative.call_to_action_type || 'LEARN_MORE').replace(/_/g, ' '),
      thumbnail_url: creative.thumbnail_url || creative.image_url || null,
      impressions:   Number(ins.impressions || 0),
      clicks:        Number(ins.clicks || 0),
      ctr:           Number(ins.ctr || 0),
      spend,
      leads,
      cost_per_lead: leads > 0 ? spend / leads : 0,
    };
  });

  return json({ ads }, 200, corsHeaders);
}

/**
 * GET /creatives?creative_id=xxxx
 *
 * Fetches full creative details including image/video thumbnail.
 * Called per-creative when you need the actual thumbnail URL.
 */
async function getCreatives(request, env, corsHeaders) {
  const url = new URL(request.url);
  const creativeId  = url.searchParams.get('creative_id');
  const accessToken = request.headers.get('x-access-token');

  if (!creativeId || !accessToken) {
    return json({ error: 'Missing parameters' }, 400, corsHeaders);
  }

  const fields = 'id,name,title,body,call_to_action_type,image_url,thumbnail_url,object_story_spec';
  const response = await fetch(
    `${META_API_BASE}/${creativeId}?fields=${fields}&access_token=${accessToken}`
  );

  const data = await response.json();
  if (!response.ok || data.error) {
    return json({ error: data.error?.message }, response.status, corsHeaders);
  }

  return json(data, 200, corsHeaders);
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}
