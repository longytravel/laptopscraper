import type { LaptopListing } from './types'

/**
 * Item ID to the first time any run saw it. Kept apart from the dataset
 * because eBay's search results fluctuate: a listing missing from one run's
 * results drops out of the dataset, and without this record it came back
 * looking brand new — a false NEW badge and a repeat Telegram announcement.
 */
export type FirstSeenHistory = Record<string, string>

export function mergeSeenTimestamps(
  previous: LaptopListing[],
  current: LaptopListing[],
  now: string,
  history: FirstSeenHistory = {},
): LaptopListing[] {
  const prior = new Map(previous.map((listing) => [listing.id, listing]))
  return current.map((listing) => ({
    ...listing,
    firstSeenAt: history[listing.id] ?? prior.get(listing.id)?.firstSeenAt ?? now,
    lastSeenAt: now,
  }))
}

/** Adds every listing's first-seen time to the history, keeping the earliest. */
export function updateFirstSeenHistory(history: FirstSeenHistory, listings: LaptopListing[]): FirstSeenHistory {
  const next = { ...history }
  for (const listing of listings) {
    if (!listing.firstSeenAt) continue
    const known = next[listing.id]
    if (!known || Date.parse(listing.firstSeenAt) < Date.parse(known)) next[listing.id] = listing.firstSeenAt
  }
  return next
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
