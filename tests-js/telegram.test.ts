import assert from 'node:assert/strict'
import test from 'node:test'

import { applyBenchmarkEvidence, type BenchmarkEvidenceStore } from '../src/laptop/benchmark-evidence.ts'
import { enrichListing } from '../src/laptop/engine.ts'
import {
  buildTelegramDigest,
  emptyAlertState,
  sendTelegramMessage,
  type AlertState,
} from '../src/laptop/telegram.ts'
import type { LaptopDataset, LaptopListing } from '../src/laptop/types.ts'

const DASHBOARD_URL = 'https://laptopscraper.vercel.app'

const evidence: BenchmarkEvidenceStore = {
  schemaVersion: 1,
  refreshedAt: '2026-07-22T08:00:00Z',
  records: {
    'cpu:Intel Core i9-14900HX': {
      kind: 'cpu', canonical: 'Intel Core i9-14900HX', multiCoreScore: 43856, singleThreadScore: 4177,
      sourceName: 'PassMark', sourceUrl: 'https://cpu.test/g16', observedAt: '2026-07-22', retrievedAt: '2026-07-22T08:00:00Z', sampleCount: 100,
      status: 'validated', providerVersion: 'passmark-html-v1',
    },
    'cpu:AMD Ryzen 9 9955HX': {
      kind: 'cpu', canonical: 'AMD Ryzen 9 9955HX', multiCoreScore: 56100, singleThreadScore: 4391,
      sourceName: 'PassMark', sourceUrl: 'https://cpu.test/9955', observedAt: '2026-07-22', retrievedAt: '2026-07-22T08:00:00Z', sampleCount: 628,
      status: 'validated', providerVersion: 'passmark-html-v1',
    },
    'gpu:NVIDIA GeForce RTX 4060 Laptop GPU': {
      kind: 'gpu', canonical: 'NVIDIA GeForce RTX 4060 Laptop GPU', graphicsScore: 17359,
      sourceName: 'PassMark', sourceUrl: 'https://gpu.test/4060', observedAt: '2026-07-22', retrievedAt: '2026-07-22T08:00:00Z', sampleCount: 100,
      status: 'validated', providerVersion: 'passmark-html-v1',
    },
    'gpu:NVIDIA GeForce RTX 5070 Ti Laptop GPU': {
      kind: 'gpu', canonical: 'NVIDIA GeForce RTX 5070 Ti Laptop GPU', graphicsScore: 22415,
      sourceName: 'PassMark', sourceUrl: 'https://gpu.test/5070ti', observedAt: '2026-07-22', retrievedAt: '2026-07-22T08:00:00Z', sampleCount: 2863,
      status: 'validated', providerVersion: 'passmark-html-v1',
    },
  },
}

function eligible(id: string, overrides: Partial<LaptopListing> = {}): LaptopListing {
  const base = enrichListing({
    sourceListingId: id,
    title: `Lenovo ${id} Ryzen 9 9955HX RTX 5070 Ti 64GB RAM 2TB SSD`,
    price: 1500,
    currency: 'GBP',
    condition: 'Used',
    sellerName: 'trusted',
    sellerFeedbackScore: 2000,
    sellerFeedbackPercent: 99.8,
    listingUrl: `https://www.ebay.co.uk/itm/${id}`,
    returnTerms: { returnsAccepted: true },
  })
  return applyBenchmarkEvidence({ ...base, firstSeenAt: '2026-07-22T08:00:00Z', ...overrides }, evidence)
}

function dataset(listings: LaptopListing[]): LaptopDataset {
  return {
    schemaVersion: 7,
    generatedAt: '2026-07-22T08:00:00Z',
    refreshStatus: 'fresh',
    marketplaceId: 'EBAY_GB',
    benchmarkVersion: 'passmark-live-2026-07-22',
    rawCount: listings.length,
    listingCount: listings.length,
    scoredCount: listings.length,
    needsCheckingCount: 0,
    searchRuns: [],
    listings,
  }
}

function state(seenEligibleIds: string[] = []): AlertState {
  return { ...emptyAlertState(), seenEligibleIds }
}

test('puts new best buys first and links to eBay', () => {
  const old = eligible('old', { price: 1800, cpuMultiPower: 135, cpuSinglePower: 110 })
  const digest = buildTelegramDigest(dataset([old, eligible('new')]), state(['old']), DASHBOARD_URL)

  assert.match(digest.html, /🆕 <b>Lenovo new/)
  assert.match(digest.html, /Multi-core \+28% · single-thread \+5%/)
  assert.match(digest.html, /Updated 22 Jul 2026, 09:00 · 2 qualifying/)
  assert.match(digest.html, /#1 current best buy/)
  assert.match(digest.html, /https:\/\/www\.ebay\.co\.uk\/itm\/new/)
  assert.ok(digest.html.indexOf('Lenovo new') < digest.html.indexOf('Lenovo old'))
  assert.ok(digest.html.length <= 4096)
})

test('does not create a second digest for the same successful snapshot', () => {
  const first = buildTelegramDigest(dataset([eligible('same')]), emptyAlertState(), DASHBOARD_URL)
  const sentState = { ...emptyAlertState(), lastSnapshotHash: first.snapshotHash }
  assert.equal(buildTelegramDigest(dataset([eligible('same')]), sentState, DASHBOARD_URL).shouldSend, false)
})

test('escapes Telegram HTML supplied by listing titles', () => {
  const row = eligible('unsafe', { title: '<cheap & fast>' })
  assert.match(buildTelegramDigest(dataset([row]), emptyAlertState(), DASHBOARD_URL).html, /&lt;cheap &amp; fast&gt;/)
})

test('caps long digests without breaking the dashboard link', () => {
  const rows = Array.from({ length: 30 }, (_, index) => eligible(String(index), { title: `Laptop ${index} ${'power '.repeat(80)}` }))
  const digest = buildTelegramDigest(dataset(rows), emptyAlertState(), DASHBOARD_URL)
  assert.ok(digest.html.length <= 4096)
  assert.match(digest.html, /Open the full dashboard/)
})

test('posts Telegram HTML and returns the message ID', async () => {
  let body: Record<string, unknown> | null = null
  const result = await sendTelegramMessage({
    token: 'secret-token',
    chatId: '123',
    html: '<b>Hello</b>',
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return Response.json({ ok: true, result: { message_id: 99 } })
    },
  })

  assert.equal(result.messageId, 99)
  assert.equal(body?.parse_mode, 'HTML')
  assert.deepEqual(body?.link_preview_options, { is_disabled: true })
})

test('never includes the bot token in transport errors', async () => {
  await assert.rejects(
    sendTelegramMessage({
      token: 'secret-token',
      chatId: '123',
      html: 'Hello',
      fetchImpl: async () => new Response('bad gateway', { status: 502 }),
    }),
    (error: Error) => !error.message.includes('secret-token') && /HTTP 502/.test(error.message),
  )
})
