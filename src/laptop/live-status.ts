/**
 * Whether a plotted listing is still for sale right now. The dataset is a
 * snapshot taken twice a day (and GitHub often starts those runs hours late),
 * so a laptop can sell long before the next refresh drops it. The dashboard
 * asks /api/listing-status about each plotted listing when it opens and hides
 * the ones eBay says have ended.
 */
export type LiveState = 'live' | 'ended' | 'unknown'

export interface LiveStatus {
  id: string
  state: LiveState
  /** Current asking price when eBay reports one. */
  price?: number
  endedAt?: string
  checkedAt: string
}

export type StatusFetcher = (id: string) => Promise<LiveStatus | 'unavailable'>

/**
 * Checks listings a few at a time. Stops early when the endpoint reports it is
 * unavailable (no eBay credentials on the server, or the quota is spent), so a
 * misconfiguration costs one request, not one per listing.
 */
export async function checkListings(
  ids: string[],
  fetcher: StatusFetcher,
  onBatch: (results: LiveStatus[]) => void,
  concurrency = 6,
): Promise<'done' | 'unavailable'> {
  const queue = [...ids]
  let unavailable = false
  let pending: LiveStatus[] = []

  async function worker() {
    while (queue.length && !unavailable) {
      const id = queue.shift()!
      const result = await fetcher(id)
      if (result === 'unavailable') {
        unavailable = true
        return
      }
      pending.push(result)
      if (pending.length >= 12) {
        onBatch(pending)
        pending = []
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, ids.length) }, worker))
  if (pending.length) onBatch(pending)
  return unavailable ? 'unavailable' : 'done'
}

export async function fetchListingStatus(id: string): Promise<LiveStatus | 'unavailable'> {
  try {
    const response = await fetch(`/api/listing-status?id=${encodeURIComponent(id)}`)
    // 404: no function deployed (local preview). 5xx: not configured, quota
    // spent or the function failed. All mean stop asking, not "unknown" per dot.
    if (response.status === 404 || response.status >= 500) return 'unavailable'
    if (!response.ok) return { id, state: 'unknown', checkedAt: new Date().toISOString() }
    return await response.json() as LiveStatus
  } catch {
    return 'unavailable'
  }
}
