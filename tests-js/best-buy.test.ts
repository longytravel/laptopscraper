import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assessBestBuy,
  bestBuyFrontier,
  effectivePrice,
  rankBestBuys,
  surplusCredit,
  workPerformance,
  workValueRatio,
} from '../src/laptop/best-buy.ts'
import { enrichListing } from '../src/laptop/engine.ts'
import type { LaptopListing } from '../src/laptop/types.ts'

function makeListing(overrides: Partial<LaptopListing> = {}): LaptopListing {
  const listing = enrichListing({
    sourceListingId: 'v1|123|0',
    title: 'ASUS ROG Strix G16 i9-14900HX RTX 4060 64GB RAM 1TB SSD',
    description: '',
    price: 1170,
    shippingPrice: null,
    currency: 'GBP',
    condition: 'Used',
    sellerName: 'trusted-seller',
    sellerFeedbackScore: 1200,
    sellerFeedbackPercent: 99.7,
    listingUrl: 'https://www.ebay.co.uk/itm/123',
    location: 'London, GB',
    buyingOptions: ['FIXED_PRICE'],
    returnTerms: { returnsAccepted: true },
  })

  return {
    ...listing,
    cpuMultiPower: 100,
    cpuSinglePower: 100,
    workPerformance: 100,
    workValue: 1,
    benchmarkEvidenceAt: '2026-07-22T00:00:00Z',
    ...overrides,
  } as LaptopListing
}

test('scores work power with 70 percent multi-core and 30 percent single-thread', () => {
  assert.equal(workPerformance(100, 100), 100)
  assert.equal(workPerformance(128, 105), 120.616)
  assert.equal(workPerformance(null, 105), null)
})

test('calculates value from advertised item price relative to the G16', () => {
  assert.equal(workValueRatio(100, 1170), 1)
  assert.equal(workValueRatio(120, 1404), 1)
  assert.equal(workValueRatio(null, 1000), null)
})

test('ignores postage and GPU uplift while enforcing every replacement floor', () => {
  const row = makeListing({
    price: 2100,
    shippingPrice: 500,
    deliveredPrice: 2600,
    cpuMultiPower: 128,
    cpuSinglePower: 105,
    gpuPower: 129,
    ramGb: 64,
    storageGb: 2048,
    hardExcluded: false,
  })

  const result = assessBestBuy(row)

  assert.equal(result.eligible, true)
  assert.equal(result.workPerformance, 120.616)
  // 1 TB of surplus storage at £0.06/GB, no surplus RAM.
  assert.equal(result.surplusCredit, 61.44)
  assert.equal(result.effectivePrice, 2038.56)
  assert.equal(result.workValue, workValueRatio(120.616, 2038.56))
})

test('credits surplus RAM and storage at market cost, never below the floor', () => {
  assert.equal(surplusCredit(64, 1024), 0)
  assert.equal(surplusCredit(32, 512), 0)
  assert.equal(surplusCredit(128, 1024), 160)
  assert.equal(surplusCredit(128, 6144), 467.2)
  assert.equal(surplusCredit(null, null), 0)
})

test('measures value against the credited price while leaving work performance untouched', () => {
  const spacious = makeListing({ price: 2849, cpuMultiPower: 100, cpuSinglePower: 100, ramGb: 128, storageGb: 6144 })
  const result = assessBestBuy(spacious)

  assert.equal(effectivePrice(spacious), 2381.8)
  assert.equal(result.workPerformance, 100, 'surplus hardware must never inflate the speed measure')
  assert.equal(result.workValue, workValueRatio(100, 2381.8))
  assert.ok(result.workValue! > workValueRatio(100, 2849)!)
})

test('rejects a downgrade in either CPU dimension', () => {
  const result = assessBestBuy(makeListing({ cpuMultiPower: 130, cpuSinglePower: 99 }))
  assert.deepEqual(result.failures, ['single-thread below G16'])
})

test('applies all replacement-quality gates with stable reasons', () => {
  const result = assessBestBuy(makeListing({
    hardExcluded: true,
    cpuMultiPower: null,
    cpuSinglePower: null,
    ramGb: 32,
    storageGb: 512,
    gpuPower: 90,
    price: 3100,
    warnings: ['conflicting CPU specifications'],
  }))

  assert.deepEqual(result.failures, [
    'not a complete working laptop',
    'CPU benchmark evidence missing',
    'RAM below 64 GB',
    'storage below 1 TB',
    'graphics below RTX 4060',
    'unresolved specification conflict',
    'price above £3,000',
  ])
})

test('removes listings dominated on price, work power, RAM and storage', () => {
  const winner = makeListing({ id: 'winner', price: 1500, cpuMultiPower: 125, cpuSinglePower: 125, ramGb: 64, storageGb: 2048 })
  const dominated = makeListing({ id: 'dominated', price: 1600, cpuMultiPower: 120, cpuSinglePower: 120, ramGb: 64, storageGb: 1024 })
  const faster = makeListing({ id: 'faster', price: 1800, cpuMultiPower: 140, cpuSinglePower: 140, ramGb: 64, storageGb: 2048 })

  assert.deepEqual(bestBuyFrontier([winner, dominated, faster]).map((row) => row.id), ['winner', 'faster'])
})

test('ranks eligible frontier listings by work value and safety evidence', () => {
  const highValue = makeListing({ id: 'high-value', price: 1500, cpuMultiPower: 130, cpuSinglePower: 130 })
  const highPower = makeListing({ id: 'high-power', price: 1800, cpuMultiPower: 145, cpuSinglePower: 145 })
  const rejected = makeListing({ id: 'rejected', cpuSinglePower: 95 })

  assert.deepEqual(rankBestBuys([highPower, rejected, highValue]).map((row) => row.id), ['high-value', 'high-power'])
})
