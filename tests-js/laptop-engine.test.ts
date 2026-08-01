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
import { CPU_BENCHMARKS, GPU_BENCHMARKS } from '../src/laptop/benchmarks.ts'

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

test('rejects desktop and external GPU contexts but accepts eBay laptop category evidence', () => {
  assert.equal(parseLaptopListing({ title: 'NVIDIA RTX 4080 desktop graphics card only' }).gpuModel, null)
  assert.equal(parseLaptopListing({ title: 'Razer Core eGPU with RTX 4070' }).gpuModel, null)
  assert.equal(parseLaptopListing({ title: 'Custom RTX 4080 computer', categoryId: '177' }).gpuModel, 'NVIDIA GeForce RTX 4080 Laptop GPU')
})

test('keeps laptop GPUs when desktop is only comparison or seller context', () => {
  assert.equal(parseLaptopListing({ title: 'ASUS RTX 4080 desktop-class gaming laptop' }).gpuModel, 'NVIDIA GeForce RTX 4080 Laptop GPU')
  assert.equal(parseLaptopListing({ title: 'Lenovo RTX 4070 laptop', description: 'Selling because I upgraded to a desktop PC.' }).gpuModel, 'NVIDIA GeForce RTX 4070 Laptop GPU')
})

test('does not exclude a complete laptop merely because its description mentions the motherboard', () => {
  const parsed = parseLaptopListing({ title: 'ASUS ROG laptop RTX 4080', description: 'Motherboard tested and working.' })
  assert.equal(parsed.hardExcluded, false)
})

test('tracks description provenance truthfully', () => {
  const parsed = parseLaptopListing({ title: 'Gaming laptop', description: 'Intel i9-14900HX with RTX 4080, 64GB RAM and 2TB SSD' })
  assert.equal(parsed.provenance.cpu, 'description')
  assert.equal(parsed.provenance.gpu, 'description')
  assert.equal(parsed.provenance.ram, 'description')
  assert.equal(parsed.provenance.storage, 'description')
})

test('every benchmark entry carries auditable source metadata', () => {
  for (const entry of [...CPU_BENCHMARKS, ...GPU_BENCHMARKS]) {
    assert.ok(entry.source.name)
    assert.match(entry.source.url, /^https:\/\//)
    assert.match(entry.source.observedAt, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(entry.source.metric)
    assert.ok(entry.source.derived)
    assert.match(decodeURIComponent(entry.source.url).toLowerCase(), new RegExp(entry.canonical.split(' ').slice(-2).join(' ').toLowerCase().replace(/[+]/g, '\\+')))
  }
  assert.equal(new Set(CPU_BENCHMARKS.map((entry) => entry.source.url)).size, CPU_BENCHMARKS.length)
  assert.equal(new Set(GPU_BENCHMARKS.map((entry) => entry.source.url)).size, GPU_BENCHMARKS.length)
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

test('keeps delivered price and value unknown when postage is unavailable', () => {
  const listing = enrichListing({ ...baseRaw, shippingPrice: null })
  assert.equal(listing.deliveredPrice, null)
  assert.equal(listing.valueIndex, null)
  assert.ok(listing.missingSpecs.includes('shipping'))
})

test('applies price filters to the item-price lower bound when postage is unknown', () => {
  const listing = enrichListing({ ...baseRaw, price: 3200, shippingPrice: null })
  const filters = createDefaultFilters()
  filters.showNeedsChecking = true
  filters.maxPrice = 3000

  assert.deepEqual(applyFilters([listing], filters), [])

  filters.maxPrice = 3500
  assert.equal(applyFilters([listing], filters).length, 1)
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

test('default filters open at the G16 replacement floor with the £3,000 ceiling and CPU weighting', () => {
  const filters = createDefaultFilters()
  assert.equal(filters.maxPrice, 3000)
  assert.equal(filters.minCombinedPower, 0)
  assert.equal(filters.minCpuPower, 0)
  assert.equal(filters.minGpuPower, 0)
  assert.equal(filters.cpuWeight, 0.6)
  assert.equal(filters.minRamGb, 64)
  assert.equal(filters.minStorageGb, 1000)
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
