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
  shippingOptions?: Array<{ shippingCost?: { value?: string; currency?: string } }>
  seller?: { username?: string; feedbackScore?: number; feedbackPercentage?: string }
  itemLocation?: { city?: string; country?: string }
  image?: { imageUrl?: string }
  additionalImages?: Array<{ imageUrl?: string }>
  localizedAspects?: Array<{ name?: string; value?: string }>
  buyingOptions?: string[]
  returnTerms?: { returnsAccepted?: boolean }
  itemCreationDate?: string
  searchTerm?: string
  searchTerms?: string[]
}

export interface SearchRun {
  searchTerm: string
  returned: number
  total: number
  error?: string
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
      const transient = response.status === 429 || response.status >= 500
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
  const shipping = item.shippingOptions?.[0]?.shippingCost?.value
  const seller = item.seller ?? {}
  const location = item.itemLocation ?? {}
  const imageUrls = [item.image?.imageUrl, ...(item.additionalImages ?? []).map((image) => image.imageUrl)].filter(Boolean) as string[]
  return {
    sourceListingId: item.itemId ?? '',
    title: item.title ?? '',
    description: item.shortDescription ?? '',
    conditionDescription: item.conditionDescription ?? '',
    price: Number(item.price?.value ?? 0),
    shippingPrice: Number(shipping ?? 0),
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
}): Promise<{ items: Array<EbaySearchItem & { searchTerms: string[] }>; runs: SearchRun[] }> {
  const fetchImpl = options.fetchImpl ?? fetch
  const perSearchLimit = options.perSearchLimit ?? 80
  const items: EbaySearchItem[] = []
  const runs: SearchRun[] = []

  for (const searchTerm of options.searchTerms) {
    try {
      const params = buildSearchParams(searchTerm, perSearchLimit, 0)
      const payload = await fetchJsonWithRetry<{ total?: number; itemSummaries?: EbaySearchItem[] }>(
        fetchImpl,
        `${SEARCH_URL}?${params}`,
        {
          headers: {
            Authorization: `Bearer ${options.token}`,
            'X-EBAY-C-MARKETPLACE-ID': options.marketplaceId,
          },
        },
        { retries: options.retries },
      )
      const returned = payload.itemSummaries ?? []
      items.push(...returned.map((item) => ({ ...item, searchTerm })))
      runs.push({ searchTerm, returned: returned.length, total: payload.total ?? returned.length })
    } catch (error) {
      runs.push({ searchTerm, returned: 0, total: 0, error: error instanceof Error ? error.message : String(error) })
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
        const detail = await fetchJsonWithRetry<EbaySearchItem>(fetchImpl, detailUrl, {
          headers: {
            Authorization: `Bearer ${options.token}`,
            'X-EBAY-C-MARKETPLACE-ID': options.marketplaceId,
          },
        })
        bucket.push({ ...item, ...detail, searchTerms: item.searchTerms })
      } catch (error) {
        bucket.push({ ...item, detailError: error instanceof Error ? error.message : String(error) })
      }
    }
  }))

  return output.flat()
}
