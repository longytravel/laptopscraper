import { assessBestBuy, bestBuyFrontier, G16_REFERENCE, rankBestBuys } from './best-buy'
import type { LaptopFilters, LaptopListing } from './types'

export const SHORTLIST_STORAGE_KEY = 'laptop-power-finder-shortlist-v1'
export const BASELINE_PRICE = G16_REFERENCE.advertisedPrice
export const BASELINE_POWER = 100

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

export function rankListings(listings: LaptopListing[]): LaptopListing[] {
  return rankBestBuys(listings)
}

export function classifyReadiness(listing: LaptopListing): ListingReadiness {
  return assessBestBuy(listing).eligible ? 'ready' : 'specs-incomplete'
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

export function buildRecommendationReason(listing: LaptopListing): string {
  const assessment = assessBestBuy(listing)
  if (!assessment.eligible) return `Not a confirmed match. ${assessment.failures.join('; ') || 'Hardware evidence is incomplete'}.`

  const parts = [
    `Multi-core ${signedPercent(listing.cpuMultiPower)} and single-thread ${signedPercent(listing.cpuSinglePower)}`,
    `work performance ${signedPercent(assessment.workPerformance)}`,
    assessValue(assessment.workPerformance!, assessment.effectivePrice).label,
    `${listing.ramGb} GB RAM`,
  ]
  if (assessment.surplusCredit > 0) {
    parts.push(`£${Math.round(assessment.surplusCredit)} credited for surplus RAM and storage`)
  }
  if (listing.returnsAccepted === true) parts.push('returns accepted')
  else if (listing.returnsAccepted === false) parts.push('no returns')
  return `${parts.join(', ')}.`
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
  const coordinated = applyDashboardFilters(listings, filters)
  const searched = normalizedQuery
    ? coordinated.filter((row) => `${row.title} ${row.cpuModel ?? ''} ${row.gpuModel ?? ''} ${row.brand ?? ''}`.toLowerCase().includes(normalizedQuery))
    : coordinated
  const matches = searched.filter((row) => assessBestBuy(row).eligible)
  const needsChecking = searched.filter((row) => !assessBestBuy(row).eligible)
  const newMatches = matches.filter((row) => {
    if (!row.firstSeenAt) return false
    const age = now.getTime() - Date.parse(row.firstSeenAt)
    return age >= 0 && age <= 24 * 60 * 60 * 1000
  })

  return {
    matches,
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
}

export function buildChartModel(listings: LaptopListing[]) {
  const points: ChartListing[] = listings.flatMap((listing) => {
    const plottedPower = listing.workPerformance
    if (plottedPower == null) return []
    const assessment = assessBestBuy(listing)
    return [{
      ...listing,
      plottedPrice: listing.price,
      priceCertainty: 'exact' as const,
      plottedPower,
      valuePrice: assessment.effectivePrice,
      surplusCredit: assessment.surplusCredit,
    }]
  })
  const highest = Math.max(100, ...points.map((point) => point.plottedPower))
  const lowest = Math.min(100, ...points.map((point) => point.plottedPower))
  const yMinimum = Math.max(0, Math.floor((lowest - 15) / 10) * 10)
  const yMaximum = Math.ceil((highest + 12) / 10) * 10
  const frontier = bestBuyFrontier(points)

  return {
    points,
    xDomain: [0, 3000] as [number, number],
    yDomain: [yMinimum, yMaximum] as [number, number],
    exactPointCount: points.length,
    lowerBoundPointCount: 0,
    frontierIds: new Set(frontier.map((point) => point.id)),
    frontier: frontier.map((point) => ({
      ...point,
      plottedPrice: point.price,
      priceCertainty: 'exact' as const,
      plottedPower: point.workPerformance!,
      valuePrice: assessBestBuy(point).effectivePrice,
      surplusCredit: assessBestBuy(point).surplusCredit,
    })),
  }
}
