import 'dotenv/config'

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { BENCHMARK_VERSION } from '../src/laptop/benchmarks'
import { enrichListing } from '../src/laptop/engine'
import type { LaptopDataset } from '../src/laptop/types'
import {
  canUseCachedSearchFallback,
  collectSearches,
  enrichEbayItems,
  getEbayAppToken,
  isUsableCachedDataset,
  isTransientEbayFailure,
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

function upgradeLegacyCache(value: unknown): LaptopDataset {
  const dataset = value as LaptopDataset
  if ((dataset.schemaVersion ?? 0) >= 5) return dataset
  const listings = dataset.listings.map((listing) => enrichListing({
    sourceListingId: listing.id,
    categoryId: '177',
    title: listing.title,
    description: listing.description,
    price: listing.price,
    // Schema 1 could not distinguish absent postage from explicit free postage,
    // so preserve buyer safety by treating those zeroes as unknown.
    shippingPrice: listing.shippingPrice === 0 ? null : listing.shippingPrice,
    currency: listing.currency,
    condition: listing.condition,
    sellerName: listing.sellerName,
    sellerFeedbackScore: listing.sellerFeedbackScore,
    sellerFeedbackPercent: listing.sellerFeedbackPercent,
    listingUrl: listing.listingUrl,
    location: listing.location,
    imageUrl: listing.imageUrl ?? undefined,
    buyingOptions: listing.buyingOptions,
    returnTerms: { returnsAccepted: listing.returnsAccepted ?? undefined },
    listedAt: listing.listedAt,
    scrapedAt: listing.scrapedAt ?? undefined,
    searchTerms: listing.searchTerms,
  }))
  return {
    ...dataset,
    schemaVersion: 5,
    benchmarkVersion: BENCHMARK_VERSION,
    scoredCount: listings.filter((listing) => listing.combinedPower != null).length,
    needsCheckingCount: listings.filter((listing) => listing.combinedPower == null || listing.deliveredPrice == null).length,
    listings,
  }
}

async function preserveRecentCache(outputPath: string, reason: unknown): Promise<boolean> {
  try {
    const cached = JSON.parse(await readFile(outputPath, 'utf8')) as unknown
    if (!isUsableCachedDataset(cached)) return false
    const upgraded = upgradeLegacyCache(cached)
    await writeJsonAtomic(outputPath, upgraded)
    console.warn('eBay refresh was temporarily unavailable; preserving the recent committed dataset for this build.')
    console.warn(reason instanceof Error ? reason.message : String(reason))
    return true
  } catch {
    return false
  }
}

async function main(): Promise<void> {
  const clientId = process.env.EBAY_CLIENT_ID ?? ''
  const clientSecret = process.env.EBAY_CLIENT_SECRET ?? ''
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || 'EBAY_GB'
  const deliveryPostalCode = process.env.EBAY_DELIVERY_POSTCODE?.trim() || undefined
  const outputPath = path.resolve('public/data/laptop-listings.json')
  let token: string
  try {
    token = await getEbayAppToken(clientId, clientSecret)
  } catch (error) {
    if (isTransientEbayFailure(error) && await preserveRecentCache(outputPath, error)) return
    throw error
  }
  const searchResult = await collectSearches({
    token,
    marketplaceId,
    searchTerms: SEARCH_TERMS,
    perSearchLimit: Number(process.env.EBAY_LAPTOP_LIMIT_PER_SEARCH ?? 80),
    deliveryPostalCode,
  })
  if (searchResult.items.length === 0) {
    const errors = searchResult.runs.filter((run) => run.error).map((run) => `${run.searchTerm}: ${run.error}`).join('; ')
    if (canUseCachedSearchFallback(searchResult.runs) && await preserveRecentCache(outputPath, errors)) return
    throw new Error(`No eBay laptop listings were collected. ${errors}`)
  }

  const maxDetails = Number(process.env.EBAY_LAPTOP_DETAIL_LIMIT ?? 320)
  const candidates = searchResult.items
    .filter((item) => Number(item.price?.value ?? 0) <= 3000)
    .slice(0, maxDetails)
  const enrichedItems = await enrichEbayItems({ items: candidates, token, marketplaceId, concurrency: 6, deliveryPostalCode })
  const listings = enrichedItems
    .map(normalizeEbayItem)
    .map((raw) => enrichListing(raw))
    .filter((listing) => listing.price > 0 && listing.price <= 3000 && (listing.deliveredPrice == null || listing.deliveredPrice <= 3000))
    .sort((a, b) => (b.recommendationScore - a.recommendationScore) || ((a.deliveredPrice ?? Number.POSITIVE_INFINITY) - (b.deliveredPrice ?? Number.POSITIVE_INFINITY)))

  const dataset: LaptopDataset = {
    schemaVersion: 5,
    generatedAt: new Date().toISOString(),
    marketplaceId,
    benchmarkVersion: BENCHMARK_VERSION,
    rawCount: searchResult.runs.reduce((sum, run) => sum + run.returned, 0),
    listingCount: listings.length,
    scoredCount: listings.filter((listing) => listing.combinedPower != null).length,
    needsCheckingCount: listings.filter((listing) => listing.combinedPower == null || listing.deliveredPrice == null).length,
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
