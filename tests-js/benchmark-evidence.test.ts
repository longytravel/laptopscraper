import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  applyBenchmarkEvidence,
  benchmarkKey,
  isFresh,
  type BenchmarkEvidenceRecord,
  type BenchmarkEvidenceStore,
} from '../src/laptop/benchmark-evidence.ts'
import { enrichListing } from '../src/laptop/engine.ts'
import {
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
    providerVersion: 'passmark-html-v1',
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
    providerVersion: 'passmark-html-v1',
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
    cpuRecord('Stale CPU', 50, 50, '2026-07-01T00:00:00Z'),
  ])
  const requested: string[] = []
  const refreshed = await refreshBenchmarkEvidence([
    { kind: 'cpu', canonical: 'Fresh CPU', sourceUrl: 'https://example.test/fresh' },
    { kind: 'cpu', canonical: 'Stale CPU', sourceUrl: 'https://example.test/stale' },
    { kind: 'cpu', canonical: 'Stale CPU', sourceUrl: 'https://example.test/stale' },
  ], store, {
    now: new Date('2026-07-22T01:00:00Z'),
    fetchImpl: async (url) => {
      requested.push(String(url))
      return new Response(cpuHtml, { status: 200 })
    },
  })

  assert.deepEqual(requested, ['https://example.test/stale'])
  assert.equal(refreshed.records[benchmarkKey('cpu', 'Stale CPU')].multiCoreScore, 56100)
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
    fetchImpl: async (url) => new Response(String(url).includes('videocardbenchmark') ? gpuHtml : cpuHtml, { status: 200 }),
  })

  assert.equal(result.dataset.schemaVersion, 7)
  assert.equal(result.dataset.listings[0].cpuMultiPower, 127.9)
  assert.equal(result.dataset.listings[0].bestBuyEligible, true)
  assert.match(result.dataset.benchmarkVersion, /^passmark-live-/)
})
