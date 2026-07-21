import assert from 'node:assert/strict'
import test from 'node:test'

import { createDefaultFilters, enrichListing } from '../src/laptop/engine'
import {
  buildChartModel,
  deriveFacets,
  parseShortlist,
  partitionResults,
  rankListings,
  serializeShortlist,
  toggleSelection,
} from '../src/laptop/dashboard.ts'

const listing = (id: string, title: string, price: number, feedback = 99.5) => enrichListing({
  sourceListingId: id,
  title,
  price,
  shippingPrice: 0,
  condition: 'Used',
  sellerFeedbackPercent: feedback,
  sellerFeedbackScore: 500,
  returnTerms: { returnsAccepted: true },
})

test('shortlist storage round-trips and rejects malformed input', () => {
  const ids = new Set(['one', 'two'])
  assert.deepEqual(parseShortlist(serializeShortlist(ids)), ids)
  assert.deepEqual(parseShortlist('{broken'), new Set())
  assert.deepEqual(parseShortlist('[1, null]'), new Set())
})

test('selection toggles without mutating the previous set', () => {
  const original = new Set(['one'])
  const added = toggleSelection(original, 'two')
  const removed = toggleSelection(added, 'one')

  assert.deepEqual(original, new Set(['one']))
  assert.deepEqual(added, new Set(['one', 'two']))
  assert.deepEqual(removed, new Set(['two']))
})

test('derives stable condition, brand, CPU and GPU facet options', () => {
  const rows = [
    listing('a', 'ASUS i9-14900HX RTX 4080 64GB RAM 2TB SSD', 1800),
    listing('b', 'Lenovo Ryzen 9 7945HX RTX 4090 32GB RAM 1TB SSD', 2200),
  ]
  const facets = deriveFacets(rows)

  assert.deepEqual(facets.conditions, ['Used'])
  assert.deepEqual(facets.brands, ['ASUS', 'Lenovo'])
  assert.deepEqual(facets.cpuManufacturers, ['AMD', 'Intel'])
  assert.deepEqual(facets.gpuFamilies, ['RTX 40 series'])
})

test('chart model uses fixed £0–£3,000 x-domain and includes Pareto IDs', () => {
  const rows = [
    listing('a', 'ASUS i9-14900HX RTX 4060 64GB RAM 1TB SSD', 1000),
    listing('b', 'MSI i9-14900HX RTX 4070 64GB RAM 1TB SSD', 1300),
    listing('c', 'Dell i9-14900HX RTX 4060 64GB RAM 1TB SSD', 1500),
  ]
  const model = buildChartModel(rows, 0.6)

  assert.deepEqual(model.xDomain, [0, 3000])
  assert.ok(model.yDomain[0] <= 80)
  assert.ok(model.yDomain[1] >= 117)
  assert.deepEqual(model.frontierIds, new Set(['a', 'b']))
})

test('ranking prefers recommendation evidence then value', () => {
  const strong = listing('strong', 'ASUS i9-14900HX RTX 4080 64GB RAM 2TB SSD', 1700, 100)
  const weakSeller = listing('weak', 'ASUS i9-14900HX RTX 4080 64GB RAM 2TB SSD', 1500, 90)

  assert.equal(rankListings([weakSeller, strong])[0].id, strong.id)
})

test('needs-checking results obey the same query, seller, returns and risk filters', () => {
  const matchingUnknown = enrichListing({
    sourceListingId: 'match', title: 'ASUS creator laptop 64GB RAM 1TB SSD', price: 900, shippingPrice: 0,
    condition: 'Used', sellerFeedbackPercent: 100, sellerFeedbackScore: 500, returnTerms: { returnsAccepted: true },
  })
  const wrongBrand = enrichListing({
    sourceListingId: 'wrong', title: 'Lenovo creator laptop 64GB RAM 1TB SSD no charger', price: 800, shippingPrice: 0,
    condition: 'Used', sellerFeedbackPercent: 90, sellerFeedbackScore: 5, returnTerms: { returnsAccepted: false },
  })
  const filters = {
    ...createDefaultFilters(),
    showNeedsChecking: true,
    minSellerFeedback: 99,
    minSellerFeedbackCount: 100,
    returnsRequired: true,
    allowedBrands: new Set(['ASUS']),
  }

  const groups = partitionResults([matchingUnknown, wrongBrand], filters, 'creator')
  assert.deepEqual(groups.needsChecking.map((row) => row.id), ['match'])
})
