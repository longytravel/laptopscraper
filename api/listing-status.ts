import { classifyItemResponse } from '../src/laptop/live-status'

// Vercel function: is this eBay listing still for sale? Needs EBAY_CLIENT_ID
// and EBAY_CLIENT_SECRET in the Vercel project's environment variables. Each
// uncached call spends one Browse API call from the 5,000/day quota the
// collector also uses, so answers are cached at Vercel's edge per listing.

const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
let token: { value: string; expiresAt: number } | null = null

async function appToken(clientId: string, clientSecret: string): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope: 'https://api.ebay.com/oauth/api_scope' }),
  })
  if (!response.ok) throw new Error(`eBay token request returned HTTP ${response.status}`)
  const payload = await response.json() as { access_token: string; expires_in: number }
  token = { value: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 }
  return token.value
}

function reply(body: unknown, status: number, cache: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': cache },
  })
}

export async function GET(request: Request): Promise<Response> {
  const id = new URL(request.url).searchParams.get('id') ?? ''
  if (!/^v1\|\d+\|\d+$/.test(id)) return reply({ error: 'expected an eBay item id such as v1|123|0' }, 400, 'no-store')

  const clientId = process.env.EBAY_CLIENT_ID
  const clientSecret = process.env.EBAY_CLIENT_SECRET
  if (!clientId || !clientSecret) return reply({ error: 'live check not configured' }, 503, 'no-store')

  const checkedAt = new Date().toISOString()
  try {
    const response = await fetch(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(id)}?fieldgroups=COMPACT`, {
      headers: {
        Authorization: `Bearer ${await appToken(clientId, clientSecret)}`,
        'X-EBAY-C-MARKETPLACE-ID': process.env.EBAY_MARKETPLACE_ID || 'EBAY_GB',
      },
    })
    // Quota spent: tell the page to stop asking rather than fail listing by listing.
    if (response.status === 429) return reply({ error: 'eBay quota exhausted' }, 503, 'no-store')
    const body = response.ok ? await response.json() as Parameters<typeof classifyItemResponse>[1] : null
    const status = { id, checkedAt, ...classifyItemResponse(response.status, body) }
    // Ended is permanent; live can change, so re-ask after 30 minutes.
    const cache = status.state === 'ended' ? 's-maxage=86400'
      : status.state === 'live' ? 's-maxage=1800, stale-while-revalidate=600'
        : 'no-store'
    return reply(status, 200, cache)
  } catch {
    return reply({ id, checkedAt, state: 'unknown' }, 200, 'no-store')
  }
}
