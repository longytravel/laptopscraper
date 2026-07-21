import 'dotenv/config'

import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { BENCHMARK_VERSION } from '../src/laptop/benchmarks'
import { enrichListing } from '../src/laptop/engine'
import type { LaptopDataset } from '../src/laptop/types'
import {
  collectSearches,
  enrichEbayItems,
  getEbayAppToken,
  normalizeEbayItem,
} from './ebay-laptop-api'

export const SEARCH_TERMS = [
  'RTX 5090 laptop',
  'RTX 5080 laptop',
  'RTX 5070 Ti laptop',
  'RTX 5070 laptop',
  'RTX 4090 laptop',
  'RTX 4080 laptop',
  'RTX 4070 i9 laptop',
  'RTX 4060 i9 laptop',
  'Ryzen 9 RTX gaming laptop',
  'mobile workstation RTX 5000 Ada',
]

async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
}

async function main(): Promise<void> {
  const clientId = process.env.EBAY_CLIENT_ID ?? ''
  const clientSecret = process.env.EBAY_CLIENT_SECRET ?? ''
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || 'EBAY_GB'
  const outputPath = path.resolve('public/data/laptop-listings.json')
  const token = await getEbayAppToken(clientId, clientSecret)
  const searchResult = await collectSearches({
    token,
    marketplaceId,
    searchTerms: SEARCH_TERMS,
    perSearchLimit: Number(process.env.EBAY_LAPTOP_LIMIT_PER_SEARCH ?? 80),
  })
  if (searchResult.items.length === 0) {
    const errors = searchResult.runs.filter((run) => run.error).map((run) => `${run.searchTerm}: ${run.error}`).join('; ')
    throw new Error(`No eBay laptop listings were collected. ${errors}`)
  }

  const maxDetails = Number(process.env.EBAY_LAPTOP_DETAIL_LIMIT ?? 320)
  const candidates = searchResult.items
    .filter((item) => Number(item.price?.value ?? 0) <= 3000)
    .slice(0, maxDetails)
  const enrichedItems = await enrichEbayItems({ items: candidates, token, marketplaceId, concurrency: 6 })
  const listings = enrichedItems
    .map(normalizeEbayItem)
    .map((raw) => enrichListing(raw))
    .filter((listing) => listing.deliveredPrice > 0 && listing.deliveredPrice <= 3000)
    .sort((a, b) => (b.recommendationScore - a.recommendationScore) || (a.deliveredPrice - b.deliveredPrice))

  const dataset: LaptopDataset = {
    generatedAt: new Date().toISOString(),
    marketplaceId,
    benchmarkVersion: BENCHMARK_VERSION,
    rawCount: searchResult.runs.reduce((sum, run) => sum + run.returned, 0),
    listingCount: listings.length,
    scoredCount: listings.filter((listing) => listing.combinedPower != null).length,
    needsCheckingCount: listings.filter((listing) => listing.combinedPower == null).length,
    searchRuns: searchResult.runs,
    listings,
  }
  await writeJsonAtomic(outputPath, dataset)
  console.log(`Saved ${dataset.listingCount} live eBay GB laptops (${dataset.scoredCount} scored, ${dataset.needsCheckingCount} need checking).`)
  console.log(`Dataset: ${outputPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

