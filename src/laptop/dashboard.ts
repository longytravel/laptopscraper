import { assessBestBuy, bestBuyFrontier, G16_REFERENCE, rankBestBuys, ramUpgradeCost } from './best-buy'
import type { GateOptions, RamTier } from './best-buy'
import type { LaptopFilters, LaptopListing } from './types'

export const SHORTLIST_STORAGE_KEY = 'laptop-power-finder-shortlist-v1'
export const BASELINE_PRICE = G16_REFERENCE.advertisedPrice
export const BASELINE_POWER = 100
const NUMBER_FORMAT = new Intl.NumberFormat('en-GB')

export type ListingReadiness = 'ready' | 'specs-incomplete'
export type PriceCertainty = 'exact'
export type ValueBand = 'strong' | 'competitive' | 'weak'

export interface ValueAssessment {
  ratio: number
  band: ValueBand
  label: string
}

export function parseShortlist(value: string | null): Set<string> {
  if (!value) return new Set()
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== 'string')) return new Set()
    return new Set(parsed)
  } catch {
    return new Set()
  }
}

export function serializeShortlist(ids: Set<string>): string {
  return JSON.stringify([...ids].sort())
}

export function toggleSelection(ids: Set<string>, id: string): Set<string> {
  const next = new Set(ids)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b))
}

export function deriveFacets(listings: LaptopListing[]) {
  return {
    conditions: unique(listings.map((listing) => listing.condition)),
    brands: unique(listings.map((listing) => listing.brand)),
    cpuManufacturers: unique(listings.map((listing) => listing.cpuManufacturer)),
    gpuFamilies: unique(listings.map((listing) => listing.gpuFamily)),
    buyingOptions: unique(listings.flatMap((listing) => listing.buyingOptions)),
    riskFlags: unique(listings.flatMap((listing) => listing.riskFlags)),
  }
}

export function rankListings(listings: LaptopListing[], options: GateOptions = {}): LaptopListing[] {
  return rankBestBuys(listings, options)
}

export function classifyReadiness(listing: LaptopListing, options: GateOptions = {}): ListingReadiness {
  return assessBestBuy(listing, options).eligible ? 'ready' : 'specs-incomplete'
}

/** The upgrade line a 32 GB machine needs; empty for one already at 64 GB. */
export function upgradeNote(listing: LaptopListing): string | null {
  const cost = ramUpgradeCost(listing)
  if (cost === 0) return null
  if (cost == null) return `${listing.ramGb} GB soldered, so it cannot be upgraded to 64 GB`
  return `${listing.ramGb} GB as listed; about £${Math.round(cost)} for a 64 GB kit makes £${NUMBER_FORMAT.format(Math.round(listing.price + cost))} — check the RAM is not soldered`
}


