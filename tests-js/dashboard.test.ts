import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultFilters, enrichListing } from '../src/laptop/engine'
import {
  assessValue,
  buildChartModel,
  buildRecommendationReason,
  chartPrice,
  classifyReadiness,
  deriveFacets,
  parseShortlist,
  partitionResults,
  rankListings,
  serializeShortlist,
  toggleSelection,
} from '../src/laptop/dashboard.ts'
import type { LaptopListing } from '../src/laptop/types.ts'

function listing(id: string, price: number, overrides: Partial<LaptopListing> = {}): LaptopListing {
  const row = enrichListing({
    sourceListingId: id,
    title: `ASUS ${id} i9-14900HX RTX 4060 64GB RAM 1TB SSD`,
    price,
    shippingPrice: 0,
    condition: 'Used',
    sellerFeedbackPercent: 99.5,
    sellerFeedbackScore: 500,
    returnTerms: { returnsAccepted: true },
  })
  return {
    ...row,
    cpuMultiPower: 100,
    cpuSinglePower: 100,
    workPerformance: 100,
    workValue: 1170 / price,
    benchmarkEvidenceAt: '2026-07-22T08:00:00Z',
    ...overrides,
  }
}

test('shortlist storage round-trips, rejects malformed input and toggles immutably', () => {
  const original = new Set(['one'])
  const added = toggleSelection(original, 'two')

  assert.deepEqual(parseShortlist(serializeShortlist(added)), added)
  assert.deepEqual(parseShortlist('{broken'), new Set())
  assert.deepEqual(parseShortlist('[1, null]'), new Set())
  assert.deepEqual(original, new Set(['one']))
  assert.deepEqual(toggleSelection(added, 'one'), new Set(['two']))
})

test('derives stable condition, brand, CPU and GPU facet options', () => {
  const rows = [
    listing('one', 1800, { gpuModel: 'NVIDIA GeForce RTX 4080 Laptop GPU' }),
    { ...listing('two', 2200), brand: 'Lenovo', cpuManufacturer: 'AMD' },
  ]
  const facets = deriveFacets(rows)

  assert.deepEqual(facets.conditions, ['Used'])
  assert.deepEqual(facets.brands, ['ASUS', 'Lenovo'])
  assert.deepEqual(facets.cpuManufacturers, ['AMD', 'Intel'])
})

test('chart plots advertised price against backtesting work and identifies the frontier', () => {
  const rows = [
    listing('a', 1000),
    listing('b', 1300, { cpuMultiPower: 130, cpuSinglePower: 100, workPerformance: 120 }),
    listing('c', 1500),
  ]
  const model = buildChartModel(rows)

  assert.deepEqual(model.xDomain, [0, 3000])
  assert.equal(model.points.find((row) => row.id === 'b')?.plottedPower, 120)
  assert.deepEqual(model.frontierIds, new Set(['a', 'b']))
})

test('recommended ranking delegates to eligible best-buy value order', () => {
  const betterValue = listing('better-value', 1000)
  const worseValue = listing('worse-value', 1500, { sellerFeedbackPercent: 100 })

  assert.deepEqual(rankListings([worseValue, betterValue]).map((row) => row.id), ['better-value'])
})

test('dashboard filtering uses advertised price and retains seller, returns and risk controls', () => {
  const matching = listing('match', 900, { shippingPrice: 2000, deliveredPrice: 2900, sellerFeedbackPercent: 100 })
  const wrongSeller = listing('wrong', 800, { sellerFeedbackPercent: 90, returnsAccepted: false })
  const filters = {
    ...createDefaultFilters(),
    minSellerFeedback: 99,
    returnsRequired: true,
    maxPrice: 1000,
  }

  assert.deepEqual(partitionResults([matching, wrongSeller], filters).matches.map((row) => row.id), ['match'])
})

test('chart and value always use advertised price regardless of postage', () => {
  const row = listing('advertised', 1000, { shippingPrice: 900, deliveredPrice: 1900, workPerformance: 120 })

  assert.deepEqual(chartPrice(row), { price: 1000, certainty: 'exact' })
  assert.equal(buildChartModel([row]).points[0].plottedPrice, 1000)
  assert.equal(buildChartModel([row]).lowerBoundPointCount, 0)
})

test('postage has no effect on readiness and incomplete evidence stays out of matches', () => {
  const noPostage = listing('no-postage', 1000, { shippingPrice: null, deliveredPrice: null })
  const incomplete = { ...listing('incomplete', 1000), cpuMultiPower: null, workPerformance: null }
  const filters = { ...createDefaultFilters(), showNeedsChecking: true }
  const groups = partitionResults([noPostage, incomplete], filters)

  assert.equal(classifyReadiness(noPostage), 'ready')
  assert.equal(classifyReadiness(incomplete), 'specs-incomplete')
  assert.deepEqual(groups.matches.map((row) => row.id), ['no-postage'])
  assert.deepEqual(groups.needsChecking.map((row) => row.id), ['incomplete'])
})

test('separates qualified listings first seen within 24 hours', () => {
  const recent = listing('recent', 1000, { firstSeenAt: '2026-07-22T08:00:00Z' })
  const older = listing('older', 1000, { firstSeenAt: '2026-07-20T08:00:00Z' })
  const filters = createDefaultFilters()

  const result = partitionResults([recent, older], filters, '', new Date('2026-07-22T20:00:00Z'))
  assert.deepEqual(result.newMatches.map((row) => row.id), [recent.id])
})

test('value assessment is relative to the G16 with no postage qualifier', () => {
  assert.deepEqual(assessValue(120, 1000), {
    ratio: 1.4,
    band: 'strong',
    label: '40% better value than your G16',
  })
  assert.deepEqual(assessValue(100, 1170), {
    ratio: 1,
    band: 'competitive',
    label: 'Similar work value to your G16',
  })
})

test('recommendation explains CPU dimensions, work value, memory and returns', () => {
  const row = listing('reason', 1000, { cpuMultiPower: 128, cpuSinglePower: 105, workPerformance: 121 })
  const reason = buildRecommendationReason(row)

  assert.match(reason, /Multi-core \+28% and single-thread \+5%/i)
  assert.match(reason, /work performance \+21%/i)
  assert.match(reason, /better value than your G16/i)
  assert.match(reason, /64 GB RAM/i)
  assert.match(reason, /returns accepted/i)
  assert.doesNotMatch(reason, /postage/i)
})
