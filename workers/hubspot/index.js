/**
 * AMP Agency — HubSpot API Proxy
 * Cloudflare Worker
 *
 * Proxies CRM deal requests to HubSpot, filtered by
 * the marketing_channel_ashton custom deal property.
 *
 * Note: HubSpot Private App tokens CAN be called directly
 * from the browser (no secret needed server-side), so this
 * worker is optional — use it if you want to keep tokens
 * server-side or add caching.
 *
 * Required environment variables:
 *   ALLOWED_ORIGIN    — your GitHub Pages URL
 *   HUBSPOT_TOKEN     — Private App token (if server-side)
 *                       OR pass per-request via x-access-token
 */

const HS_API_BASE = 'https://api.hubapi.com';

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

    const url  = new URL(request.url);
    const path = url.pathname;

    // Token: env var (server-side) or per-request header
    const token = env.HUBSPOT_TOKEN || request.headers.get('x-access-token');
    if (!token) return json({ error: 'No HubSpot token provided' }, 401, corsHeaders);

    try {
      if (path === '/leads')      return await getLeads(request, env, token, corsHeaders);
      if (path === '/lead-stats') return await getLeadStats(request, env, token, corsHeaders);
      return json({ error: 'Not found' }, 404, corsHeaders);
    } catch (e) {
      return json({ error: e.message }, 500, corsHeaders);
    }
  }
};

/**
 * GET /leads?limit=50&after=cursor
 *
 * Returns deals where marketing_channel_ashton is set.
 * Includes associated contact (first name, email, phone).
 */
async function getLeads(request, env, token, corsHeaders) {
  const url   = new URL(request.url);
  const limit = url.searchParams.get('limit') || '50';
  const after = url.searchParams.get('after') || '';

  // Properties to fetch on each deal
  const dealProps = [
    'dealname', 'dealstage', 'amount', 'closedate', 'createdate',
    'marketing_channel_ashton', 'hs_object_id', 'pipeline',
    'service_interest'           // custom property — add if you have it
  ].join(',');

  // Search for deals where marketing_channel_ashton is set (HAS_PROPERTY)
  const searchBody = {
    filterGroups: [{
      filters: [{
        propertyName: 'marketing_channel_ashton',
        operator: 'HAS_PROPERTY'
      }]
    }],
    properties: dealProps.split(','),
    limit: Number(limit),
    sorts: [{ propertyName: 'createdate', direction: 'DESCENDING' }],
    ...(after ? { after } : {})
  };

  const dealsResp = await fetch(`${HS_API_BASE}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(searchBody)
  });

  const dealsData = await dealsResp.json();
  if (!dealsResp.ok) return json({ error: dealsData.message || 'HubSpot API error', details: dealsData }, dealsResp.status, corsHeaders);

  const deals = dealsData.results || [];

  // Batch-fetch associated contacts for all deals
  const dealIds = deals.map(d => d.id);
  let contactMap = {};

  if (dealIds.length > 0) {
    const assocResp = await fetch(
      `${HS_API_BASE}/crm/v3/associations/deals/contacts/batch/read`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: dealIds.map(id => ({ id })) })
      }
    );

    if (assocResp.ok) {
      const assocData = await assocResp.json();
      const contactIds = [];
      const dealToContact = {};

      (assocData.results || []).forEach(r => {
        const contactId = r.to?.[0]?.id;
        if (contactId) {
          dealToContact[r.from.id] = contactId;
          contactIds.push(contactId);
        }
      });

      // Fetch contact details
      if (contactIds.length > 0) {
        const contactsResp = await fetch(
          `${HS_API_BASE}/crm/v3/objects/contacts/batch/read`,
          {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              inputs: contactIds.map(id => ({ id })),
              properties: ['firstname', 'lastname', 'email', 'phone']
            })
          }
        );

        if (contactsResp.ok) {
          const contactsData = await contactsResp.json();
          (contactsData.results || []).forEach(c => {
            contactMap[c.id] = c.properties;
          });
        }
      }

      // Attach contact info to deals
      deals.forEach(deal => {
        const cId = dealToContact[deal.id];
        deal._contact = cId ? contactMap[cId] : null;
      });
    }
  }

  // Normalize output for the dashboard
  const normalized = deals.map(d => {
    const p = d.properties;
    const c = d._contact;
    const firstName = c?.firstname || '';
    const lastName  = c?.lastname  || '';
    const fullName  = [firstName, lastName].filter(Boolean).join(' ') || p.dealname || 'Unknown';

    // Mask email and phone for privacy
    const email = c?.email || '';
    const maskedEmail = email
      ? email.charAt(0) + '***@' + email.split('@')[1]
      : '—';

    const phone = c?.phone || '';
    const maskedPhone = phone.length > 4
      ? phone.slice(0, -4).replace(/\d/g, '*') + phone.slice(-4)
      : phone || '—';

    return {
      id:                        d.id,
      name:                      fullName,
      email:                     maskedEmail,
      phone:                     maskedPhone,
      deal_stage:                p.dealstage || '—',
      amount:                    p.amount ? Number(p.amount) : 0,
      marketing_channel_ashton:  p.marketing_channel_ashton || '—',
      close_date:                p.closedate ? p.closedate.split('T')[0] : null,
      created_date:              p.createdate ? p.createdate.split('T')[0] : null,
      service_interest:          p.service_interest || '—',
      pipeline:                  p.pipeline || '—',
    };
  });

  return json({
    total:   dealsData.total || normalized.length,
    paging:  dealsData.paging || null,
    deals:   normalized,
  }, 200, corsHeaders);
}

/**
 * GET /lead-stats
 *
 * Returns aggregated channel breakdown and deal stage counts.
 */
async function getLeadStats(request, env, token, corsHeaders) {
  // Use the same search but get all deals for aggregation
  const searchBody = {
    filterGroups: [{ filters: [{ propertyName: 'marketing_channel_ashton', operator: 'HAS_PROPERTY' }] }],
    properties: ['dealstage', 'amount', 'marketing_channel_ashton', 'createdate'],
    limit: 200,
  };

  const resp = await fetch(`${HS_API_BASE}/crm/v3/objects/deals/search`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(searchBody)
  });

  const data = await resp.json();
  if (!resp.ok) return json({ error: data.message }, resp.status, corsHeaders);

  const deals = data.results || [];

  // Aggregate by channel
  const channelMap = {};
  const stageMap   = {};

  deals.forEach(d => {
    const ch    = d.properties.marketing_channel_ashton || 'Unknown';
    const stage = d.properties.dealstage || 'Unknown';
    const amt   = Number(d.properties.amount || 0);

    if (!channelMap[ch]) channelMap[ch] = { count: 0, value: 0 };
    channelMap[ch].count++;
    channelMap[ch].value += amt;

    if (!stageMap[stage]) stageMap[stage] = { count: 0, value: 0 };
    stageMap[stage].count++;
    stageMap[stage].value += amt;
  });

  const channel_breakdown = Object.entries(channelMap)
    .map(([channel, v]) => ({ channel, ...v }))
    .sort((a, b) => b.count - a.count);

  const stage_breakdown = Object.entries(stageMap)
    .map(([stage, v]) => ({ stage, ...v }))
    .sort((a, b) => b.count - a.count);

  return json({ total: data.total, channel_breakdown, stage_breakdown }, 200, corsHeaders);
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  });
}
