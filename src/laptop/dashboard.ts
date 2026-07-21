import { applyFilters, combinedPower, paretoFrontier } from './engine'
import type { LaptopFilters, LaptopListing } from './types'

export const SHORTLIST_STORAGE_KEY = 'laptop-power-finder-shortlist-v1'

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

export function partitionResults(listings: LaptopListing[], filters: LaptopFilters, query = '') {
  const normalizedQuery = query.trim().toLowerCase()
  const coordinated = applyFilters(listings, { ...filters, showNeedsChecking: true })
  const searched = normalizedQuery
    ? coordinated.filter((row) => `${row.title} ${row.cpuModel ?? ''} ${row.gpuModel ?? ''} ${row.brand ?? ''}`.toLowerCase().includes(normalizedQuery))
    : coordinated
  const needsChecking = searched.filter((row) => row.combinedPower == null || row.deliveredPrice == null)
  const scored = searched.filter((row) => row.combinedPower != null && row.deliveredPrice != null)
  return {
    matches: filters.showNeedsChecking ? searched : scored,
    scored,
    needsChecking,
  }
}

export interface ChartListing extends Omit<LaptopListing, 'deliveredPrice'> {
  deliveredPrice: number
  plottedPower: number
}

export function buildChartModel(listings: LaptopListing[], cpuWeight: number) {
  const points: ChartListing[] = listings.flatMap((listing) => {
    const plottedPower = combinedPower(listing.cpuPower, listing.gpuPower, cpuWeight)
    return plottedPower == null || listing.deliveredPrice == null ? [] : [{ ...listing, deliveredPrice: listing.deliveredPrice, plottedPower }]
  })
  const highest = Math.max(100, ...points.map((point) => point.plottedPower))
  const lowest = Math.min(100, ...points.map((point) => point.plottedPower))
  const yMinimum = Math.max(0, Math.floor((lowest - 15) / 10) * 10)
  const yMaximum = Math.ceil((highest + 12) / 10) * 10
  const frontier = paretoFrontier(points.map((point) => ({
    ...point,
    combinedPower: point.plottedPower,
  })))

  return {
    points,
    xDomain: [0, 3000] as [number, number],
    yDomain: [yMinimum, yMaximum] as [number, number],
    frontierIds: new Set(frontier.map((point) => point.id)),
    frontier: frontier.map((point) => ({ ...point, plottedPower: point.combinedPower })),
  }
}
