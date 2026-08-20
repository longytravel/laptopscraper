import type { RawLaptopListing } from '../src/laptop/types'

const SEARCH_URL = 'https://api.ebay.com/buy/browse/v1/item_summary/search'
const TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token'

export interface EbaySearchItem extends Record<string, unknown> {
  itemId?: string
  itemHref?: string
  itemWebUrl?: string
  title?: string
  shortDescription?: string
  conditionDescription?: string
  condition?: string
  price?: { value?: string; currency?: string }
  shippingOptions?: Array<{
    type?: string
    shippingServiceCode?: string
    shippingCarrierCode?: string
    shippingCost?: { value?: string; currency?: string }
  }>
  seller?: { username?: string; feedbackScore?: number; feedbackPercentage?: string }
  itemLocation?: { city?: string; country?: string }
  image?: { imageUrl?: string }
  additionalImages?: Array<{ imageUrl?: string }>
  localizedAspects?: Array<{ name?: string; value?: string }>
  buyingOptions?: string[]
  returnTerms?: { returnsAccepted?: boolean }
  itemCreationDate?: string
  categories?: Array<{ categoryId?: string; categoryName?: string }>
  searchTerm?: string
  searchTerms?: string[]
}

export interface SearchRun {
  searchTerm: string
  returned: number
  total: number
  error?: string
  transient?: boolean
}

export function canUseCachedSearchFallback(runs: SearchRun[]): boolean {
  const failures = runs.filter((run) => run.error)
  return failures.length > 0 && failures.every((run) => run.transient === true)
}

export function isUsableCachedDataset(value: unknown, now = Date.now(), maxAgeHours = 72): boolean {
  if (!value || typeof value !== 'object') return false
  const dataset = value as { generatedAt?: unknown; listingCount?: unknown; listings?: unknown }
  if (typeof dataset.generatedAt !== 'string' || typeof dataset.listingCount !== 'number' || !Array.isArray(dataset.listings)) return false
  if (dataset.listingCount <= 0 || dataset.listings.length <= 0) return false
  const generatedAt = Date.parse(dataset.generatedAt)
  return Number.isFinite(generatedAt) && now >= generatedAt && now - generatedAt <= maxAgeHours * 60 * 60 * 1000
}

export function isTransientEbayFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  if (/HTTP\s+(?:429|5\d\d)\b/i.test(message)) return true
  if (/HTTP\s+(?:400|401|403|404|422)\b/i.test(message)) return false
  return /(?:fetch failed|network|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket|temporar)/i.test(message)
}

export function buildSearchParams(searchTerm: string, limit = 80, offset = 0): URLSearchParams {
  return new URLSearchParams({
    q: searchTerm,
    category_ids: '177',
    limit: String(Math.max(1, Math.min(200, limit))),
    offset: String(Math.max(0, offset)),
    filter: 'price:[0..3000],priceCurrency:GBP,deliveryCountry:GB',
    fieldgroups: 'EXTENDED',
  })
}

export async function fetchJsonWithRetry<T>(
  fetchImpl: typeof fetch,
  input: string,
  init: RequestInit = {},
  options: { retries?: number; sleep?: (milliseconds: number) => Promise<void> } = {},
): Promise<T> {
  const retries = options.retries ?? 2
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  let lastError: Error | null = null

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(input, init)
      if (response.ok) return await response.json() as T
      const body = (await response.text()).slice(0, 500)
      const error = new Error(`eBay request failed with HTTP ${response.status}: ${body}`)
      // errorId 2001 is the daily call-quota being spent, not burst throttling.
      // It cannot recover inside this run, and every retry spends another call
      // from the quota that the next run needs, so fail straight away.
      const quotaExhausted = response.status === 429 && /"errorId"\s*:\s*2001\b/.test(body)
      const transient = !quotaExhausted && (response.status === 429 || response.status >= 500)
      if (!transient || attempt === retries) throw error
      const retryAfter = Number(response.headers.get('Retry-After'))
      const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 250 * 2 ** attempt
      await sleep(delay)
      lastError = error
    } catch (error) {
      if (error instanceof Error && /^eBay request failed/.test(error.message)) throw error
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt === retries) throw new Error(`eBay request failed: ${lastError.message}`, { cause: error })
      await sleep(250 * 2 ** attempt)
    }
  }

  throw lastError ?? new Error('eBay request failed')
}

