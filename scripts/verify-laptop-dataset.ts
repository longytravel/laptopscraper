import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

import { assessBestBuy } from '../src/laptop/best-buy'
import {
  benchmarkKey,
  isFresh,
  type BenchmarkEvidenceStore,
} from '../src/laptop/benchmark-evidence'
import type { LaptopDataset } from '../src/laptop/types'

export interface VerificationCounts {
  recommendations: number
  invalidRecommendations: number
  omittedEligible: number
  missingEbayLinks: number
  staleRecommendedBenchmarks: number
  duplicateIds: number
  postageDependentRanks: number
  /**
   * Validated CPU records that share identical multi-core, single-thread and
   * sample figures with another chip. Two processors never genuinely tie on all
   * three, so a tie means one lookup resolved to the other chip's page.
   */
  benchmarkCollisions: number
}

export function countBenchmarkCollisions(evidence: BenchmarkEvidenceStore): number {
  const groups = new Map<string, number>()
  for (const record of Object.values(evidence.records)) {
    if (record.kind !== 'cpu' || record.status !== 'validated') continue
    const signature = `${record.multiCoreScore}|${record.singleThreadScore}|${record.sampleCount}`
    groups.set(signature, (groups.get(signature) ?? 0) + 1)
  }
  return [...groups.values()].filter((size) => size > 1).reduce((sum, size) => sum + size, 0)
}

export function verifyLaptopDataset(
  dataset: LaptopDataset,
  evidence: BenchmarkEvidenceStore,
  now = new Date(),
): VerificationCounts {
  const recommendations = dataset.listings.filter((row) => row.bestBuyEligible)
  const invalid = recommendations.filter((row) => !assessBestBuy(row).eligible)
  const omittedEligible = dataset.listings.filter(
    (row) => assessBestBuy(row).eligible && !row.bestBuyEligible,
  )
  const missingLinks = recommendations.filter(
    (row) => !/^https:\/\/www\.ebay\.co\.uk\/itm\//.test(row.listingUrl),
  )
  const stale = recommendations.filter((row) => {
    const cpu = row.cpuModel
      ? evidence.records[benchmarkKey('cpu', row.cpuModel)]
      : undefined
    const gpu = row.gpuModel
      ? evidence.records[benchmarkKey('gpu', row.gpuModel)]
      : undefined
    return !cpu || !gpu || !isFresh(cpu, now, 7) || !isFresh(gpu, now, 7)
  })
  const duplicateIds = dataset.listings.length
    - new Set(dataset.listings.map((row) => row.id)).size
  const postageDependent = recommendations.filter((row) => {
    const changed = assessBestBuy({
      ...row,
      shippingPrice: 9999,
      deliveredPrice: 9999,
    })
    return changed.workValue !== assessBestBuy(row).workValue
  })

  return {
    recommendations: recommendations.length,
    invalidRecommendations: invalid.length,
    omittedEligible: omittedEligible.length,
    missingEbayLinks: missingLinks.length,
    staleRecommendedBenchmarks: stale.length,
    duplicateIds,
    postageDependentRanks: postageDependent.length,
    benchmarkCollisions: countBenchmarkCollisions(evidence),
  }
}

export async function main(): Promise<void> {
  const dataset = JSON.parse(
    await readFile('public/data/laptop-listings.json', 'utf8'),
  ) as LaptopDataset
  const evidence = JSON.parse(
    await readFile('data/laptop-benchmark-evidence.json', 'utf8'),
  ) as BenchmarkEvidenceStore
  const counts = verifyLaptopDataset(dataset, evidence)

  console.log(`recommendations: ${counts.recommendations}`)
  console.log(`invalid recommendations: ${counts.invalidRecommendations}`)
  console.log(`omitted eligible listings: ${counts.omittedEligible}`)
  console.log(`missing eBay links: ${counts.missingEbayLinks}`)
  console.log(`stale recommended benchmarks: ${counts.staleRecommendedBenchmarks}`)
  console.log(`duplicate IDs: ${counts.duplicateIds}`)
  console.log(`postage-dependent ranks: ${counts.postageDependentRanks}`)
  console.log(`benchmark collisions: ${counts.benchmarkCollisions}`)

  const failures = counts.invalidRecommendations
    + counts.omittedEligible
    + counts.missingEbayLinks
    + counts.staleRecommendedBenchmarks
    + counts.duplicateIds
    + counts.postageDependentRanks
    + counts.benchmarkCollisions
  if (failures > 0) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
