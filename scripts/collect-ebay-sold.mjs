import 'dotenv/config'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import YAML from 'yaml'
import { getEbayToken } from './ebay-auth.mjs'

const root = process.cwd()
const outputPath = path.join(root, 'public', 'data', 'sold-comps.json')
const rawPath = path.join(root, 'data', 'ebay-sold-comps-raw.json')

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}

async function loadConfig() {
  const text = await readFile(path.join(root, 'config.yaml'), 'utf8')
  return YAML.parse(text)
}

function normalizeSoldItem(item, searchTerm) {
  const soldPrice = Number(item.price?.value ?? item.itemSoldPrice?.value ?? 0)
  const shippingPrice = Number(item.shippingOptions?.[0]?.shippingCost?.value ?? 0)
  return {
    source: 'ebay-marketplace-insights',
    searchTerm,
    soldItemId: item.itemId ?? item.legacyItemId ?? '',
    soldUrl: item.itemWebUrl ?? '',
    title: item.title ?? '',
    price: soldPrice,
    shippingPrice,
    totalSoldValue: soldPrice + shippingPrice,
    currency: item.price?.currency ?? item.itemSoldPrice?.currency ?? 'GBP',
    condition: item.condition ?? '',
    soldDate: item.itemEndDate ?? item.dateSold ?? item.lastSoldDate ?? null,
    sellerName: item.seller?.username ?? '',
    sellerFeedbackScore: item.seller?.feedbackScore ?? null,
    sellerFeedbackPercent: item.seller?.feedbackPercentage ? Number(item.seller.feedbackPercentage) : null,
    imageUrl: item.image?.imageUrl ?? null,
    rawPayload: item,
  }
}

async function searchSold(token, marketplaceId, searchTerm, limit) {
  const params = new URLSearchParams({
    q: searchTerm,
    limit: String(Math.min(limit, 200)),
    filter: 'conditions:{USED},priceCurrency:GBP',
  })
  const response = await fetch(`https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
    },
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { rawText: text }
  }
  if (!response.ok) {
    return { ok: false, status: response.status, error: json ?? text }
  }
  return { ok: true, payload: json }
}

async function main() {
  const config = await loadConfig()
  const token = await getEbayToken()
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || config.sources.ebay.marketplace_id || 'EBAY_GB'
  const searchArg = argValue('--search')
  const searches = searchArg ? [searchArg] : config.searches
  const limit = Number(argValue('--limit', '100'))
  const comps = []
  const rawRuns = []
  const errors = []

  for (const searchTerm of searches) {
    const result = await searchSold(token, marketplaceId, searchTerm, limit)
    if (!result.ok) {
      console.log(`${searchTerm}: sold API failed ${result.status}`)
      errors.push({ searchTerm, status: result.status, error: result.error })
      rawRuns.push({ searchTerm, ok: false, status: result.status, error: result.error })
      continue
    }
    const items = result.payload?.itemSales ?? result.payload?.itemSummaries ?? []
    const normalized = items.map((item) => normalizeSoldItem(item, searchTerm))
    comps.push(...normalized)
    rawRuns.push({ searchTerm, ok: true, total: result.payload?.total ?? items.length, returned: items.length, payload: result.payload })
    console.log(`${searchTerm}: ${items.length} sold comps`)
  }

  const output = {
    generatedAt: new Date().toISOString(),
    source: 'ebay-marketplace-insights',
    marketplaceId,
    soldCompCount: comps.length,
    errors,
    comps,
    note: errors.length ? 'Marketplace Insights is limited-release; errors may mean this eBay account is not approved.' : '',
  }
  await mkdir(path.dirname(outputPath), { recursive: true })
  await mkdir(path.dirname(rawPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(output, null, 2))
  await writeFile(rawPath, JSON.stringify({ generatedAt: output.generatedAt, rawRuns }, null, 2))
  console.log(`Saved ${comps.length} sold comps to ${outputPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
