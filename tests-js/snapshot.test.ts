import assert from 'node:assert/strict'
import test from 'node:test'

import { enrichListing } from '../src/laptop/engine.ts'
import { mergeSeenTimestamps, newEligibleIds, recentBestBuys, updateFirstSeenHistory } from '../src/laptop/snapshot.ts'
import type { LaptopListing } from '../src/laptop/types.ts'

function row(id: string, overrides: Partial<LaptopListing> = {}): LaptopListing {
  return {
    ...enrichListing({
      sourceListingId: id,
      title: 'ASUS i9-14900HX RTX 4060 64GB RAM 1TB SSD laptop',
      price: 1170,
      currency: 'GBP',
      listingUrl: `https://www.ebay.co.uk/itm/${id}`,
    }),
    ...overrides,
  }
}

test('preserves first seen time and advances last seen time', () => {
  const rows = mergeSeenTimestamps(
    [row('same', { firstSeenAt: '2026-07-21T08:00:00Z', lastSeenAt: '2026-07-21T08:00:00Z' })],
    [row('same'), row('new')],
    '2026-07-22T08:00:00Z',
  )

  assert.equal(rows[0].firstSeenAt, '2026-07-21T08:00:00Z')
  assert.equal(rows[0].lastSeenAt, '2026-07-22T08:00:00Z')
  assert.equal(rows[1].firstSeenAt, '2026-07-22T08:00:00Z')
})

test('reports only newly eligible item IDs', () => {
  const current = [
    row('old', { bestBuyEligible: true }),
    row('new', { bestBuyEligible: true }),
    row('rejected', { bestBuyEligible: false }),
  ]
  assert.deepEqual([...newEligibleIds(new Set(['old']), current)], ['new'])
})

test('marks eligible listings first seen within the last 24 hours as recent', () => {
  const now = new Date('2026-07-22T20:00:00Z')
  const rows = [
    row('recent', { bestBuyEligible: true, firstSeenAt: '2026-07-22T08:01:00Z' }),
    row('old', { bestBuyEligible: true, firstSeenAt: '2026-07-21T19:59:59Z' }),
    row('rejected', { bestBuyEligible: false, firstSeenAt: '2026-07-22T19:00:00Z' }),
  ]
  assert.deepEqual(recentBestBuys(rows, now).map((listing) => listing.id), ['recent'])
})

test('a listing that drops out of one run keeps its original first-seen time when it returns', () => {
  const history = updateFirstSeenHistory({}, [row('flaky', { firstSeenAt: '2026-09-15T12:00:00Z' })])
  // The previous dataset no longer holds it: it was missing from the last run's search results.
  const rows = mergeSeenTimestamps([], [row('flaky'), row('fresh')], '2026-09-28T15:44:00Z', history)

  assert.equal(rows[0].firstSeenAt, '2026-09-15T12:00:00Z')
  assert.equal(rows[1].firstSeenAt, '2026-09-28T15:44:00Z')
  assert.deepEqual(updateFirstSeenHistory(history, rows), { flaky: '2026-09-15T12:00:00Z', fresh: '2026-09-28T15:44:00Z' })
})