export function chartPrice(listing: LaptopListing): { price: number; certainty: PriceCertainty } {
  return { price: listing.price, certainty: 'exact' }
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function assessValue(power: number, price: number): ValueAssessment {
  const rawRatio = (power / price) / (BASELINE_POWER / BASELINE_PRICE)
  const ratio = round(rawRatio, 1)
  const percentage = Math.round(Math.abs(rawRatio - 1) * 100)
  const band: ValueBand = rawRatio >= 1.2 ? 'strong' : rawRatio >= 0.95 ? 'competitive' : 'weak'
  const label = rawRatio >= 1.02
    ? `${percentage}% better value than your G16`
    : rawRatio <= 0.98
      ? `${percentage}% below your G16 for work value`
      : 'Similar work value to your G16'

  return { ratio, band, label }
}

function signedPercent(power: number | null | undefined): string {
  if (power == null) return 'unknown'
  const percentage = Math.round(power - 100)
  return `${percentage >= 0 ? '+' : ''}${percentage}%`
}

export function buildRecommendationReason(listing: LaptopListing, options: GateOptions = {}): string {
  const assessment = assessBestBuy(listing, options)
  if (!assessment.eligible) return `Not a confirmed match. ${assessment.failures.join('; ') || 'Hardware evidence is incomplete'}.`

  const parts = [
    `Multi-core ${signedPercent(listing.cpuMultiPower)} and single-thread ${signedPercent(listing.cpuSinglePower)}`,
    `work performance ${signedPercent(assessment.workPerformance)}`,
    assessValue(assessment.workPerformance!, assessment.effectivePrice).label,
    upgradeNote(listing) ?? `${listing.ramGb} GB RAM`,
  ]
  if (assessment.surplusCredit > 0) {
    parts.push(`£${Math.round(assessment.surplusCredit)} credited for surplus RAM and storage`)
  }
  parts.push(...sellerTerms(listing))
  return `${parts.join(', ')}.`
}

/** Return and seller-type facts in the words a buyer needs: how long, who pays, and whether consumer law applies. */
export function sellerTerms(listing: Pick<LaptopListing, 'returnsAccepted' | 'returnPeriodDays' | 'returnShippingPaidBy' | 'sellerAccountType'>): string[] {
  const parts: string[] = []
  if (listing.returnsAccepted === true) {
    const details = [
      listing.returnPeriodDays ? `${listing.returnPeriodDays} days` : null,
      listing.returnShippingPaidBy === 'SELLER' ? 'seller pays return postage' : listing.returnShippingPaidBy === 'BUYER' ? 'buyer pays return postage' : null,
    ].filter(Boolean)
    parts.push(details.length ? `returns accepted (${details.join(', ')})` : 'returns accepted')
  } else if (listing.returnsAccepted === false) {
    parts.push('no returns')
  }
  if (listing.sellerAccountType === 'BUSINESS') parts.push('business seller, so UK consumer rights apply')
  return parts
}

function selected(set: Set<string>, value: string | null): boolean {
  return set.size === 0 || (value != null && set.has(value))
}

function applyDashboardFilters(listings: LaptopListing[], filters: LaptopFilters): LaptopListing[] {
  return listings.filter((listing) => {
    if (listing.price < filters.minPrice || listing.price > filters.maxPrice) return false
    if (listing.hardExcluded && !filters.showHardExcluded) return false
    if (listing.workPerformance != null && listing.workPerformance < filters.minCombinedPower) return false
    if (listing.cpuMultiPower != null && listing.cpuMultiPower < filters.minCpuPower) return false
    if (listing.gpuPower != null && listing.gpuPower < filters.minGpuPower) return false
    if ((listing.ramGb ?? 0) < filters.minRamGb) return false
    if ((listing.vramGb ?? 0) < filters.minVramGb) return false
    if ((listing.storageGb ?? 0) < filters.minStorageGb) return false
    if (listing.screenInches != null && (listing.screenInches < filters.minScreenInches || listing.screenInches > filters.maxScreenInches)) return false
    if ((listing.sellerFeedbackPercent ?? 0) < filters.minSellerFeedback) return false
    if ((listing.sellerFeedbackScore ?? 0) < filters.minSellerFeedbackCount) return false
    if (filters.returnsRequired && listing.returnsAccepted !== true) return false
    if (filters.ukOnly && !/\b(?:GB|UK|United Kingdom)\b/i.test(listing.location)) return false
    if (!selected(filters.allowedConditions, listing.condition)) return false
    if (!selected(filters.allowedBrands, listing.brand)) return false
    if (!selected(filters.allowedCpuManufacturers, listing.cpuManufacturer)) return false
    if (!selected(filters.allowedGpuFamilies, listing.gpuFamily)) return false
    if (!selected(filters.allowedConfidence, listing.specConfidence)) return false
    if (filters.allowedBuyingOptions.size && !listing.buyingOptions.some((option) => filters.allowedBuyingOptions.has(option))) return false
    if (listing.riskFlags.some((risk) => filters.excludedRisks.has(risk))) return false
    return true
  })
}

export function partitionResults(
  listings: LaptopListing[],
  filters: LaptopFilters,
  query = '',
  now = new Date(),
) {
  const normalizedQuery = query.trim().toLowerCase()
  const search = (rows: LaptopListing[]) => normalizedQuery
    ? rows.filter((row) => `${row.title} ${row.cpuModel ?? ''} ${row.gpuModel ?? ''} ${row.brand ?? ''}`.toLowerCase().includes(normalizedQuery))
    : rows
  const searched = search(applyDashboardFilters(listings, filters))
  const matches = searched.filter((row) => assessBestBuy(row).eligible)
  const needsChecking = searched.filter((row) => !assessBestBuy(row).eligible)
  // Passes every floor with RAM relaxed to 32 GB, and is short of 64 GB. The
  // RAM filter is lowered for this set only: the chart's tier toggle is the control.
  const ram32Matches = search(applyDashboardFilters(listings, { ...filters, minRamGb: 32 }))
    .filter((row) => (row.ramGb ?? 0) < G16_REFERENCE.ramGb && assessBestBuy(row, { minRamGb: 32 }).eligible)
  const newMatches = matches.filter((row) => {
    if (!row.firstSeenAt) return false
    const age = now.getTime() - Date.parse(row.firstSeenAt)
    return age >= 0 && age <= 24 * 60 * 60 * 1000
  })

  return {
    matches,
    ram32Matches,
    newMatches,
    scored: matches,
    needsChecking,
    readiness: {
      ready: matches,
      specsIncomplete: needsChecking,
    },
  }
}

export interface ChartListing extends LaptopListing {
  plottedPrice: number
  priceCertainty: PriceCertainty
  plottedPower: number
  /** Advertised price less surplus RAM and storage credit — what value is measured against. */
  valuePrice: number
  surplusCredit: number
  ramTier: RamTier
  /** 0 at 64 GB; the kit price for a 32 GB machine; null when the RAM is soldered. */
  upgradeCost: number | null
}

export interface ChartTiers {
  ram64: LaptopListing[]
  ram32?: LaptopListing[]
}

export function buildChartModel(listings: LaptopListing[] | ChartTiers) {
  const tiers: ChartTiers = Array.isArray(listings) ? { ram64: listings } : listings
  const toPoints = (rows: LaptopListing[], ramTier: RamTier): ChartListing[] => rows.flatMap((listing) => {
    const plottedPower = listing.workPerformance
    if (plottedPower == null) return []
    const assessment = assessBestBuy(listing, { minRamGb: ramTier })
    return [{
      ...listing,
      plottedPrice: listing.price,
      priceCertainty: 'exact' as const,
      plottedPower,
      valuePrice: assessment.effectivePrice,
      surplusCredit: assessment.surplusCredit,
      ramTier,
      upgradeCost: ramUpgradeCost(listing),
    }]
  })
  const ram64Points = toPoints(tiers.ram64, 64)
  const ram32Points = toPoints(tiers.ram32 ?? [], 32)
  const points = [...ram32Points, ...ram64Points]
  const highest = Math.max(100, ...points.map((point) => point.plottedPower))
  const lowest = Math.min(100, ...points.map((point) => point.plottedPower))
  const yMinimum = Math.max(0, Math.floor((lowest - 15) / 10) * 10)
  const yMaximum = Math.ceil((highest + 12) / 10) * 10
  const frontierFor = (tierPoints: ChartListing[], minRamGb: RamTier) => bestBuyFrontier(tierPoints, { minRamGb })
    .map((point) => tierPoints.find((candidate) => candidate.id === point.id)!)
    .sort((a, b) => a.plottedPrice - b.plottedPrice)
  const frontier = frontierFor(ram64Points, 64)
  const frontier32 = frontierFor(ram32Points, 32)

  return {
    points,
    xDomain: [0, 3000] as [number, number],
    yDomain: [yMinimum, yMaximum] as [number, number],
    exactPointCount: points.length,
    lowerBoundPointCount: 0,
    ram64Count: ram64Points.length,
    ram32Count: ram32Points.length,
    frontierIds: new Set([...frontier, ...frontier32].map((point) => point.id)),
    frontier,
    frontier32,
  }
}