export async function getEbayAppToken(
  clientId: string,
  clientSecret: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  if (!clientId || !clientSecret) throw new Error('Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET')
  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
  const payload = await fetchJsonWithRetry<{ access_token?: string }>(fetchImpl, TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  })
  if (!payload.access_token) throw new Error('eBay OAuth response did not contain an access token')
  return payload.access_token
}

const RATE_LIMIT_URL = 'https://api.ebay.com/developer/analytics/v1_beta/rate_limit/?api_context=buy'

/**
 * Calls left today on the Browse resource, or null when eBay will not say.
 * Both scheduled runs share one 5,000/day allowance that resets at 07:00 UTC,
 * so the collector sizes its detail fetching against whatever is actually left
 * rather than a fixed guess.
 */
export async function getBrowseCallsRemaining(options: {
  token: string
  fetchImpl?: typeof fetch
}): Promise<number | null> {
  try {
    const response = await (options.fetchImpl ?? fetch)(RATE_LIMIT_URL, {
      headers: { Authorization: `Bearer ${options.token}` },
    })
    if (!response.ok) return null
    const payload = await response.json() as {
      rateLimits?: Array<{ resources?: Array<{ name?: string; rates?: Array<{ remaining?: number }> }> }>
    }
    for (const limit of payload.rateLimits ?? []) {
      for (const resource of limit.resources ?? []) {
        if (resource.name !== 'buy.browse') continue
        for (const rate of resource.rates ?? []) {
          if (typeof rate.remaining === 'number') return rate.remaining
        }
      }
    }
    return null
  } catch {
    return null
  }
}

export function deduplicateItems(items: EbaySearchItem[]): Array<EbaySearchItem & { searchTerms: string[] }> {
  const byId = new Map<string, EbaySearchItem & { searchTerms: string[] }>()
  for (const item of items) {
    const id = item.itemId ?? item.itemWebUrl ?? item.title
    if (!id) continue
    const term = item.searchTerm
    const existing = byId.get(id)
    if (existing) {
      if (term && !existing.searchTerms.includes(term)) existing.searchTerms.push(term)
      continue
    }
    byId.set(id, { ...item, searchTerms: [...new Set([...(item.searchTerms ?? []), ...(term ? [term] : [])])] })
  }
  return [...byId.values()]
}

export function normalizeEbayItem(item: EbaySearchItem): RawLaptopListing {
  const shipping = (item.shippingOptions ?? [])
    .filter((option) => !/\b(?:pickup|pick\s*up|click\s*(?:and|&)\s*collect|collection)\b/i.test(`${option.type ?? ''} ${option.shippingServiceCode ?? ''} ${option.shippingCarrierCode ?? ''}`))
    .map((option) => option.shippingCost?.value)
    .filter((value): value is string => value != null && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0)
    .map(Number)
    .sort((a, b) => a - b)[0]
  const seller = item.seller ?? {}
  const location = item.itemLocation ?? {}
  const imageUrls = [item.image?.imageUrl, ...(item.additionalImages ?? []).map((image) => image.imageUrl)].filter(Boolean) as string[]
  return {
    sourceListingId: item.itemId ?? '',
    title: item.title ?? '',
    description: item.shortDescription ?? '',
    conditionDescription: item.conditionDescription ?? '',
    categoryId: item.categories?.find((category) => category.categoryId)?.categoryId,
    price: Number(item.price?.value ?? 0),
    shippingPrice: shipping ?? null,
    currency: item.price?.currency ?? 'GBP',
    condition: item.condition ?? 'Unknown',
    sellerName: seller.username ?? 'Unknown seller',
    sellerFeedbackScore: seller.feedbackScore ?? null,
    sellerFeedbackPercent: seller.feedbackPercentage == null ? null : Number(seller.feedbackPercentage),
    listingUrl: item.itemWebUrl ?? '',
    location: [location.city, location.country].filter(Boolean).join(', '),
    imageUrls,
    localizedAspects: item.localizedAspects ?? [],
    buyingOptions: item.buyingOptions ?? [],
    returnTerms: item.returnTerms ?? null,
    listedAt: item.itemCreationDate ?? null,
    scrapedAt: new Date().toISOString(),
    searchTerms: item.searchTerms ?? (item.searchTerm ? [item.searchTerm] : []),
    rawPayload: item,
  }
}

