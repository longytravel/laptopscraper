import 'dotenv/config'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import YAML from 'yaml'
import { getEbayToken } from './ebay-auth.mjs'
import { exclusionReasonFromTextAndAspects, riskFlagsFromText } from './listing-classifier.mjs'

const root = process.cwd()
const outputPath = path.join(root, 'public', 'data', 'listings.json')
const rawPath = path.join(root, 'data', 'ebay-active-listings.json')

async function loadConfig() {
  const text = await readFile(path.join(root, 'config.yaml'), 'utf8')
  return YAML.parse(text)
}

async function searchEbay(token, marketplaceId, searchTerm, limit) {
  const params = new URLSearchParams({
    q: searchTerm,
    limit: String(Math.min(limit, 200)),
    filter: 'conditions:{USED},priceCurrency:GBP',
    fieldgroups: 'EXTENDED',
  })

  const response = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
    },
  })

  if (!response.ok) {
    throw new Error(`eBay Browse search failed for "${searchTerm}": ${response.status} ${await response.text()}`)
  }

  return response.json()
}

function normalizeItem(item, searchTerm) {
  const title = item.title ?? ''
  const description = item.shortDescription ?? ''
  const haystack = `${title} ${description}`.toLowerCase()
  const excludedReason = exclusionReasonFromTextAndAspects(title, description, item.localizedAspects ?? [])
  const shippingCost = item.shippingOptions?.[0]?.shippingCost?.value
  const location = item.itemLocation ?? {}
  const seller = item.seller ?? {}
  const imageUrls = [
    item.image?.imageUrl,
    ...(item.additionalImages ?? []).map((image) => image.imageUrl),
  ].filter(Boolean)

  return {
    source: 'ebay',
    searchTerm,
    sourceListingId: item.itemId,
    listingUrl: item.itemWebUrl,
    title,
    description,
    price: Number(item.price?.value ?? 0),
    shippingPrice: Number(shippingCost ?? 0),
    currency: item.price?.currency ?? 'GBP',
    condition: item.condition ?? '',
    sellerName: seller.username ?? '',
    sellerFeedbackScore: seller.feedbackScore ?? null,
    sellerFeedbackPercent: seller.feedbackPercentage ? Number(seller.feedbackPercentage) : null,
    location: [location.city, location.country].filter(Boolean).join(', '),
    category: item.categories?.[0]?.categoryName ?? '',
    imageUrls,
    listedAt: item.itemCreationDate ?? null,
    scrapedAt: new Date().toISOString(),
    listingStatus: 'active',
    excluded: Boolean(excludedReason),
    excludedReason,
    riskFlags: riskFlagsFromText(title, description),
    rawPayload: item,
  }
}

async function main() {
  const config = await loadConfig()
  const token = await getEbayToken()
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || config.sources.ebay.marketplace_id || 'EBAY_GB'
  const limit = Number(config.sources.ebay.active_limit_per_search ?? 50)
  const listings = []
  const rawRuns = []

  for (const searchTerm of config.searches) {
    const payload = await searchEbay(token, marketplaceId, searchTerm, limit)
    const items = payload.itemSummaries ?? []
    listings.push(...items.map((item) => normalizeItem(item, searchTerm)))
    rawRuns.push({ searchTerm, total: payload.total ?? items.length, returned: items.length, payload })
    console.log(`${searchTerm}: ${items.length} active listings`)
  }

  listings.sort((a, b) => a.price + a.shippingPrice - (b.price + b.shippingPrice))
  const output = {
    generatedAt: new Date().toISOString(),
    marketplaceId,
    listingCount: listings.length,
    listings,
    note: 'Real eBay Browse API active listings. Sold comps require Marketplace Insights access or another compliant source.',
  }

  await mkdir(path.dirname(outputPath), { recursive: true })
  await mkdir(path.dirname(rawPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(output, null, 2))
  await writeFile(rawPath, JSON.stringify({ generatedAt: output.generatedAt, rawRuns }, null, 2))
  console.log(`Saved ${listings.length} listings to ${outputPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
