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

interface EbayItemBody {
  itemEndDate?: string
  price?: { value?: string }
  estimatedAvailabilities?: Array<{ estimatedAvailabilityStatus?: string }>
}

/**
 * Reads a Browse API getItem response. An ended fixed-price listing can still
 * report IN_STOCK, so the end date is what decides it: on 28 September 2026 a
 * listing that sold at 16:58 came back IN_STOCK with itemEndDate 16:58.
 */
export function classifyItemResponse(httpStatus: number, body: EbayItemBody | null, now = new Date()): Omit<LiveStatus, 'id' | 'checkedAt'> {
  if (httpStatus === 404 || httpStatus === 410) return { state: 'ended' }
  if (httpStatus < 200 || httpStatus >= 300 || !body) return { state: 'unknown' }
  const price = body.price?.value == null ? undefined : Number(body.price.value)
  if (body.itemEndDate && Date.parse(body.itemEndDate) <= now.getTime()) {
    return { state: 'ended', endedAt: body.itemEndDate, price }
  }
  if (body.estimatedAvailabilities?.some((entry) => entry.estimatedAvailabilityStatus === 'OUT_OF_STOCK')) {
    return { state: 'ended', price }
  }
  return { state: 'live', price }
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
    if (response.status === 503 || response.status === 404) return 'unavailable'
    if (!response.ok) return { id, state: 'unknown', checkedAt: new Date().toISOString() }
    return await response.json() as LiveStatus
  } catch {
    return 'unavailable'
  }
}
