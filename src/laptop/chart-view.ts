/**
 * Zoom and pan for the price / work-performance chart.
 *
 * The view is a square window over the full chart, in fractions of each axis:
 * 0 is the left or bottom edge of the full domain and 1 the right or top. One
 * span serves both axes, so zooming never stretches the plot and the window
 * can always be described by its centre and size.
 */
export interface ChartView {
  cx: number
  cy: number
  span: number
}

export const FULL_VIEW: ChartView = { cx: 0.5, cy: 0.5, span: 1 }
export const MAX_ZOOM = 16
export const MIN_SPAN = 1 / MAX_ZOOM

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value))
}

/** Squeeze a view back inside the full chart: legal span, and no empty margin. */
export function normalizeView(view: ChartView): ChartView {
  const span = clamp(view.span, MIN_SPAN, 1)
  const half = span / 2
  return { span, cx: clamp(view.cx, half, 1 - half), cy: clamp(view.cy, half, 1 - half) }
}

/**
 * The view of a given size that puts the chart point (gx, gy) at the relative
 * position (rx, ry) inside the window, 0..1 from the left and from the bottom.
 * Dragging, wheel zoom and pinch all reduce to this: keep the data point under
 * the finger or cursor where it is.
 */
export function viewAnchoredAt(span: number, gx: number, gy: number, rx: number, ry: number): ChartView {
  const clamped = clamp(span, MIN_SPAN, 1)
  return normalizeView({ span: clamped, cx: gx - rx * clamped + clamped / 2, cy: gy - ry * clamped + clamped / 2 })
}

/** The chart point (gx, gy) sitting at relative window position (rx, ry). */
export function pointInView(view: ChartView, rx: number, ry: number): { gx: number; gy: number } {
  return { gx: view.cx - view.span / 2 + rx * view.span, gy: view.cy - view.span / 2 + ry * view.span }
}

/** Zoom by `factor` (above 1 magnifies) keeping the window position (rx, ry) fixed on the data. */
export function zoomView(view: ChartView, factor: number, rx = 0.5, ry = 0.5): ChartView {
  const { gx, gy } = pointInView(view, rx, ry)
  return viewAnchoredAt(view.span / factor, gx, gy, rx, ry)
}

export function centreOn(view: ChartView, gx: number, gy: number): ChartView {
  return normalizeView({ ...view, cx: gx, cy: gy })
}

export function isZoomed(view: ChartView): boolean {
  return view.span < 1 - 1e-9
}

export function zoomLevel(view: ChartView): number {
  return 1 / view.span
}

/** Whether a chart point lies inside the window, with `margin` (a fraction of the window) to spare. */
export function viewContains(view: ChartView, gx: number, gy: number, margin = 0): boolean {
  const slack = view.span * margin
  const half = view.span / 2
  return Math.abs(gx - view.cx) <= half - slack && Math.abs(gy - view.cy) <= half - slack
}

const STEP_LADDER = [1, 2, 5, 10]

/**
 * Round-number tick positions inside [lo, hi], about `target` of them. The step
 * is never below `minStep`, so a deep zoom on a score axis does not invent
 * fractions of a point.
 */
export function niceTicks(lo: number, hi: number, target: number, minStep = 0): { ticks: number[]; step: number } {
  const range = hi - lo
  if (!(range > 0) || target < 1) return { ticks: [], step: 0 }
  const raw = Math.max(range / target, minStep, Number.MIN_VALUE)
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = (STEP_LADDER.map((multiple) => multiple * magnitude).find((candidate) => candidate >= raw * (1 - 1e-9))) ?? 10 * magnitude
  const first = Math.ceil(lo / step - 1e-9)
  const last = Math.floor(hi / step + 1e-9)
  const ticks: number[] = []
  for (let index = first; index <= last; index += 1) ticks.push(Number((index * step).toPrecision(12)))
  return { ticks, step }
}
