import assert from 'node:assert/strict'
import test from 'node:test'

import {
  centreOn,
  FULL_VIEW,
  isZoomed,
  MAX_ZOOM,
  MIN_SPAN,
  niceTicks,
  normalizeView,
  pointInView,
  viewAnchoredAt,
  viewContains,
  zoomLevel,
  zoomView,
} from '../src/laptop/chart-view.ts'

function close(actual: number, expected: number, message?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-9, message ?? `${actual} is not ${expected}`)
}

test('the full view is the whole chart and is not zoomed', () => {
  assert.equal(isZoomed(FULL_VIEW), false)
  assert.equal(zoomLevel(FULL_VIEW), 1)
  assert.deepEqual(normalizeView(FULL_VIEW), FULL_VIEW)
})

test('zooming keeps the point under the cursor where it was', () => {
  const view = zoomView(FULL_VIEW, 2, 0.25, 0.75)
  const before = pointInView(FULL_VIEW, 0.25, 0.75)
  const after = pointInView(view, 0.25, 0.75)
  close(after.gx, before.gx)
  close(after.gy, before.gy)
  close(view.span, 0.5)
  // The anchor was a quarter of the way along, so the window is [0.125, 0.625] wide on x.
  close(view.cx, 0.375)
})

test('zoom is capped at the maximum and cannot go below the full chart', () => {
  let view = FULL_VIEW
  for (let step = 0; step < 40; step += 1) view = zoomView(view, 1.5, 0.5, 0.5)
  close(view.span, MIN_SPAN)
  close(zoomLevel(view), MAX_ZOOM)
  for (let step = 0; step < 40; step += 1) view = zoomView(view, 1 / 1.5, 0.3, 0.6)
  assert.deepEqual(view, FULL_VIEW)
})

test('the window never leaves the chart, however far it is zoomed at an edge', () => {
  const corner = zoomView(FULL_VIEW, 8, 0, 0)
  close(corner.cx - corner.span / 2, 0)
  close(corner.cy - corner.span / 2, 0)
  const opposite = zoomView(FULL_VIEW, 8, 1, 1)
  close(opposite.cx + opposite.span / 2, 1)
  close(opposite.cy + opposite.span / 2, 1)
  const dragged = viewAnchoredAt(0.25, 0.9, 0.9, 0.1, 0.1)
  assert.ok(dragged.cx + dragged.span / 2 <= 1 + 1e-9)
  assert.ok(dragged.cy + dragged.span / 2 <= 1 + 1e-9)
})

test('dragging is the anchored view: the grabbed point follows the pointer', () => {
  const start = zoomView(FULL_VIEW, 4, 0.5, 0.5)
  const grabbed = pointInView(start, 0.5, 0.5)
  // Pointer moves to the left and up inside the window; the grabbed point goes with it.
  const moved = viewAnchoredAt(start.span, grabbed.gx, grabbed.gy, 0.4, 0.6)
  const now = pointInView(moved, 0.4, 0.6)
  close(now.gx, grabbed.gx)
  close(now.gy, grabbed.gy)
  assert.equal(moved.span, start.span)
})

test('panning the full view does nothing', () => {
  assert.deepEqual(viewAnchoredAt(1, 0.3, 0.3, 0.9, 0.9), FULL_VIEW)
})

test('centring brings an off-screen point into the window', () => {
  const view = zoomView(FULL_VIEW, 8, 0, 0)
  assert.equal(viewContains(view, 0.9, 0.9), false)
  const moved = centreOn(view, 0.9, 0.9)
  assert.equal(viewContains(moved, 0.9, 0.9), true)
  assert.equal(moved.span, view.span)
})

test('margin keeps a point from sitting on the very edge', () => {
  const view = zoomView(FULL_VIEW, 4, 0.5, 0.5)
  const edge = view.cx + view.span / 2 - 0.001
  assert.equal(viewContains(view, edge, view.cy), true)
  assert.equal(viewContains(view, edge, view.cy, 0.1), false)
})

test('tick positions are round numbers inside the range', () => {
  assert.deepEqual(niceTicks(0, 3000, 7).ticks, [0, 500, 1000, 1500, 2000, 2500, 3000])
  assert.deepEqual(niceTicks(0, 3000, 4).ticks, [0, 1000, 2000, 3000])
  assert.deepEqual(niceTicks(80, 150, 6).ticks, [80, 100, 120, 140])
})

test('ticks follow a zoomed window and respect a minimum step', () => {
  const zoomed = niceTicks(1200, 1500, 7)
  assert.equal(zoomed.step, 50)
  assert.deepEqual(zoomed.ticks, [1200, 1250, 1300, 1350, 1400, 1450, 1500])
  const score = niceTicks(100, 106, 6, 1)
  assert.equal(score.step, 1)
  assert.deepEqual(score.ticks, [100, 101, 102, 103, 104, 105, 106])
})

test('degenerate ranges give no ticks rather than looping', () => {
  assert.deepEqual(niceTicks(5, 5, 6).ticks, [])
  assert.deepEqual(niceTicks(10, 2, 6).ticks, [])
})
