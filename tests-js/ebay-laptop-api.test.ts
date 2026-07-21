import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildSearchParams,
  collectSearches,
  deduplicateItems,
  fetchJsonWithRetry,
  normalizeEbayItem,
} from '../scripts/ebay-laptop-api.ts'

test('builds an eBay GB laptop search capped at £3,000', () => {
  const params = buildSearchParams('RTX 4080 laptop', 80, 0)

  assert.equal(params.get('q'), 'RTX 4080 laptop')
  assert.equal(params.get('category_ids'), '177')
  assert.equal(params.get('limit'), '80')
  assert.equal(params.get('offset'), '0')
  assert.match(params.get('filter') ?? '', /price:\[0\.\.3000\]/)
  assert.match(params.get('filter') ?? '', /priceCurrency:GBP/)
  assert.match(params.get('filter') ?? '', /deliveryCountry:GB/)
  assert.equal(params.get('fieldgroups'), 'EXTENDED')
})

test('retries transient responses and honors Retry-After', async () => {
  const waits: number[] = []
  let calls = 0
  const fakeFetch: typeof fetch = async () => {
    calls += 1
    if (calls === 1) {
      return new Response(JSON.stringify({ error: 'rate limited' }), {
        status: 429,
        headers: { 'Retry-After': '0.01' },
      })
    }
    return Response.json({ ok: true })
  }

  const result = await fetchJsonWithRetry(fakeFetch, 'https://example.test', {}, {
    retries: 2,
    sleep: async (milliseconds) => { waits.push(milliseconds) },
  })

  assert.deepEqual(result, { ok: true })
  assert.equal(calls, 2)
  assert.deepEqual(waits, [10])
})

test('does not retry a permanent authentication failure or leak headers', async () => {
  let calls = 0
  const fakeFetch: typeof fetch = async () => {
    calls += 1
    return new Response('bad token', { status: 401 })
  }

  await assert.rejects(
    fetchJsonWithRetry(fakeFetch, 'https://example.test', { headers: { Authorization: 'Bearer secret-value' } }),
    (error: Error) => !error.message.includes('secret-value') && /401/.test(error.message),
  )
  assert.equal(calls, 1)
})

test('deduplicates overlapping searches while preserving matched search terms', () => {
  const rows = deduplicateItems([
    { itemId: 'one', title: 'Laptop A', searchTerm: 'RTX 4080 laptop' },
    { itemId: 'one', title: 'Laptop A', searchTerm: 'Core i9 laptop' },
    { itemId: 'two', title: 'Laptop B', searchTerm: 'Core i9 laptop' },
  ])

  assert.equal(rows.length, 2)
  assert.deepEqual(rows[0].searchTerms, ['RTX 4080 laptop', 'Core i9 laptop'])
})

test('normalizes price, shipping, seller, buying options and return evidence', () => {
  const row = normalizeEbayItem({
    itemId: 'v1|123|0',
    title: 'ASUS ROG i9-14900HX RTX 4080 64GB RAM 2TB SSD',
    itemWebUrl: 'https://www.ebay.co.uk/itm/123',
    price: { value: '2000', currency: 'GBP' },
    shippingOptions: [{ shippingCost: { value: '15', currency: 'GBP' } }],
    seller: { username: 'seller', feedbackScore: 500, feedbackPercentage: '99.8' },
    buyingOptions: ['FIXED_PRICE'],
    returnTerms: { returnsAccepted: true },
    itemLocation: { city: 'Leeds', country: 'GB' },
    localizedAspects: [{ name: 'RAM Size', value: '64 GB' }],
    searchTerms: ['RTX 4080 laptop'],
  })

  assert.equal(row.price, 2000)
  assert.equal(row.shippingPrice, 15)
  assert.equal(row.sellerFeedbackPercent, 99.8)
  assert.equal(row.returnTerms?.returnsAccepted, true)
  assert.equal(row.location, 'Leeds, GB')
  assert.deepEqual(row.searchTerms, ['RTX 4080 laptop'])
})

test('records a failed search while retaining successful results', async () => {
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input)
    if (url.includes('broken')) return new Response('upstream failed', { status: 500 })
    return Response.json({
      total: 1,
      itemSummaries: [{ itemId: 'ok', title: 'RTX 4080 laptop', price: { value: '1200', currency: 'GBP' } }],
    })
  }

  const result = await collectSearches({
    token: 'test-token',
    marketplaceId: 'EBAY_GB',
    searchTerms: ['working', 'broken'],
    fetchImpl: fakeFetch,
    perSearchLimit: 10,
    retries: 0,
  })

  assert.equal(result.items.length, 1)
  assert.equal(result.runs.length, 2)
  assert.equal(result.runs.find((run) => run.searchTerm === 'broken')?.returned, 0)
  assert.match(result.runs.find((run) => run.searchTerm === 'broken')?.error ?? '', /500/)
})

