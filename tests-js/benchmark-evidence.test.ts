import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  applyBenchmarkEvidence,
  benchmarkKey,
  CURRENT_PROVIDER_VERSION,
  isFresh,
  type BenchmarkEvidenceRecord,
  type BenchmarkEvidenceStore,
} from '../src/laptop/benchmark-evidence.ts'
import { enrichListing } from '../src/laptop/engine.ts'
import {
  findPassmarkCpuLink,
  normalizeCpuName,
  parsePassmarkCpuPage,
  parsePassmarkGpuPage,
  refreshBenchmarkEvidence,
} from '../scripts/passmark-benchmark-provider.ts'
import { refreshDatasetBenchmarks } from '../scripts/refresh-benchmark-evidence.ts'

const cpuHtml = await readFile(new URL('./fixtures/passmark-cpu.html', import.meta.url), 'utf8')
const gpuHtml = await readFile(new URL('./fixtures/passmark-gpu.html', import.meta.url), 'utf8')
const liveGpuHtml = await readFile(new URL('./fixtures/passmark-gpu-live.html', import.meta.url), 'utf8')

function cpuRecord(canonical: string, multiCoreScore: number, singleThreadScore: number, retrievedAt = '2026-07-22T00:00:00Z'): BenchmarkEvidenceRecord {
  return {
    kind: 'cpu',
    canonical,
    multiCoreScore,
    singleThreadScore,
    sourceName: 'PassMark',
    sourceUrl: `https://www.cpubenchmark.net/cpu.php?cpu=${encodeURIComponent(canonical)}`,
    observedAt: '2026-07-22',
    retrievedAt,
    sampleCount: 100,
    status: 'validated',
    providerVersion: CURRENT_PROVIDER_VERSION,
  }
}

function gpuRecord(canonical: string, graphicsScore: number): BenchmarkEvidenceRecord {
  return {
    kind: 'gpu',
    canonical,
    graphicsScore,
    sourceName: 'PassMark',
    sourceUrl: 'https://www.videocardbenchmark.net/gpu.php?id=1',
    observedAt: '2026-07-22',
    retrievedAt: '2026-07-22T00:00:00Z',
    sampleCount: 100,
    status: 'validated',
    providerVersion: CURRENT_PROVIDER_VERSION,
  }
}

function evidenceStore(records: BenchmarkEvidenceRecord[]): BenchmarkEvidenceStore {
  return {
    schemaVersion: 1,
    refreshedAt: '2026-07-22T00:00:00Z',
    records: Object.fromEntries(records.map((record) => [benchmarkKey(record.kind, record.canonical), record])),
  }
}

test('parses current CPU evidence and sample count', () => {
  assert.deepEqual(parsePassmarkCpuPage(cpuHtml), {
    cpuName: 'AMD Ryzen 9 9955HX',
    multiCoreScore: 56100,
    singleThreadScore: 4391,
    sampleCount: 628,
  })
})

test('parses the requested GPU column from a PassMark comparison', () => {
  assert.deepEqual(parsePassmarkGpuPage(gpuHtml, 1), { graphicsScore: 22415, sampleCount: 2863 })
})

test('parses the target GPU from the current PassMark chart-list markup', () => {
  assert.deepEqual(parsePassmarkGpuPage(liveGpuHtml, 6216), {
    graphicsScore: 22415,
    sampleCount: 2877,
  })
})

test('treats validated evidence as fresh for seven days inclusive', () => {
  const now = new Date('2026-07-22T12:00:00Z')
  assert.equal(isFresh(cpuRecord('CPU', 100, 100, '2026-07-15T12:00:00Z'), now, 7), true)
  assert.equal(isFresh(cpuRecord('CPU', 100, 100, '2026-07-15T11:59:59Z'), now, 7), false)
  assert.equal(isFresh({ ...cpuRecord('CPU', 100, 100), status: 'stale' }, now, 7), false)
  // v1 records were scraped without checking which chip the page named.
  assert.equal(isFresh({ ...cpuRecord('CPU', 100, 100), providerVersion: 'passmark-html-v1' }, now, 7), false)
})

test('replaces the stale 149 percent CPU claim with current evidence', () => {
  const store = evidenceStore([
    cpuRecord('Intel Core i9-14900HX', 43856, 4177),
    cpuRecord('AMD Ryzen 9 9955HX', 56100, 4391),
    gpuRecord('NVIDIA GeForce RTX 4060 Laptop GPU', 17359),
    gpuRecord('NVIDIA GeForce RTX 5070 Ti Laptop GPU', 22415),
  ])
  const listing = enrichListing({
    sourceListingId: 'v1|1|0',
    title: 'Lenovo Legion Ryzen 9 9955HX RTX 5070 Ti 64GB RAM 2TB SSD',
    price: 2100,
    currency: 'GBP',
    listingUrl: 'https://www.ebay.co.uk/itm/1',
  })

  const row = applyBenchmarkEvidence(listing, store)

  assert.equal(row.cpuMultiPower, 127.9)
  assert.equal(row.cpuSinglePower, 105.1)
  assert.equal(row.gpuPower, 129.1)
  assert.equal(row.workPerformance, 120.584)
  assert.equal(row.bestBuyEligible, true)
})

