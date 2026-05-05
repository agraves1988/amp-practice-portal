/**
 * AMP Agency — Competitor Ads Worker (STUB)
 * Cloudflare Worker
 *
 * FUTURE FEATURE — not yet active in the dashboard.
 *
 * Data sources planned:
 *
 * 1. META AD LIBRARY API (free, no special permissions)
 *    GET https://graph.facebook.com/v18.0/ads_archive
 *      ?search_terms={competitor_name}
 *      &ad_type=ALL
 *      &ad_reached_countries=['US']
 *      &fields=id,ad_creative_body,ad_creative_link_caption,ad_delivery_start_time,
 *              ad_delivery_stop_time,ad_snapshot_url,page_name,spend,impressions
 *      &access_token={any_valid_user_token}
 *
 *    Returns: active competitor ads, copy, spend ranges, run dates.
 *    No special API tier required — works with a basic user token.
 *
 * 2. SEMRUSH DISPLAY ADVERTISING API (via connected SEMrush MCP)
 *    - Competitor display/banner creative
 *    - Landing page destinations
 *    - Estimated spend and impression share
 *    - Available through SEMrush .Ads History and Display Advertising reports
 *
 * 3. GOOGLE ADS TRANSPARENCY CENTER (no API — scrape or manual)
 *    https://adstransparency.google.com
 *    Limited data, no official API.
 *
 * Implementation plan:
 *   - Add "Competitors" tab to dashboard
 *   - Input: competitor Facebook Page name or ID
 *   - Fetch from Meta Ad Library (this worker)
 *   - Render competitor creative cards (same UI as Meta creative grid)
 *   - Layer in SEMrush data via MCP for spend estimates
 */

const META_API_BASE = 'https://graph.facebook.com/v18.0';

export default {
  async fetch(request, env) {

    const corsHeaders = {
      'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, x-access-token',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    return json({ status: 'stub', message: 'Competitor ads worker not yet active. See comments for implementation plan.' }, 200, corsHeaders);
  }
};

/**
 * FUTURE: searchCompetitorAds
 *
 * GET /competitor-ads?page_name=CompetitorMedSpa&country=US
 */
async function searchCompetitorAds(request, env, corsHeaders) {
  const url         = new URL(request.url);
  const searchTerms = url.searchParams.get('page_name') || '';
  const country     = url.searchParams.get('country') || 'US';
  const accessToken = request.headers.get('x-access-token');

  const params = new URLSearchParams({
    search_terms: searchTerms,
    ad_type: 'ALL',
    ad_reached_countries: JSON.stringify([country]),
    fields: [
      'id',
      'page_name',
      'page_id',
      'ad_creative_body',
      'ad_creative_link_caption',
      'ad_creative_link_title',
      'ad_delivery_start_time',
      'ad_delivery_stop_time',
      'ad_snapshot_url',
      'spend',
      'impressions',
      'publisher_platforms',
    ].join(','),
    limit: '20',
    access_token: accessToken,
  });

  const response = await fetch(`${META_API_BASE}/ads_archive?${params}`);
  const data = await response.json();

  if (!response.ok || data.error) {
    return json({ error: data.error?.message || 'Meta Ad Library error' }, response.status, corsHeaders);
  }

  const ads = (data.data || []).map(ad => ({
    id:            ad.id,
    page_name:     ad.page_name,
    headline:      ad.ad_creative_link_title || '',
    body:          ad.ad_creative_body || '',
    caption:       ad.ad_creative_link_caption || '',
    snapshot_url:  ad.ad_snapshot_url || '',
    start_date:    ad.ad_delivery_start_time || '',
    end_date:      ad.ad_delivery_stop_time || null,
    spend_lower:   ad.spend?.lower_bound || 0,
    spend_upper:   ad.spend?.upper_bound || 0,
    impressions_lower: ad.impressions?.lower_bound || 0,
    platforms:     ad.publisher_platforms || [],
    is_active:     !ad.ad_delivery_stop_time,
  }));

  return json({ ads, total: data.paging?.cursors ? ads.length : ads.length }, 200, corsHeaders);
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}
