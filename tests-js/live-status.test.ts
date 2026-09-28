import assert from 'node:assert/strict'
import test from 'node:test'

import { checkListings, classifyItemResponse } from '../src/laptop/live-status.ts'
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