test('reuses fresh records and refreshes only stale distinct models', async () => {
  const store = evidenceStore([
    cpuRecord('Fresh CPU', 100, 100, '2026-07-22T00:00:00Z'),
    cpuRecord('AMD Ryzen 9 9955HX', 50, 50, '2026-07-01T00:00:00Z'),
  ])
  const requested: string[] = []
  const refreshed = await refreshBenchmarkEvidence([
    { kind: 'cpu', canonical: 'Fresh CPU', sourceUrl: 'https://example.test/fresh' },
    { kind: 'cpu', canonical: 'AMD Ryzen 9 9955HX', sourceUrl: 'https://example.test/stale' },
    { kind: 'cpu', canonical: 'AMD Ryzen 9 9955HX', sourceUrl: 'https://example.test/stale' },
  ], store, {
    now: new Date('2026-07-22T01:00:00Z'),
    fetchImpl: async (url) => {
      requested.push(String(url))
      return new Response(cpuHtml, { status: 200 })
    },
  })

  assert.deepEqual(requested, ['https://example.test/stale'])
  assert.equal(refreshed.records[benchmarkKey('cpu', 'AMD Ryzen 9 9955HX')].multiCoreScore, 56100)
  assert.equal(refreshed.records[benchmarkKey('cpu', 'AMD Ryzen 9 9955HX')].verifiedName, 'AMD Ryzen 9 9955HX')
})

function cpuPage(name: string, multi: string, single: string, samples: string): string {
  return `<html><head><title>${name} Benchmark</title></head><body><span class="cpuname">${name}</span>`
    + `<div>Multithread Rating</div><strong>${multi}</strong><div>Single Thread Rating</div><strong>${single}</strong>`
    + `<p>Samples: ${samples}*</p></body></html>`
}

const lookupHtml = '<ul>'
  + '<li><a href="/cpu.php?cpu=Intel+Core+Ultra+9+285HX&amp;id=6608">Intel Core Ultra 9 285HX</a></li>'
  + '<li><a href="/cpu.php?cpu=Intel+Core+Ultra+9+285H&amp;id=6444">Intel Core Ultra 9 285H</a></li>'
  + '<li><a href="/cpu.php?cpu=AMD+Ryzen+AI+Max%2B+395&amp;id=6403">AMD Ryzen AI Max+ 395</a></li>'
  + '</ul>'

test('CPU names compare on the model suffix, never on vendor words or punctuation', () => {
  assert.equal(normalizeCpuName('Intel® Core™ i9-14900HX'), normalizeCpuName('Intel Core i9 14900HX'))
  assert.notEqual(normalizeCpuName('Intel Core Ultra 9 285H'), normalizeCpuName('Intel Core Ultra 9 285HX'))
  assert.notEqual(normalizeCpuName('AMD Ryzen 9 9955HX'), normalizeCpuName('AMD Ryzen 9 9955HX3D'))
  assert.notEqual(normalizeCpuName('AMD Ryzen AI Max+ 395'), normalizeCpuName('AMD Ryzen AI Max 395'))
})

test('finds the exact id-pinned page in the PassMark lookup catalogue', () => {
  assert.equal(findPassmarkCpuLink(lookupHtml, 'Intel Core Ultra 9 285H'), 'https://www.cpubenchmark.net/cpu.php?cpu=Intel+Core+Ultra+9+285H&id=6444')
  assert.equal(findPassmarkCpuLink(lookupHtml, 'AMD Ryzen AI Max+ 395'), 'https://www.cpubenchmark.net/cpu.php?cpu=AMD+Ryzen+AI+Max%2B+395&id=6403')
  assert.equal(findPassmarkCpuLink(lookupHtml, 'Intel Core Ultra 7 255H'), null)
})

test('rejects a page for a different chip and resolves the exact model through the lookup', async () => {
  const requested: string[] = []
  const refreshed = await refreshBenchmarkEvidence([
    { kind: 'cpu', canonical: 'Intel Core Ultra 9 285H', sourceUrl: 'https://www.cpubenchmark.net/cpu.php?cpu=Intel%20Core%20Ultra%209%20285H' },
  ], evidenceStore([]), {
    now: new Date('2026-09-01T01:00:00Z'),
    fetchImpl: async (url) => {
      const target = String(url)
      requested.push(target)
      if (target.includes('cpu_lookup.php')) return new Response(lookupHtml, { status: 200 })
      if (target.includes('id=6444')) return new Response(cpuPage('Intel Core Ultra 9 285H', '38,400', '4,500', '640'), { status: 200 })
      // PassMark's name search answers the nearest chip, here the HX part.
      return new Response(cpuPage('Intel Core Ultra 9 285HX', '56,553', '4,609', '821'), { status: 200 })
    },
  })

  const record = refreshed.records[benchmarkKey('cpu', 'Intel Core Ultra 9 285H')]
  assert.equal(record.status, 'validated')
  assert.equal(record.multiCoreScore, 38400)
  assert.equal(record.singleThreadScore, 4500)
  assert.equal(record.verifiedName, 'Intel Core Ultra 9 285H')
  assert.equal(record.sourceUrl, 'https://www.cpubenchmark.net/cpu.php?cpu=Intel+Core+Ultra+9+285H&id=6444')
  assert.equal(requested.length, 3)
})

