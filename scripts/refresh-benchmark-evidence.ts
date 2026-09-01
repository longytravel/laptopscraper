import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import { CPU_BENCHMARKS, GPU_BENCHMARKS } from '../src/laptop/benchmarks'
import {
  applyBenchmarkEvidence,
  createInitialEvidenceStore,
  CURRENT_PROVIDER_VERSION,
  type BenchmarkEvidenceStore,
} from '../src/laptop/benchmark-evidence'
import type { LaptopDataset, LaptopListing } from '../src/laptop/types'
import {
  refreshBenchmarkEvidence,
  type HardwareModel,
  type RefreshOptions,
} from './passmark-benchmark-provider'

const DATASET_PATH = path.resolve('public/data/laptop-listings.json')
const EVIDENCE_PATH = path.resolve('data/laptop-benchmark-evidence.json')

async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
}

function sourceModels(listings: LaptopListing[], store: BenchmarkEvidenceStore): HardwareModel[] {
  const cpus = new Set(listings.map((listing) => listing.cpuModel).filter((model): model is string => Boolean(model)))
  const gpus = new Set(listings.map((listing) => listing.gpuModel).filter((model): model is string => Boolean(model)))
  cpus.add('Intel Core i9-14900HX')
  gpus.add('NVIDIA GeForce RTX 4060 Laptop GPU')
  // A record scraped before the page-name check may hold another chip's scores.
  // Re-verify it even when no current listing uses it, so a stale wrong number
  // never sits in the store waiting for the next listing with that chip.
  for (const record of Object.values(store.records)) {
    if (record.providerVersion === CURRENT_PROVIDER_VERSION) continue
    if (record.kind === 'cpu') cpus.add(record.canonical)
    else gpus.add(record.canonical)
  }

  return [
    ...[...cpus].map((canonical) => {
      const sourceUrl = CPU_BENCHMARKS.find((entry) => entry.canonical === canonical)?.source.url
        ?? `https://www.cpubenchmark.net/cpu.php?cpu=${encodeURIComponent(canonical)}`
      return { kind: 'cpu' as const, canonical, sourceUrl }
    }),
    ...[...gpus].flatMap((canonical) => {
      const sourceUrl = GPU_BENCHMARKS.find((entry) => entry.canonical === canonical)?.source.url
      return sourceUrl ? [{ kind: 'gpu' as const, canonical, sourceUrl }] : []
    }),
  ]
}

export async function refreshDatasetBenchmarks(
  dataset: LaptopDataset,
  store: BenchmarkEvidenceStore,
  options: RefreshOptions = {},
): Promise<{ dataset: LaptopDataset; store: BenchmarkEvidenceStore }> {
  const refreshedStore = await refreshBenchmarkEvidence(sourceModels(dataset.listings, store), store, options)
  const listings = dataset.listings.map((listing) => applyBenchmarkEvidence(listing, refreshedStore))
  const observedDate = (options.now ?? new Date()).toISOString().slice(0, 10)
  return {
    store: refreshedStore,
    dataset: {
      ...dataset,
      schemaVersion: Math.max(dataset.schemaVersion, 7),
      benchmarkVersion: `passmark-live-${observedDate}`,
      scoredCount: listings.filter((listing) => listing.workPerformance != null).length,
      needsCheckingCount: listings.filter((listing) => listing.workPerformance == null || !listing.bestBuyEligible).length,
      listings,
    },
  }
}

async function readEvidenceStore(): Promise<BenchmarkEvidenceStore> {
  try {
    return JSON.parse(await readFile(EVIDENCE_PATH, 'utf8')) as BenchmarkEvidenceStore
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return createInitialEvidenceStore()
    throw error
  }
}

export async function main(): Promise<void> {
  const dataset = JSON.parse(await readFile(DATASET_PATH, 'utf8')) as LaptopDataset
  const store = await readEvidenceStore()
  const result = await refreshDatasetBenchmarks(dataset, store)
  await writeJsonAtomic(EVIDENCE_PATH, result.store)
  await writeJsonAtomic(DATASET_PATH, result.dataset)
  const eligible = result.dataset.listings.filter((listing) => listing.bestBuyEligible).length
  console.log(`Benchmarks refreshed: ${Object.keys(result.store.records).length} models; ${eligible} eligible best buys.`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
