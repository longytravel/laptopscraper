import 'dotenv/config'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'

const root = process.cwd()
const listingsPath = path.join(root, 'public', 'data', 'listings.json')
const outputPath = path.join(root, 'public', 'data', 'assessments.json')
const model = process.env.OPENAI_ASSESSMENT_MODEL || 'gpt-5-mini'

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function totalCost(listing) {
  return Number(listing.price ?? 0) + Number(listing.shippingPrice ?? 0)
}

function median(values) {
  const sorted = values.slice().sort((a, b) => a - b)
  if (!sorted.length) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function mediansBySearch(listings) {
  const groups = new Map()
  for (const listing of listings) {
    if (listing.excluded) continue
    const cost = totalCost(listing)
    if (cost <= 0) continue
    groups.set(listing.searchTerm, [...(groups.get(listing.searchTerm) ?? []), cost])
  }
  return new Map(Array.from(groups.entries()).map(([term, values]) => [term, median(values)]))
}

function extractItemIdFromUrl(url) {
  return url?.match(/\/itm\/(\d+)/)?.[1] ?? null
}

function listingMatchesId(listing, id) {
  return listing.sourceListingId?.includes(id) || extractItemIdFromUrl(listing.listingUrl) === id
}

function compactListing(listing, activeMedian) {
  const cost = totalCost(listing)
  return {
    source_listing_id: listing.sourceListingId,
    url: listing.listingUrl,
    search_term: listing.searchTerm,
    title: listing.title,
    description: listing.description,
    condition_description: listing.conditionDescription ?? null,
    item_specifics: listing.localizedAspects ?? listing.rawPayload?.localizedAspects ?? [],
    return_terms: listing.returnTerms ?? null,
    estimated_availabilities: listing.estimatedAvailabilities ?? [],
    detail_fetched: Boolean(listing.detailFetched),
    condition: listing.condition,
    seller: {
      name: listing.sellerName,
      feedback_score: listing.sellerFeedbackScore,
      feedback_percent: listing.sellerFeedbackPercent,
    },
    price: listing.price,
    shipping: listing.shippingPrice,
    total_buy_cost: cost,
    active_median_for_search: activeMedian,
    active_discount_percent: activeMedian ? Number((((activeMedian - cost) / activeMedian) * 100).toFixed(1)) : null,
    excluded_by_rules: listing.excluded,
    excluded_reason: listing.excludedReason,
    risk_flags_by_rules: listing.riskFlags ?? [],
    image_count: listing.imageUrls?.length ?? 0,
  }
}

async function assessListing(client, listing, activeMedian) {
  const payload = compactListing(listing, activeMedian)
  const response = await client.responses.create({
    model,
    input: [
      {
        role: 'system',
        content:
          'You assess used camera lens resale listings. Be skeptical. Pricing authority is sold comps, not your opinion. Explain why an active listing may be cheap, mis-matched, risky, or worth further review.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          task:
            'Assess this eBay active listing for resale arbitrage. Focus on exact identity, why it may be cheap, caveats in the title/condition, wrong-version risk, accessory-only risk, and what to verify before buying.',
          listing: payload,
          output_rules: [
            'Return JSON only.',
            'Do not mark strong buy without sold comps.',
            'If the title says read, untested, mold, fungus, spares, parts, faulty, or vague condition, raise risk.',
            'Differentiate old Sigma EX/DG/Macro/HSM/Art variants and Canon/Nikon/Sony/Fuji mounts.',
          ],
        }),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'lens_listing_assessment',
        strict: true,
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            source_listing_id: { type: 'string' },
            decision: { type: 'string', enum: ['review', 'avoid', 'needs_sold_comps'] },
            exact_identity: {
              type: 'object',
              additionalProperties: false,
              properties: {
                brand: { type: 'string' },
                model: { type: 'string' },
                mount: { type: 'string' },
                version_notes: { type: 'string' },
              },
              required: ['brand', 'model', 'mount', 'version_notes'],
            },
            why_it_may_be_cheap: { type: 'array', items: { type: 'string' } },
            risk_flags: { type: 'array', items: { type: 'string' } },
            positive_signals: { type: 'array', items: { type: 'string' } },
            verify_before_buying: { type: 'array', items: { type: 'string' } },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
            short_summary: { type: 'string' },
          },
          required: [
            'source_listing_id',
            'decision',
            'exact_identity',
            'why_it_may_be_cheap',
            'risk_flags',
            'positive_signals',
            'verify_before_buying',
            'confidence',
            'short_summary',
          ],
        },
      },
    },
  })
  return JSON.parse(response.output_text)
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY in .env.')
  }

  const itemId = argValue('--item-id')
  const minDiscount = Number(argValue('--min-discount', '20'))
  const limit = Number(argValue('--limit', '20'))
  const includeExcluded = hasFlag('--include-excluded')
  const data = JSON.parse(await readFile(listingsPath, 'utf8'))
  const listings = data.listings ?? []
  const medians = mediansBySearch(listings)

  let candidates
  if (itemId) {
    candidates = listings.filter((listing) => listingMatchesId(listing, itemId))
  } else {
    candidates = listings
      .map((listing) => {
        const activeMedian = medians.get(listing.searchTerm) ?? 0
        const discount = activeMedian ? ((activeMedian - totalCost(listing)) / activeMedian) * 100 : 0
        return { listing, activeMedian, discount }
      })
      .filter((row) => (includeExcluded || !row.listing.excluded) && row.discount >= minDiscount)
      .sort((a, b) => b.discount - a.discount || totalCost(a.listing) - totalCost(b.listing))
      .slice(0, limit)
      .map((row) => row.listing)
  }

  if (!candidates.length) {
    throw new Error(itemId ? `No downloaded listing matched item ID ${itemId}. Re-run collect or add this search term.` : 'No candidates matched.')
  }

  const client = new OpenAI()
  const assessments = []
  for (const [index, listing] of candidates.entries()) {
    const activeMedian = medians.get(listing.searchTerm) ?? totalCost(listing)
    console.log(`Assessing ${index + 1}/${candidates.length}: ${listing.title}`)
    assessments.push(await assessListing(client, listing, activeMedian))
  }

  const output = {
    generatedAt: new Date().toISOString(),
    model,
    count: assessments.length,
    assessments,
  }
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(output, null, 2))
  console.log(`Saved ${assessments.length} assessments to ${outputPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