test('never stores the scores of another chip when PassMark has no exact page', async () => {
  const previous = cpuRecord('Intel Core Ultra 7 255H', 34000, 4300, '2026-07-01T00:00:00Z')
  const refreshed = await refreshBenchmarkEvidence([
    { kind: 'cpu', canonical: 'Intel Core Ultra 7 255H', sourceUrl: 'https://example.test/255h' },
    { kind: 'cpu', canonical: 'Intel Core i9-13900H', sourceUrl: 'https://example.test/13900h' },
  ], evidenceStore([previous]), {
    now: new Date('2026-09-01T01:00:00Z'),
    fetchImpl: async (url) => {
      const target = String(url)
      if (target.includes('cpu_lookup.php')) return new Response(lookupHtml, { status: 200 })
      if (target.includes('255h')) return new Response(cpuPage('Intel Core Ultra 7 255HX', '48,115', '4,560', '976'), { status: 200 })
      return new Response(cpuPage('Intel Core i9-13900HX', '41,501', '3,999', '4,223'), { status: 200 })
    },
  })

  const kept = refreshed.records[benchmarkKey('cpu', 'Intel Core Ultra 7 255H')]
  assert.equal(kept.status, 'stale')
  assert.equal(kept.multiCoreScore, 34000)
  assert.match(kept.lastError ?? '', /no exact page .* 255HX/)
  const missing = refreshed.records[benchmarkKey('cpu', 'Intel Core i9-13900H')]
  assert.equal(missing.status, 'failed')
  assert.equal(missing.multiCoreScore, undefined)
})

test('fails a CPU page that does not name its processor rather than trusting it', async () => {
  const refreshed = await refreshBenchmarkEvidence([
    { kind: 'cpu', canonical: 'Intel Core i9-14900HX', sourceUrl: 'https://example.test/unnamed' },
  ], evidenceStore([]), {
    now: new Date('2026-09-01T01:00:00Z'),
    fetchImpl: async () => new Response('<div>Multithread Rating</div><strong>43,705</strong><div>Single Thread Rating</div><strong>4,170</strong><p>Samples: 6,694*</p>', { status: 200 }),
  })
  const record = refreshed.records[benchmarkKey('cpu', 'Intel Core i9-14900HX')]
  assert.equal(record.status, 'failed')
  assert.match(record.lastError ?? '', /did not name/)
})

test('retains last validated scores as stale when refresh fails', async () => {
  const previous = cpuRecord('Stale CPU', 50000, 4000, '2026-07-01T00:00:00Z')
  const refreshed = await refreshBenchmarkEvidence([
    { kind: 'cpu', canonical: 'Stale CPU', sourceUrl: 'https://example.test/token-secret' },
  ], evidenceStore([previous]), {
    now: new Date('2026-07-22T01:00:00Z'),
    fetchImpl: async () => new Response('temporary failure', { status: 503 }),
  })

  const record = refreshed.records[benchmarkKey('cpu', 'Stale CPU')]
  assert.equal(record.multiCoreScore, 50000)
  assert.equal(record.status, 'stale')
  assert.doesNotMatch(record.lastError ?? '', /token-secret/)
})

test('refreshes distinct dataset hardware and writes authoritative best-buy fields', async () => {
  const listing = enrichListing({
    sourceListingId: 'v1|1|0',
    title: 'Lenovo Legion Ryzen 9 9955HX RTX 5070 Ti 64GB RAM 2TB SSD',
    price: 2100,
    currency: 'GBP',
    listingUrl: 'https://www.ebay.co.uk/itm/1',
  })
  const baseline = evidenceStore([
    cpuRecord('Intel Core i9-14900HX', 43856, 4177),
    gpuRecord('NVIDIA GeForce RTX 4060 Laptop GPU', 17359),
  ])
  const dataset = {
    schemaVersion: 6,
    generatedAt: '2026-07-22T01:00:00Z',
    marketplaceId: 'EBAY_GB',
    benchmarkVersion: 'old',
    rawCount: 1,
    listingCount: 1,
    scoredCount: 1,
    needsCheckingCount: 0,
    searchRuns: [],
    listings: [listing],
  }

  const result = await refreshDatasetBenchmarks(dataset, baseline, {
    now: new Date('2026-07-22T01:00:00Z'),
    // The 5070 Ti id is pinned in the URL, so the page must carry that row.
    fetchImpl: async (url) => new Response(String(url).includes('videocardbenchmark') ? liveGpuHtml : cpuHtml, { status: 200 }),
  })

  assert.equal(result.dataset.schemaVersion, 7)
  assert.equal(result.dataset.listings[0].cpuMultiPower, 127.9)
  assert.equal(result.dataset.listings[0].bestBuyEligible, true)
  assert.match(result.dataset.benchmarkVersion, /^passmark-live-/)
})
