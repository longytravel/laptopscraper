import type { LaptopListing } from './types'

export function mergeSeenTimestamps(
  previous: LaptopListing[],
  current: LaptopListing[],
  now: string,
): LaptopListing[] {
  const prior = new Map(previous.map((listing) => [listing.id, listing]))
  return current.map((listing) => ({
    ...listing,
    firstSeenAt: prior.get(listing.id)?.firstSeenAt ?? now,
    lastSeenAt: now,
  }))
}

export function newEligibleIds(previousEligibleIds: Set<string>, current: LaptopListing[]): Set<string> {
  return new Set(current
    .filter((listing) => listing.bestBuyEligible && !previousEligibleIds.has(listing.id))
    .map((listing) => listing.id))
}

export function recentBestBuys(listings: LaptopListing[], now = new Date(), hours = 24): LaptopListing[] {
  const cutoff = now.getTime() - hours * 60 * 60 * 1000
  return listings.filter((listing) => listing.bestBuyEligible
    && listing.firstSeenAt != null
    && Date.parse(listing.firstSeenAt) >= cutoff
    && Date.parse(listing.firstSeenAt) <= now.getTime())
}