export async function collectSearches(options: {
  token: string
  marketplaceId: string
  searchTerms: string[]
  fetchImpl?: typeof fetch
  perSearchLimit?: number
  retries?: number
  deliveryPostalCode?: string
}): Promise<{ items: Array<EbaySearchItem & { searchTerms: string[] }>; runs: SearchRun[] }> {
  const fetchImpl = options.fetchImpl ?? fetch
  const perSearchLimit = options.perSearchLimit ?? 80
  const items: EbaySearchItem[] = []
  const runs: SearchRun[] = []

  for (const searchTerm of options.searchTerms) {
    const collected: EbaySearchItem[] = []
    let total = 0
    try {
      let offset = 0
      let nextUrl: string | null = null
      while (collected.length < perSearchLimit) {
        const pageLimit = Math.min(200, perSearchLimit - collected.length)
        const params = buildSearchParams(searchTerm, pageLimit, offset)
        const headers: Record<string, string> = {
          Authorization: `Bearer ${options.token}`,
          'X-EBAY-C-MARKETPLACE-ID': options.marketplaceId,
        }
        if (options.deliveryPostalCode) {
          headers['X-EBAY-C-ENDUSERCTX'] = `contextualLocation=country%3DGB%2Czip%3D${encodeURIComponent(options.deliveryPostalCode)}`
        }
        const payload = await fetchJsonWithRetry<{ total?: number; next?: string; itemSummaries?: EbaySearchItem[] }>(
          fetchImpl,
          nextUrl ?? `${SEARCH_URL}?${params}`,
          { headers },
          { retries: options.retries },
        )
        const page = payload.itemSummaries ?? []
        total = payload.total ?? page.length
        collected.push(...page.slice(0, pageLimit))
        offset += page.length
        nextUrl = payload.next ?? null
        if (page.length === 0 || (!nextUrl && offset >= total)) break
      }
      items.push(...collected.map((item) => ({ ...item, searchTerm })))
      runs.push({ searchTerm, returned: collected.length, total })
    } catch (error) {
      items.push(...collected.map((item) => ({ ...item, searchTerm })))
      runs.push({ searchTerm, returned: collected.length, total, error: error instanceof Error ? error.message : String(error), transient: isTransientEbayFailure(error) })
    }
  }

  return { items: deduplicateItems(items), runs }
}

export async function enrichEbayItems(options: {
  items: Array<EbaySearchItem & { searchTerms: string[] }>
  token: string
  marketplaceId: string
  fetchImpl?: typeof fetch
  concurrency?: number
  deliveryPostalCode?: string
}): Promise<Array<EbaySearchItem & { searchTerms: string[]; detailError?: string }>> {
  const fetchImpl = options.fetchImpl ?? fetch
  const concurrency = Math.max(1, options.concurrency ?? 6)
  const output = new Array<Array<EbaySearchItem & { searchTerms: string[]; detailError?: string }>>(concurrency).fill(null).map(() => [])
  let cursor = 0

  await Promise.all(output.map(async (bucket) => {
    while (true) {
      const index = cursor
      cursor += 1
      const item = options.items[index]
      if (!item) break
      const detailUrl = item.itemHref ?? `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(item.itemId ?? '')}`
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${options.token}`,
          'X-EBAY-C-MARKETPLACE-ID': options.marketplaceId,
        }
        if (options.deliveryPostalCode) {
          headers['X-EBAY-C-ENDUSERCTX'] = `contextualLocation=country%3DGB%2Czip%3D${encodeURIComponent(options.deliveryPostalCode)}`
        }
        const detail = await fetchJsonWithRetry<EbaySearchItem>(fetchImpl, detailUrl, {
          headers,
        })
        bucket.push({ ...item, ...detail, searchTerms: item.searchTerms })
      } catch (error) {
        bucket.push({ ...item, detailError: error instanceof Error ? error.message : String(error) })
      }
    }
  }))

  return output.flat()
}
