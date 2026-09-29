import assert from 'node:assert/strict'
import test from 'node:test'

import { classifyItemResponse } from '../api/listing-status.ts'
import { checkListings } from '../src/laptop/live-status.ts'
import type { LiveStatus } from '../src/laptop/live-status.ts'

const now = new Date('2026-09-28T21:00:00Z')

test('an ended listing that still reports IN_STOCK is ended, going by its end date', () => {
  // The PCSpecialist Recoil 16 (257768627673) sold at 16:58 and came back exactly like this.
  const body = { itemEndDate: '2026-09-28T16:58:14.000Z', price: { value: '2280.00' }, estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'IN_STOCK' }] }
  assert.deepEqual(classifyItemResponse(200, body, now), { state: 'ended', endedAt: '2026-09-28T16:58:14.000Z', price: 2280 })
})

test('live, gone, out of stock and failed lookups are told apart', () => {
  assert.deepEqual(classifyItemResponse(200, { price: { value: '1638.70' } }, now), { state: 'live', price: 1638.7 })
  assert.equal(classifyItemResponse(200, { itemEndDate: '2026-10-05T00:00:00Z' }, now).state, 'live')
  assert.equal(classifyItemResponse(404, null, now).state, 'ended')
  assert.equal(classifyItemResponse(200, { estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'OUT_OF_STOCK' }] }, now).state, 'ended')
  assert.equal(classifyItemResponse(500, null, now).state, 'unknown')
})

test('the price passes through untouched: it must be the full-response, fee-inclusive figure', () => {
  // Fee trap: getItem?fieldgroups=COMPACT returned 2000.00 for this private-seller
  // listing (no Buyer Protection fee); the full response and search say 2046.70,
  // which is what the buyer pays. The function must request the full item, and
  // classifyItemResponse must not adjust the price it is given (so it stays equal
  // to the collector's search price and no false "reduced from" appears).
  const full = { price: { value: '2046.70' }, estimatedAvailabilities: [{ estimatedAvailabilityStatus: 'IN_STOCK' }] }
  assert.deepEqual(classifyItemResponse(200, full, now), { state: 'live', price: 2046.7 })
  assert.equal(classifyItemResponse(200, { price: { value: '0.00' } }, now).price, 0)
  assert.equal(classifyItemResponse(200, {}, now).price, undefined)
})

test('the function asks eBay for the full item, never COMPACT', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../api/listing-status.ts', import.meta.url), 'utf8')
  assert.ok(!/fieldgroups\s*=\s*COMPACT/.test(source.replace(/\/\/.*$/gm, '')), 'COMPACT drops the buyer protection fee from the price of private sellers')
})

test('checks every listing, and stops at the first sign the endpoint is unavailable', async () => {
  const seen: LiveStatus[] = []
  const status = (id: string): LiveStatus => ({ id, state: 'live', checkedAt: now.toISOString() })
  const ids = Array.from({ length: 30 }, (_, index) => `v1|${index}|0`)

  assert.equal(await checkListings(ids, async (id) => status(id), (batch) => seen.push(...batch), 4), 'done')
  assert.equal(seen.length, 30)

  let calls = 0
  const outcome = await checkListings(ids, async () => { calls += 1; return 'unavailable' }, () => {}, 1)
  assert.equal(outcome, 'unavailable')
  assert.equal(calls, 1, 'a misconfigured endpoint must cost one request, not one per listing')
})
