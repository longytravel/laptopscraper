import assert from 'node:assert/strict'
import test from 'node:test'

import { applyBenchmarkEvidence, createInitialEvidenceStore } from '../src/laptop/benchmark-evidence.ts'
import { enrichListing } from '../src/laptop/engine.ts'
import { verifyLaptopDataset } from '../scripts/verify-laptop-dataset.ts'
import type { LaptopDataset } from '../src/laptop/types.ts'

const NOW = new Date('2026-07-22T20:00:00Z')
const evidence = createInitialEvidenceStore('2026-07-22T08:00:00Z')

function eligible(id = '123') {
  return applyBenchmarkEvidence(enrichListing({
    sourceListingId: id,
    title: 'ASUS i9-14900HX RTX 4060 Laptop 64GB RAM 1TB SSD',
    price: 1170,
    shippingPrice: null,
    listingUrl: `https://www.ebay.co.uk/itm/${id}`,
  }), evidence)
}

function dataset(listings: LaptopDataset['listings']): LaptopDataset {
  return {
    schemaVersion: 7,
    generatedAt: NOW.toISOString(),
    marketplaceId: 'EBAY_GB',
    benchmarkVersion: 'test',
    rawCount: listings.length,
    listingCount: listings.length,
    scoredCount: listings.length,
    needsCheckingCount: 0,
    searchRuns: [],
    listings,
  }
}

test('production verifier accepts a fresh internally consistent recommendation', () => {
  assert.deepEqual(verifyLaptopDataset(dataset([eligible()]), evidence, NOW), {
    recommendations: 1,
    invalidRecommendations: 0,
    omittedEligible: 0,
    missingEbayLinks: 0,
    staleRecommendedBenchmarks: 0,
    duplicateIds: 0,
    postageDependentRanks: 0,
  })
})

test('production verifier detects stored eligibility, link, freshness and duplicate faults', () => {
  const row = eligible('bad')
  const staleEvidence = createInitialEvidenceStore('2026-07-01T08:00:00Z')
  const counts = verifyLaptopDataset(dataset([
    { ...row, listingUrl: 'https://example.com/bad', ramGb: 32 },
    { ...row, bestBuyEligible: false },
  ]), staleEvidence, NOW)

  assert.equal(counts.invalidRecommendations, 1)
  assert.equal(counts.omittedEligible, 1)
  assert.equal(counts.missingEbayLinks, 1)
  assert.equal(counts.staleRecommendedBenchmarks, 1)
  assert.equal(counts.duplicateIds, 1)
})
