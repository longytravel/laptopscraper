import { applyFilters, combinedPower, paretoFrontier } from './engine'
import type { LaptopFilters, LaptopListing } from './types'

export const SHORTLIST_STORAGE_KEY = 'laptop-power-finder-shortlist-v1'
export const BASELINE_PRICE = 1170
export const BASELINE_POWER = 100

export type ListingReadiness = 'ready' | 'postage-unknown' | 'specs-incomplete' | 'postage-and-specs'
export type PriceCertainty = 'exact' | 'lower-bound'
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
  return listings.slice().sort((a, b) =>
    (b.recommendationScore - a.recommendationScore)
    || ((b.valueIndex ?? -1) - (a.valueIndex ?? -1))
    || (b.sellerFeedbackPercent ?? 0) - (a.sellerFeedbackPercent ?? 0)
    || (a.deliveredPrice ?? Number.POSITIVE_INFINITY) - (b.deliveredPrice ?? Number.POSITIVE_INFINITY),
  )
}

export function classifyReadiness(listing: LaptopListing): ListingReadiness {
  const hasPower = listing.combinedPower != null
  const hasDeliveredPrice = listing.deliveredPrice != null
  if (hasPower && hasDeliveredPrice) return 'ready'
  if (hasPower) return 'postage-unknown'
  if (hasDeliveredPrice) return 'specs-incomplete'
  return 'postage-and-specs'
}

export function chartPrice(listing: LaptopListing): { price: number; certainty: PriceCertainty } {
  return listing.deliveredPrice == null
    ? { price: listing.price, certainty: 'lower-bound' }
    : { price: listing.deliveredPrice, certainty: 'exact' }
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function assessValue(power: number, price: number, certainty: PriceCertainty): ValueAssessment {
  const rawRatio = (power / price) / (BASELINE_POWER / BASELINE_PRICE)
  const ratio = round(rawRatio, 1)
  const percentage = Math.round(Math.abs(rawRatio - 1) * 100)
  const band: ValueBand = rawRatio >= 1.2 ? 'strong' : rawRatio >= 0.95 ? 'competitive' : 'weak'
  let label: string

  if (rawRatio >= 1.02) label = `${percentage}% better value than your G16`
  else if (rawRatio <= 0.98) label = `${percentage}% worse value than your G16`
  else label = 'Similar value to your G16'

  if (certainty === 'lower-bound') {
    label = rawRatio >= 0.98
      ? `Possibly ${label.charAt(0).toLowerCase()}${label.slice(1)}, before postage`
      : `${label}, before postage`
  }

  return { ratio, band, label }
}

export function buildRecommendationReason(listing: LaptopListing, cpuWeight: number): string {
  const power = combinedPower(listing.cpuPower, listing.gpuPower, cpuWeight)
  if (power == null) return `Power cannot be compared yet. Missing ${listing.missingSpecs.join(', ') || 'hardware details'}.`

  const { price, certainty } = chartPrice(listing)
  const parts = [assessValue(power, price, certainty).label]
  if (listing.ramGb != null) parts.push(`${listing.ramGb} GB RAM`)
  if (listing.returnsAccepted === true) parts.push('returns accepted')
  else if (listing.returnsAccepted === false) parts.push('no returns')

  let reason = `${parts.join(', ')}.`
  if (certainty === 'lower-bound') reason += ' Postage is unknown.'
  return reason
}

export function partitionResults(listings: LaptopListing[], filters: LaptopFilters, query = '') {
  const normalizedQuery = query.trim().toLowerCase()
  const coordinated = applyFilters(listings, { ...filters, showNeedsChecking: true })
  const searched = normalizedQuery
    ? coordinated.filter((row) => `${row.title} ${row.cpuModel ?? ''} ${row.gpuModel ?? ''} ${row.brand ?? ''}`.toLowerCase().includes(normalizedQuery))
    : coordinated
  const readiness = {
    ready: searched.filter((row) => classifyReadiness(row) === 'ready'),
    postageUnknown: searched.filter((row) => classifyReadiness(row) === 'postage-unknown'),
    specsIncomplete: searched.filter((row) => classifyReadiness(row) === 'specs-incomplete'),
    postageAndSpecs: searched.filter((row) => classifyReadiness(row) === 'postage-and-specs'),
  }
  const needsChecking = searched.filter((row) => classifyReadiness(row) !== 'ready')
  const scored = searched.filter((row) => row.combinedPower != null)
  return {
    matches: filters.showNeedsChecking ? searched : scored,
    scored,
    needsChecking,
    readiness,
  }
}

export interface ChartListing extends LaptopListing {
  plottedPrice: number
  priceCertainty: PriceCertainty
  plottedPower: number
}

export function buildChartModel(listings: LaptopListing[], cpuWeight: number) {
  const points: ChartListing[] = listings.flatMap((listing) => {
    const plottedPower = combinedPower(listing.cpuPower, listing.gpuPower, cpuWeight)
    if (plottedPower == null) return []
    const { price: plottedPrice, certainty: priceCertainty } = chartPrice(listing)
    return [{ ...listing, plottedPrice, priceCertainty, plottedPower }]
  })
  const highest = Math.max(100, ...points.map((point) => point.plottedPower))
  const lowest = Math.min(100, ...points.map((point) => point.plottedPower))
  const yMinimum = Math.max(0, Math.floor((lowest - 15) / 10) * 10)
  const yMaximum = Math.ceil((highest + 12) / 10) * 10
  const exactPoints = points.filter((point) => point.priceCertainty === 'exact')
  const frontier = paretoFrontier(exactPoints.map((point) => ({
    ...point,
    deliveredPrice: point.plottedPrice,
    combinedPower: point.plottedPower,
  })))

  return {
    points,
    xDomain: [0, 3000] as [number, number],
    yDomain: [yMinimum, yMaximum] as [number, number],
    exactPointCount: exactPoints.length,
    lowerBoundPointCount: points.length - exactPoints.length,
    frontierIds: new Set(frontier.map((point) => point.id)),
    frontier: frontier.map((point) => ({ ...point, plottedPrice: point.deliveredPrice, priceCertainty: 'exact' as const, plottedPower: point.combinedPower })),
  }
}
