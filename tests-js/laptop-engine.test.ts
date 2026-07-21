import assert from 'node:assert/strict'
import test from 'node:test'

import {
  applyFilters,
  combinedPower,
  createDefaultFilters,
  enrichListing,
  paretoFrontier,
  parseLaptopListing,
} from '../src/laptop/engine.ts'

const baseRaw = {
  sourceListingId: 'v1|123|0',
  title: 'ASUS ROG Strix G16 i9-14900HX RTX 4060 64GB RAM 1TB SSD 16 inch',
  description: '',
  price: 1200,
  shippingPrice: 20,
  currency: 'GBP',
  condition: 'Used',
  sellerName: 'good-seller',
  sellerFeedbackScore: 1200,
  sellerFeedbackPercent: 99.7,
  listingUrl: 'https://www.ebay.co.uk/itm/123',
  location: 'London, GB',
  imageUrls: [],
  localizedAspects: [],
  buyingOptions: ['FIXED_PRICE'],
  returnTerms: { returnsAccepted: true },
}

test('parses CPU, GPU, RAM, storage and screen size from a title', () => {
  const parsed = parseLaptopListing({
    title: 'ASUS ROG Strix G16 i9-14900HX RTX 4070 32GB RAM 1TB SSD 16 inch',
    localizedAspects: [],
  })

  assert.equal(parsed.brand, 'ASUS')
  assert.equal(parsed.cpuModel, 'Intel Core i9-14900HX')
  assert.equal(parsed.gpuModel, 'NVIDIA GeForce RTX 4070 Laptop GPU')
  assert.equal(parsed.ramGb, 32)
  assert.equal(parsed.storageGb, 1024)
  assert.equal(parsed.screenInches, 16)
})

test('recognizes current high-performance CPU families seen in live eBay data', () => {
  const cases = [
    ['Ryzen AI 9 365 RTX 5070 laptop', 'AMD Ryzen AI 9 365'],
    ['Core Ultra 9 285H RTX 5070 laptop', 'Intel Core Ultra 9 285H'],
    ['Core Ultra 7 265HX RTX 5070 laptop', 'Intel Core Ultra 7 265HX'],
    ['Ryzen 9 8940HX RTX 5070 laptop', 'AMD Ryzen 9 8940HX'],
  ]
  for (const [title, expected] of cases) {
    assert.equal(parseLaptopListing({ title }).cpuModel, expected)
  }
})

test('structured aspects take precedence and conflicts lower confidence', () => {
  const parsed = parseLaptopListing({
    title: 'Lenovo Legion i9-14900HX RTX 4070 32GB 1TB',
    localizedAspects: [
      { name: 'Processor', value: 'AMD Ryzen 9 7945HX' },
      { name: 'RAM Size', value: '64 GB' },
      { name: 'GPU', value: 'NVIDIA GeForce RTX 4080' },
    ],
  })

  assert.equal(parsed.cpuModel, 'AMD Ryzen 9 7945HX')
  assert.equal(parsed.gpuModel, 'NVIDIA GeForce RTX 4080 Laptop GPU')
  assert.equal(parsed.ramGb, 64)
  assert.ok(parsed.warnings.includes('conflicting CPU specifications'))
  assert.equal(parsed.specConfidence, 'medium')
})

test('hard excludes accessories and broken machines', () => {
  assert.equal(parseLaptopListing({ title: 'ASUS ROG G16 box only' }).hardExcluded, true)
  assert.equal(parseLaptopListing({ title: 'RTX 4080 gaming laptop spares or repair' }).hardExcluded, true)
  assert.equal(parseLaptopListing({ title: 'Lenovo Legion motherboard RTX 4070' }).hardExcluded, true)
})

test('flags instability, lock and charger risks', () => {
  const parsed = parseLaptopListing({
    title: 'MSI laptop RTX 4080 no charger',
    description: 'Occasional blue screen. BIOS password is unknown.',
  })

  assert.ok(parsed.riskFlags.includes('no charger'))
  assert.ok(parsed.riskFlags.includes('instability reported'))
  assert.ok(parsed.riskFlags.includes('firmware or account lock'))
})

test('anchors the current laptop and adjusts CPU priority', () => {
  assert.equal(combinedPower(100, 100, 0.6), 100)
  assert.ok(combinedPower(120, 80, 0.9) > combinedPower(120, 80, 0.2))
  assert.equal(combinedPower(null, 100, 0.6), null)
})

test('enriches a recognized listing with delivered price and relative power', () => {
  const listing = enrichListing(baseRaw)

  assert.equal(listing.deliveredPrice, 1220)
  assert.equal(listing.cpuPower, 100)
  assert.equal(listing.gpuPower, 100)
  assert.equal(listing.combinedPower, 100)
  assert.equal(listing.returnsAccepted, true)
  assert.ok(listing.valueIndex > 80 && listing.valueIndex < 83)
})

test('does not assign combined power when a critical component is unknown', () => {
  const listing = enrichListing({ ...baseRaw, title: 'ASUS creator laptop i9-14900HX 64GB 1TB' })

  assert.equal(listing.gpuPower, null)
  assert.equal(listing.combinedPower, null)
  assert.ok(listing.missingSpecs.includes('GPU'))
})

test('returns only non-dominated listings on the Pareto frontier', () => {
  const rows = [
    { id: 'a', deliveredPrice: 1000, combinedPower: 100 },
    { id: 'b', deliveredPrice: 1200, combinedPower: 90 },
    { id: 'c', deliveredPrice: 1400, combinedPower: 130 },
    { id: 'unknown', deliveredPrice: 500, combinedPower: null },
  ]

  assert.deepEqual(paretoFrontier(rows).map((row) => row.id), ['a', 'c'])
})

test('default filters enforce the £3,000 ceiling and current-machine power', () => {
  const filters = createDefaultFilters()
  assert.equal(filters.maxPrice, 3000)
  assert.equal(filters.minCombinedPower, 100)
  assert.equal(filters.cpuWeight, 0.6)
  assert.equal(filters.minRamGb, 32)
  assert.deepEqual(filters.excludedRisks, new Set(['instability reported', 'firmware or account lock', 'no charger']))
})

test('coordinates power, hardware, seller, condition, returns and risk filters', () => {
  const safe = enrichListing(baseRaw)
  const weakSeller = enrichListing({
    ...baseRaw,
    sourceListingId: 'weak',
    title: 'MSI Raider i9-14900HX RTX 4080 32GB 2TB',
    price: 2400,
    condition: 'Seller refurbished',
    sellerFeedbackScore: 8,
    sellerFeedbackPercent: 92,
    returnTerms: { returnsAccepted: false },
    description: 'No charger',
  })
  const filters = {
    ...createDefaultFilters(),
    minRamGb: 64,
    minSellerFeedback: 99,
    minSellerFeedbackCount: 100,
    returnsRequired: true,
    allowedConditions: new Set(['Used']),
    excludedRisks: new Set(['no charger']),
  }

  assert.deepEqual(applyFilters([safe, weakSeller], filters).map((row) => row.id), [safe.id])
})

test('can include needs-checking listings without pretending they meet power', () => {
  const unknown = enrichListing({ ...baseRaw, sourceListingId: 'unknown', title: 'Gaming laptop 64GB RAM 1TB SSD' })
  const filters = { ...createDefaultFilters(), showNeedsChecking: true, minCombinedPower: 100 }

  assert.deepEqual(applyFilters([unknown], filters).map((row) => row.id), ['unknown'])
})
