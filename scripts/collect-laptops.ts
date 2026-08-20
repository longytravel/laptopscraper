import 'dotenv/config'

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { BENCHMARK_VERSION } from '../src/laptop/benchmarks'
import { enrichListing } from '../src/laptop/engine'
import { mergeSeenTimestamps } from '../src/laptop/snapshot'
import type { LaptopDataset } from '../src/laptop/types'
import {
  canUseCachedSearchFallback,
  collectSearches,
  enrichEbayItems,
  getBrowseCallsRemaining,
  getEbayAppToken,
  isUsableCachedDataset,
  isTransientEbayFailure,
  normalizeEbayItem,
} from './ebay-laptop-api'
import type { EbaySearchItem } from './ebay-laptop-api'

// Four angles, because no single phrasing finds everything. GPU terms catch the
// gaming listings, RAM terms catch the machines that clear the 64 GB gate but
// never mention a GPU tier, CPU terms catch sellers who lead on the processor,
// and model terms catch titles that name neither part.
export const SEARCH_TERMS = [
  // by graphics — the high tiers only. A bare "RTX 4060 laptop" search returns
  // mostly 16 GB machines on processors that fail the no-downgrade gate, so the
  // lower tiers are qualified by memory instead of searched on their own.
  'RTX 5090 laptop',
  'RTX 5080 laptop',
  'RTX 5070 Ti laptop',
  'RTX 5070 laptop',
  'RTX 4090 laptop',
  'RTX 4080 laptop',
  'RTX 4070 64GB laptop',
  'RTX 4060 64GB laptop',

  // by memory — the binding replacement gate, so the highest-signal angle
  '64GB RAM gaming laptop',
  '64GB RAM laptop RTX',
  '96GB RAM laptop',
  '128GB RAM laptop',
  'gaming laptop 64GB 2TB',

  // by processor — only chips that actually clear the floor on BOTH dimensions,
  // measured against the G16 in data/laptop-benchmark-evidence.json. Ryzen 9
  // 7945HX (single-thread 97) and i9-13900HX (95/96) are downgrades and are
  // deliberately absent; searching them spends calls on listings that can never
  // qualify. The Ultra 7 parts pass and are cheaper than the Ultra 9 ones.
  'i9-14900HX laptop',
  'i9-13980HX laptop',
  'Core Ultra 9 275HX laptop',
  'Core Ultra 9 285HX laptop',
  'Core Ultra 7 265HX laptop',
  'Core Ultra 7 255HX laptop',
  'Ryzen 9 9955HX laptop',

  // by model
  'ASUS ROG Strix Scar 18',
  'ASUS ROG Strix G16',
  'ASUS ROG Zephyrus M16',
  'Lenovo Legion Pro 7',
  'Lenovo Legion 9i',
  'Alienware 16 Area-51',
  'Alienware 18',
  'MSI Titan 18 HX',
  'MSI Raider 18',
  'Razer Blade 16',
  'Razer Blade 18',
  'Acer Predator Helios 18',
  'HP Omen Max 16',
  'Gigabyte Aorus Master 16',

  // mobile workstations, which clear the gates but rarely say "gaming"
  'mobile workstation RTX 5000 Ada',
  'ThinkPad P16 workstation',
  'Dell Precision 7680',
  'HP ZBook Fury 16',
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
    const upgraded = { ...upgradeLegacyCache(cached), refreshStatus: 'cached-fallback' as const }
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
  let previousDataset: LaptopDataset | null = null
  try {
    previousDataset = upgradeLegacyCache(JSON.parse(await readFile(outputPath, 'utf8')) as unknown)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
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
    perSearchLimit: Number(process.env.EBAY_LAPTOP_LIMIT_PER_SEARCH ?? 300),
    deliveryPostalCode,
  })
  if (searchResult.items.length === 0) {
    const errors = searchResult.runs.filter((run) => run.error).map((run) => `${run.searchTerm}: ${run.error}`).join('; ')
    if (canUseCachedSearchFallback(searchResult.runs) && await preserveRecentCache(outputPath, errors)) return
    throw new Error(`No eBay laptop listings were collected. ${errors}`)
  }

  // Detail fetching costs one Browse call per item and is the bulk of the daily
  // spend, so size it against the calls actually left rather than a fixed cap.
  // The reserve keeps the second scheduled run of the day able to work.
  const affordable = searchResult.items.filter((item) => Number(item.price?.value ?? 0) <= 3000)
  const remainingCalls = await getBrowseCallsRemaining({ token })
  const reserve = Number(process.env.EBAY_LAPTOP_CALL_RESERVE ?? 1000)
  const requestedMax = Number(process.env.EBAY_LAPTOP_DETAIL_LIMIT ?? 2000)
  const affordableMax = remainingCalls == null ? requestedMax : Math.max(0, remainingCalls - reserve)
  const maxDetails = Math.min(requestedMax, affordableMax)

  // When the budget binds, spend it on listings that could actually beat the
  // G16, judged from the title alone. Price is deliberately not part of this —
  // a cheap machine that clears the floor is the best possible find. What gets
  // deprioritised is hardware that cannot win: memory below the 64 GB gate, and
  // processors already measured as downgrades on either CPU dimension.
  const DOWNGRADE_CPUS = /\b(?:7945HX|7845HX|8945H|8940HX|13900HX?|13950HX|12900HX|14700HX|14650HX|13700HX?|13650HX|7940HS|Ultra\s*9\s*185H|Ultra\s*7\s*155H|HX\s*3(?:70|75)|AI\s*9\s*365)\b/i
  const QUALIFYING_CPUS = /\b(?:9955HX(?:3D)?|285HX?|275HX|265HX|255HX?|13980HX|14900HX)\b/i

  const capabilitySignal = (item: EbaySearchItem): number => {
    const title = String(item.title ?? '')
    const lowMemory = /\b(?:4|8|12|16|24|32|48)\s*GB\b/i.test(title) && !/\b(?:64|96|128|192|256)\s*GB\b/i.test(title)
    if (lowMemory || DOWNGRADE_CPUS.test(title)) return 4
    if (/\b(?:96|128|192|256)\s*GB\b/i.test(title)) return 0
    if (/\b64\s*GB\b/i.test(title)) return 1
    if (QUALIFYING_CPUS.test(title)) return 2
    return 3
  }

  const candidates = affordable
    .map((item, index) => ({ item, index, rank: capabilitySignal(item) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, maxDetails)
    .map((entry) => entry.item)

  if (candidates.length < affordable.length) {
    console.warn(`Detail budget covered ${candidates.length} of ${affordable.length} candidates (Browse calls remaining: ${remainingCalls ?? 'unknown'}, reserve ${reserve}). Listings beyond the budget were not fetched.`)
  }

  const enrichedItems = await enrichEbayItems({ items: candidates, token, marketplaceId, concurrency: 6, deliveryPostalCode })
  const collectedAt = new Date().toISOString()
  const listings = mergeSeenTimestamps(previousDataset?.listings ?? [], enrichedItems
    .map(normalizeEbayItem)
    .map((raw) => enrichListing(raw))
    .filter((listing) => listing.price > 0 && listing.price <= 3000 && (listing.deliveredPrice == null || listing.deliveredPrice <= 3000))
    .sort((a, b) => (b.recommendationScore - a.recommendationScore) || ((a.deliveredPrice ?? Number.POSITIVE_INFINITY) - (b.deliveredPrice ?? Number.POSITIVE_INFINITY))), collectedAt)

  const dataset: LaptopDataset = {
    schemaVersion: 7,
    generatedAt: collectedAt,
    refreshStatus: 'fresh',
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
