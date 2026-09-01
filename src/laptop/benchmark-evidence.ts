import { assessBestBuy, G16_REFERENCE, workPerformance } from './best-buy'
import type { LaptopListing } from './types'

export type BenchmarkKind = 'cpu' | 'gpu'

export type ProviderVersion = 'passmark-html-v1' | 'passmark-html-v2'

/**
 * v1 trusted whatever page PassMark's name search returned, which for several
 * chips was a different processor. v2 verifies the chip named on the page, so
 * v1 records are never treated as fresh and are re-fetched on the next refresh.
 */
export const CURRENT_PROVIDER_VERSION: ProviderVersion = 'passmark-html-v2'

export interface BenchmarkEvidenceRecord {
  kind: BenchmarkKind
  canonical: string
  multiCoreScore?: number
  singleThreadScore?: number
  graphicsScore?: number
  sourceName: 'PassMark'
  sourceUrl: string
  /** The processor name PassMark printed on the page the scores came from. */
  verifiedName?: string
  observedAt: string
  retrievedAt: string
  sampleCount: number | null
  status: 'validated' | 'stale' | 'failed'
  providerVersion: ProviderVersion
  lastError?: string
}

export interface BenchmarkEvidenceStore {
  schemaVersion: 1
  refreshedAt: string
  records: Record<string, BenchmarkEvidenceRecord>
}

export function benchmarkKey(kind: BenchmarkKind, canonical: string): string {
  return `${kind}:${canonical}`
}

export function isFresh(record: BenchmarkEvidenceRecord, now: Date, maxAgeDays: number): boolean {
  if (record.status !== 'validated') return false
  if (record.providerVersion !== CURRENT_PROVIDER_VERSION) return false
  const retrieved = Date.parse(record.retrievedAt)
  if (!Number.isFinite(retrieved)) return false
  return now.getTime() - retrieved <= maxAgeDays * 24 * 60 * 60 * 1000
}

function normalized(candidate: number, baseline: number): number {
  return Math.round((10 * 100 * candidate) / baseline) / 10
}

function validated(store: BenchmarkEvidenceStore, kind: BenchmarkKind, canonical: string | null): BenchmarkEvidenceRecord | null {
  if (!canonical) return null
  const record = store.records[benchmarkKey(kind, canonical)]
  return record?.status === 'validated' ? record : null
}

export function applyBenchmarkEvidence(listing: LaptopListing, store: BenchmarkEvidenceStore): LaptopListing {
  const cpu = validated(store, 'cpu', listing.cpuModel)
  const cpuBaseline = validated(store, 'cpu', 'Intel Core i9-14900HX')
  const gpu = validated(store, 'gpu', listing.gpuModel)
  const gpuBaseline = validated(store, 'gpu', 'NVIDIA GeForce RTX 4060 Laptop GPU')

  const cpuMultiPower = cpu?.multiCoreScore != null && cpuBaseline?.multiCoreScore != null
    ? normalized(cpu.multiCoreScore, cpuBaseline.multiCoreScore)
    : null
  const cpuSinglePower = cpu?.singleThreadScore != null && cpuBaseline?.singleThreadScore != null
    ? normalized(cpu.singleThreadScore, cpuBaseline.singleThreadScore)
    : null
  const gpuPower = gpu?.graphicsScore != null && gpuBaseline?.graphicsScore != null
    ? normalized(gpu.graphicsScore, gpuBaseline.graphicsScore)
    : null
  const performance = workPerformance(cpuMultiPower, cpuSinglePower)
  const evidenceDates = [cpu, cpuBaseline, gpu, gpuBaseline]
    .filter((record): record is BenchmarkEvidenceRecord => record != null)
    .map((record) => record.retrievedAt)
    .sort()

  const rescored: LaptopListing = {
    ...listing,
    cpuPower: cpuMultiPower,
    gpuPower,
    cpuMultiPower,
    cpuSinglePower,
    workPerformance: performance,
    benchmarkEvidenceAt: evidenceDates[0] ?? null,
  }
  const assessment = assessBestBuy(rescored)
  return {
    ...rescored,
    workValue: assessment.workValue,
    bestBuyEligible: assessment.eligible,
    bestBuyFailures: assessment.failures,
  }
}

export function createInitialEvidenceStore(retrievedAt = '2026-07-22T00:00:00Z'): BenchmarkEvidenceStore {
  return {
    schemaVersion: 1,
    refreshedAt: retrievedAt,
    records: {
      [benchmarkKey('cpu', 'Intel Core i9-14900HX')]: {
        kind: 'cpu',
        canonical: 'Intel Core i9-14900HX',
        multiCoreScore: G16_REFERENCE.cpuMultiScore,
        singleThreadScore: G16_REFERENCE.cpuSingleScore,
        sourceName: 'PassMark',
        sourceUrl: 'https://www.cpubenchmark.net/cpu.php?cpu=Intel%20Core%20i9-14900HX',
        observedAt: '2026-07-22',
        retrievedAt,
        sampleCount: null,
        status: 'validated',
        providerVersion: CURRENT_PROVIDER_VERSION,
      },
      [benchmarkKey('gpu', 'NVIDIA GeForce RTX 4060 Laptop GPU')]: {
        kind: 'gpu',
        canonical: 'NVIDIA GeForce RTX 4060 Laptop GPU',
        graphicsScore: G16_REFERENCE.gpuScore,
        sourceName: 'PassMark',
        sourceUrl: 'https://www.videocardbenchmark.net/gpu.php?gpu=GeForce%20RTX%204060%20Laptop%20GPU&id=4752',
        observedAt: '2026-07-22',
        retrievedAt,
        sampleCount: null,
        status: 'validated',
        providerVersion: CURRENT_PROVIDER_VERSION,
      },
    },
  }
}
