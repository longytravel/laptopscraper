import 'dotenv/config'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getEbayToken } from './ebay-auth.mjs'
import { exclusionReasonFromTextAndAspects, riskFlagsFromText } from './listing-classifier.mjs'

const root = process.cwd()
const listingsPath = path.join(root, 'public', 'data', 'listings.json')
const detailsPath = path.join(root, 'public', 'data', 'listings-enriched.json')

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getItemApiUrl(listing) {
  if (listing.rawPayload?.itemHref) return listing.rawPayload.itemHref
  return `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(listing.sourceListingId)}`
}

async function fetchDetail(token, marketplaceId, listing) {
  const response = await fetch(getItemApiUrl(listing), {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': marketplaceId,
    },
  })

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      error: await response.text(),
    }
  }

  return {
    ok: true,
    payload: await response.json(),
  }
}

function mergeDetail(listing, detailResult) {
  if (!detailResult.ok) {
    return {
      ...listing,
      detailFetched: false,
      detailError: {
        status: detailResult.status,
        message: detailResult.error,
      },
    }
  }

  const detail = detailResult.payload
  const description = detail.shortDescription ?? listing.description
  const localizedAspects = detail.localizedAspects ?? listing.rawPayload?.localizedAspects ?? []
  const excludedReason = exclusionReasonFromTextAndAspects(listing.title, description, localizedAspects)
  return {
    ...listing,
    description,
    conditionDescription: detail.conditionDescription ?? null,
    localizedAspects,
    returnTerms: detail.returnTerms ?? null,
    estimatedAvailabilities: detail.estimatedAvailabilities ?? [],
    buyingOptions: detail.buyingOptions ?? listing.rawPayload?.buyingOptions ?? [],
    detailFetched: true,
    detailFetchedAt: new Date().toISOString(),
    detailPayload: detail,
    excluded: Boolean(excludedReason),
    excludedReason,
    riskFlags: riskFlagsFromText(listing.title, description),
  }
}

async function main() {
  const input = JSON.parse(await readFile(listingsPath, 'utf8'))
  const marketplaceId = process.env.EBAY_MARKETPLACE_ID || input.marketplaceId || 'EBAY_GB'
  const token = await getEbayToken()
  const enriched = []

  for (const [index, listing] of (input.listings ?? []).entries()) {
    const result = await fetchDetail(token, marketplaceId, listing)
    enriched.push(mergeDetail(listing, result))
    const status = result.ok ? 'ok' : `failed ${result.status}`
    console.log(`${index + 1}/${input.listings.length} ${status}: ${listing.title}`)
    await sleep(40)
  }

  const output = {
    ...input,
    enrichedAt: new Date().toISOString(),
    enrichedCount: enriched.filter((listing) => listing.detailFetched).length,
    listings: enriched,
  }
  await writeFile(detailsPath, JSON.stringify(output, null, 2))
  await writeFile(listingsPath, JSON.stringify(output, null, 2))
  console.log(`Saved ${output.enrichedCount}/${output.listingCount} enriched listings to ${detailsPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
