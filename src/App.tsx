import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  CircleAlert,
  Cpu,
  ExternalLink,
  Filter,
  Gauge,
  Heart,
  Laptop,
  Maximize2,
  MemoryStick,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  X,
  Zap,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'

import './App.css'
import {
  assessValue,
  BASELINE_PRICE,
  buildChartModel,
  buildRecommendationReason,
  chartPrice,
  classifyReadiness,
  deriveFacets,
  markSeen,
  parseSeen,
  parseShortlist,
  partitionResults,
  rankListings,
  SEEN_STORAGE_KEY,
  serializeSeen,
  serializeShortlist,
  SHORTLIST_STORAGE_KEY,
  toggleSelection,
} from './laptop/dashboard'
import {
  centreOn,
  FULL_VIEW,
  isZoomed,
  MIN_SPAN,
  niceTicks,
  pointInView,
  viewAnchoredAt,
  viewContains,
  zoomLevel,
  zoomView,
} from './laptop/chart-view'
import type { ChartView } from './laptop/chart-view'
import { createDefaultFilters } from './laptop/engine'
import { assessBestBuy, effectivePrice, RAM_TIERS, RAM_UPGRADE_GBP } from './laptop/best-buy'
import type { GateOptions, RamTier } from './laptop/best-buy'
import type { ChartListing } from './laptop/dashboard'
import type { LaptopDataset, LaptopFilters, LaptopListing, SpecConfidence } from './laptop/types'
import { checkListings, fetchListingStatus } from './laptop/live-status'
import type { LiveStatus } from './laptop/live-status'

type LiveCheck = { phase: 'checking' | 'done' | 'unavailable'; checked: number; total: number; ended: number }

function LiveBadge({ status, capturedAt }: { status: LiveStatus | undefined; capturedAt: string }) {
  if (status?.state === 'live') return <span className="live-badge is-live"><Check size={12} aria-hidden="true" />Live on eBay · checked {ageLabel(status.checkedAt)}</span>
  return <span className="live-badge">Not checked live · listed at the {new Date(capturedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} refresh</span>
}

const MONEY = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })
const NUMBER = new Intl.NumberFormat('en-GB')

type SetFilterKey = 'allowedConditions' | 'allowedBrands' | 'allowedCpuManufacturers' | 'allowedGpuFamilies' | 'allowedBuyingOptions' | 'allowedConfidence' | 'excludedRisks'
type ResultMode = 'new' | 'matches' | 'ram32' | 'needs-checking' | 'shortlist'
type SortMode = 'recommended' | 'value' | 'power' | 'price'
type DrawerName = 'filters' | 'listings'
const RESULT_MODES: ResultMode[] = ['new', 'matches', 'ram32', 'needs-checking', 'shortlist']
const TIER_STORAGE_KEY = 'laptop-power-finder-ram-tiers-v1'

function loadTiers(): Set<RamTier> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(TIER_STORAGE_KEY) ?? 'null')
    const tiers = Array.isArray(parsed) ? RAM_TIERS.filter((tier) => parsed.includes(tier)) : []
    if (tiers.length) return new Set(tiers)
  } catch {
    // Storage blocked or corrupt: fall back to both tiers.
  }
  return new Set(RAM_TIERS)
}

function signedPercent(power: number | null | undefined): string {
  if (power == null) return 'unknown'
  const percentage = Math.round(power - 100)
  return `${percentage >= 0 ? '+' : ''}${percentage}%`
}

function isNewListing(row: LaptopListing): boolean {
  if (!row.firstSeenAt) return false
  const age = Date.now() - Date.parse(row.firstSeenAt)
  return age >= 0 && age <= 24 * 60 * 60 * 1000
}

function ageLabel(value: string): string {
  const milliseconds = Date.now() - new Date(value).getTime()
  const minutes = Math.max(0, Math.round(milliseconds / 60_000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

function rangeLabel(value: number, suffix = ''): string {
  return `${NUMBER.format(value)}${suffix}`
}

function FilterSection({ title, children, open = true }: { title: string; children: React.ReactNode; open?: boolean }) {
  return (
    <details className="filter-section" open={open}>
      <summary>{title}<ChevronDown size={15} aria-hidden="true" /></summary>
      <div className="filter-section-body">{children}</div>
    </details>
  )
}

function RangeControl({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  display: string
  onChange: (value: number) => void
}) {
  return (
    <label className="range-control">
      <span><span>{label}</span><strong>{display}</strong></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}

function ToggleChip({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <button type="button" className={`toggle-chip${checked ? ' is-active' : ''}`} aria-pressed={checked} onClick={onChange}>
      {checked && <Check size={12} aria-hidden="true" />}{label}
    </button>
  )
}

function Switch({ checked, label, hint, onChange }: { checked: boolean; label: string; hint?: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="switch-row">
      <span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

function Drawer({ open, side, title, onClose, children }: { open: boolean; side: 'left' | 'right'; title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="drawer-layer">
      <div className="drawer-scrim" onClick={onClose} />
      <section className={`drawer drawer-${side}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="drawer-header"><strong>{title}</strong><button type="button" className="icon-button" onClick={onClose} aria-label={`Close ${title.toLowerCase()}`} autoFocus><X size={17} /></button></header>
        <div className="drawer-body">{children}</div>
      </section>
    </div>
  )
}

type ChartModel = ReturnType<typeof buildChartModel>

/** The axis runs a little past the £3,000 ceiling so the dearest dots are not clipped by the frame. */
const PRICE_MAX = 3100
/** Work performance per pound on the line where value equals the G16's. */
const EQUAL_VALUE_SLOPE = 100 / BASELINE_PRICE
const BUTTON_ZOOM = 1.6
/** Half-diagonal over circle radius that gives a diamond the same area as the circle. */
const DIAMOND_SCALE = 1.25

/**
 * One mark for both the plot and the key, so the key can never drift from the
 * chart. Shape says RAM (circle 64 GB, diamond 32 GB); fill says whether you
 * have opened the listing yet.
 */
function Marker({ tier, x, y, r, opened, extra = '' }: { tier: RamTier; x: number; y: number; r: number; opened: boolean; extra?: string }) {
  const className = `listing-point tier-${tier} ${opened ? 'is-opened' : 'is-new'}${extra}`
  if (tier === 32) {
    const d = r * DIAMOND_SCALE
    return <path className={className} d={`M ${x} ${y - d} L ${x + d} ${y} L ${x} ${y + d} L ${x - d} ${y} Z`} />
  }
  return <circle className={className} cx={x} cy={y} r={r} />
}
function KeyMark({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return <svg className={`key-mark${wide ? ' is-wide' : ''}`} viewBox={wide ? '0 0 34 24' : '0 0 24 24'} aria-hidden="true">{children}</svg>
}

function ChartKey({ model, opened, onClear }: { model: ChartModel; opened: number; onClear: () => void }) {
  const total = model.points.length
  return (
    <div className="chart-key" role="group" aria-label="Chart key">
      <div className="key-group">
        <span className="key-title">Status</span>
        <span className="key-item"><KeyMark><Marker tier={64} x={12} y={12} r={6} opened={false} /></KeyMark>Not clicked yet</span>
        <span className="key-item"><KeyMark><Marker tier={64} x={12} y={12} r={6} opened /></KeyMark>Clicked</span>
      </div>
      <div className="key-group">
        <span className="key-title">RAM</span>
        {model.ram64Count > 0 && <span className="key-item"><KeyMark><Marker tier={64} x={12} y={12} r={6} opened={false} /></KeyMark>64 GB</span>}
        {model.ram32Count > 0 && <span className="key-item"><KeyMark><Marker tier={32} x={12} y={12} r={6} opened={false} /></KeyMark>32 GB</span>}
      </div>
      <div className="key-group">
        <span className="key-title">Best buy</span>
        <span className="key-item">
          <KeyMark wide>
            <line className="pareto-line" x1="1" x2="33" y1="12" y2="12" />
            <circle className="halo-frontier" cx="17" cy="12" r="9.5" />
            <Marker tier={64} x={17} y={12} r={6} opened={false} />
          </KeyMark>
          Beats everything cheaper
        </span>
      </div>
      <div className="key-group">
        <span className="key-title">Your G16</span>
        <span className="key-item"><KeyMark wide><line className="baseline-line" x1="1" x2="33" y1="12" y2="12" /></KeyMark>£1,170 · 100</span>
        <span className="key-item"><KeyMark wide><line className="equal-value-line" x1="1" x2="33" y1="20" y2="4" /></KeyMark>Equal value (above = better)</span>
      </div>
      <div className="key-progress">
        <span><strong>{opened}</strong> of {total} clicked</span>
        {opened > 0 && <button type="button" onClick={onClear}>Mark all as not clicked</button>}
      </div>
    </div>
  )
}

type Gesture =
  | { kind: 'drag'; startX: number; startY: number; gx: number; gy: number; span: number; moved: boolean }
  | { kind: 'pinch'; startDistance: number; gx: number; gy: number; span: number }

function PowerChart({
  model,
  selectedId,
  onSelect,
  onOpen,
  openedIds,
  onClearOpened,
  live,
  capturedAt,
}: {
  model: ChartModel
  selectedId: string | null
  onSelect: (row: LaptopListing) => void
  onOpen: (id: string) => void
  openedIds: Set<string>
  onClearOpened: () => void
  live: Map<string, LiveStatus>
  capturedAt: string
}) {
  const clipId = useId().replace(/:/g, '')
  const wrapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  // First guess from the window so a phone never paints the desktop layout;
  // the observer then tracks the real container width.
  const [measured, setMeasured] = useState(() => window.innerWidth - 36)
  useLayoutEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const style = getComputedStyle(element)
    const content = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    if (content > 0) setMeasured(Math.round(content))
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width) setMeasured(Math.round(entry.contentRect.width)) })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  // Drawn at the container's own pixel width so labels stay readable on a
  // phone instead of shrinking with a fixed 960-wide viewBox.
  const width = Math.max(320, Math.min(1400, measured))
  const compact = width < 600
  const height = compact ? Math.round(width * 1.15) : Math.round(Math.min(640, Math.max(440, width * 0.5)))
  const pad = compact ? { top: 20, right: 14, bottom: 46, left: 44 } : { top: 34, right: 34, bottom: 56, left: 64 }
  const innerWidth = width - pad.left - pad.right
  const innerHeight = height - pad.top - pad.bottom
  const radius = compact ? 5.5 : 6.5

  // Zoom and pan. The view is a window over the full chart; the handlers read
  // geometry and view through refs so they never act on a stale render.
  const [view, setView] = useState<ChartView>(FULL_VIEW)
  const [panning, setPanning] = useState(false)
  const viewRef = useRef<ChartView>(FULL_VIEW)
  const geometry = useRef({ width, padLeft: pad.left, padTop: pad.top, innerWidth, innerHeight })
  useEffect(() => {
    viewRef.current = view
    geometry.current = { width, padLeft: pad.left, padTop: pad.top, innerWidth, innerHeight }
  })
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  const justPanned = useRef(false)

  const apply = useCallback((next: ChartView) => {
    viewRef.current = next
    setView(next)
  }, [])
  /** A screen position as a relative position in the plot, 0..1 from the left and from the bottom. */
  const toPlot = useCallback((clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect()
    const g = geometry.current
    if (!rect || !rect.width) return { rx: 0.5, ry: 0.5 }
    const scale = g.width / rect.width
    return { rx: ((clientX - rect.left) * scale - g.padLeft) / g.innerWidth, ry: 1 - ((clientY - rect.top) * scale - g.padTop) / g.innerHeight }
  }, [])
  const zoomBy = useCallback((factor: number) => apply(zoomView(viewRef.current, factor)), [apply])
  const hasPoints = model.points.length > 0

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    // Needs a native, non-passive listener so the page does not scroll as well.
    const onWheel = (event: WheelEvent) => {
      const current = viewRef.current
      const unit = event.deltaMode === 1 ? 33 : event.deltaMode === 2 ? 400 : 1
      const factor = Math.exp(-event.deltaY * unit * (event.ctrlKey ? 0.01 : 0.002))
      // At full view only a zoom-in is taken, so scrolling down the page past the chart still works.
      if (factor === 1 || (factor < 1 && !isZoomed(current))) return
      event.preventDefault()
      const { rx, ry } = toPlot(event.clientX, event.clientY)
      apply(zoomView(current, factor, Math.min(1, Math.max(0, rx)), Math.min(1, Math.max(0, ry))))
    }
    svg.addEventListener('wheel', onWheel, { passive: false })
    return () => svg.removeEventListener('wheel', onWheel)
  }, [hasPoints, apply, toPlot])

  function beginGesture(event: React.PointerEvent<SVGSVGElement>) {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    const current = viewRef.current
    const touches = [...pointers.current.values()]
    if (touches.length === 1) {
      const { rx, ry } = toPlot(event.clientX, event.clientY)
      const { gx, gy } = pointInView(current, rx, ry)
      gesture.current = { kind: 'drag', startX: event.clientX, startY: event.clientY, gx, gy, span: current.span, moved: false }
    } else if (touches.length === 2) {
      const [a, b] = touches
      const { rx, ry } = toPlot((a.x + b.x) / 2, (a.y + b.y) / 2)
      const { gx, gy } = pointInView(current, rx, ry)
      gesture.current = { kind: 'pinch', startDistance: Math.hypot(a.x - b.x, a.y - b.y) || 1, gx, gy, span: current.span }
      for (const id of pointers.current.keys()) svgRef.current?.setPointerCapture(id)
      setPanning(true)
    }
  }

  function moveGesture(event: React.PointerEvent<SVGSVGElement>) {
    const known = pointers.current.get(event.pointerId)
    const active = gesture.current
    if (!known || !active) return
    known.x = event.clientX
    known.y = event.clientY
    if (active.kind === 'drag') {
      if (!active.moved) {
        // Nothing to pan at full view, and a still pointer is a click: leave both to the dots.
        if (!isZoomed(viewRef.current) || Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < 5) return
        active.moved = true
        svgRef.current?.setPointerCapture(event.pointerId)
        setPanning(true)
      }
      const { rx, ry } = toPlot(event.clientX, event.clientY)
      apply(viewAnchoredAt(active.span, active.gx, active.gy, rx, ry))
    } else {
      const [a, b] = [...pointers.current.values()]
      const spread = Math.hypot(a.x - b.x, a.y - b.y) / active.startDistance
      const { rx, ry } = toPlot((a.x + b.x) / 2, (a.y + b.y) / 2)
      apply(viewAnchoredAt(active.span / spread, active.gx, active.gy, rx, ry))
    }
  }

  function endGesture(event: React.PointerEvent<SVGSVGElement>) {
    if (!pointers.current.delete(event.pointerId)) return
    const ended = gesture.current
    if (ended && (ended.kind === 'pinch' || ended.moved)) {
      // The click that follows a drag or pinch belongs to the gesture, not to a dot underneath.
      justPanned.current = true
      setTimeout(() => { justPanned.current = false }, 0)
    }
    if (svgRef.current?.hasPointerCapture(event.pointerId)) svgRef.current.releasePointerCapture(event.pointerId)
    const remaining = [...pointers.current.values()]
    if (remaining.length === 1 && ended?.kind === 'pinch') {
      // One finger left after a pinch carries on as a pan.
      const current = viewRef.current
      const { rx, ry } = toPlot(remaining[0].x, remaining[0].y)
      const { gx, gy } = pointInView(current, rx, ry)
      gesture.current = { kind: 'drag', startX: remaining[0].x, startY: remaining[0].y, gx, gy, span: current.span, moved: true }
    } else if (remaining.length === 0) {
      gesture.current = null
      setPanning(false)
    }
  }

  const [yLow, yHigh] = model.yDomain
  const left = view.cx - view.span / 2
  const bottom = view.cy - view.span / 2
  const xMin = left * PRICE_MAX
  const xMax = (left + view.span) * PRICE_MAX
  const yMin = yLow + bottom * (yHigh - yLow)
  const yMax = yLow + (bottom + view.span) * (yHigh - yLow)
  const x = (price: number) => pad.left + ((price - xMin) / (xMax - xMin)) * innerWidth
  const y = (power: number) => pad.top + (1 - (power - yMin) / (yMax - yMin)) * innerHeight
  const xAxis = niceTicks(xMin, xMax, compact ? 4 : 7, 10)
  const yAxis = niceTicks(yMin, yMax, compact ? 5 : 6, 1)
  const priceTick = (tick: number) => (tick === 0 ? '£0' : xAxis.step >= 500 ? `£${tick / 1000}k` : `£${NUMBER.format(tick)}`)
  // The line joins only machines faster than everything cheaper. Frontier dots
  // that earn their place on RAM or storage stay highlighted but off the line,
  // which would otherwise zigzag.
  const pathFor = (points: ChartListing[]) => {
    let fastest = -Infinity
    return points
      .filter((point) => point.plottedPower > fastest && (fastest = point.plottedPower, true))
      .map((point, index) => `${index ? 'L' : 'M'} ${x(point.plottedPrice)} ${y(point.plottedPower)}`).join(' ')
  }
  const frontierPath = pathFor(model.frontier)
  const frontier32Path = pathFor(model.frontier32)
  const equalValuePath = `M ${x(0)} ${y(0)} L ${x(PRICE_MAX)} ${y(PRICE_MAX * EQUAL_VALUE_SLOPE)}`
  // Frontier dots are drawn last so they are never buried; the order is fixed,
  // so opening a dot never reorders the DOM and drops keyboard focus.
  const drawOrder = useMemo(
    () => [...model.points].sort((a, b) => Number(model.frontierIds.has(a.id)) - Number(model.frontierIds.has(b.id))),
    [model],
  )
  const selected = model.points.find((point) => point.id === selectedId) ?? null

  // The "better value" label rides the visible part of the equal-value line, at its slope.
  const lineLabel = (() => {
    const text = compact ? 'BETTER VALUE ↑' : 'BETTER VALUE THAN YOUR G16 ↑'
    const from = Math.max(xMin, yMin / EQUAL_VALUE_SLOPE)
    const to = Math.min(xMax, yMax / EQUAL_VALUE_SLOPE)
    if (to <= from) return null
    const ax = x(from)
    const ay = y(from * EQUAL_VALUE_SLOPE)
    const bx = x(to)
    const by = y(to * EQUAL_VALUE_SLOPE)
    const length = Math.hypot(bx - ax, by - ay)
    const needed = text.length * 6.4
    // Toward the top of the visible line, where there is least data; centred if the line is short.
    const along = Math.min(0.8, 1 - (needed / 2 + 12) / length)
    if (along < 0.5) return null
    return { text, cx: ax + (bx - ax) * along, cy: ay + (by - ay) * along, angle: (Math.atan2(by - ay, bx - ax) * 180) / Math.PI }
  })()
  const baselineLabelWidth = compact ? 118 : 173
  const baselineLabelX = x(BASELINE_PRICE) + 8
  const baselineLabelY = Math.min(y(100) + 10, pad.top + innerHeight - 30)
  const showBaselineLabel = y(100) > pad.top && y(100) < pad.top + innerHeight - 4
    && baselineLabelX > pad.left && baselineLabelX + baselineLabelWidth < width - pad.right

  function open(point: ChartListing) {
    onSelect(point)
    onOpen(point.id)
  }

  /** Keyboard focus can land on a dot outside the zoomed window; bring it in. */
  function reveal(point: ChartListing) {
    const gx = point.plottedPrice / PRICE_MAX
    const gy = (point.plottedPower - yLow) / (yHigh - yLow)
    if (!viewContains(viewRef.current, gx, gy, 0.04)) apply(centreOn(viewRef.current, gx, gy))
  }

  function handleKeys(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === '+' || event.key === '=') zoomBy(BUTTON_ZOOM)
    else if (event.key === '-' || event.key === '_') zoomBy(1 / BUTTON_ZOOM)
    else if (event.key === '0') apply(FULL_VIEW)
  }

  const zoomed = isZoomed(view)
  const openedPlotted = model.points.filter((point) => openedIds.has(point.id)).length

  return (
    <div className="chart-wrap" ref={wrapRef} onKeyDown={handleKeys}>
      {!hasPoints ? (
        <div className="chart-empty">
          <Filter size={28} aria-hidden="true" />
          <strong>No laptops match these filters</strong>
          <span>Switch on the other RAM tier, loosen a filter, or reset the controls.</span>
        </div>
      ) : (
        <>
          <div className="chart-toolbar">
            <p className="chart-hint">Scroll, pinch or use + / − to zoom · drag to pan · double-click to zoom in</p>
            <div className="zoom-controls" role="group" aria-label="Zoom the chart">
              <button type="button" onClick={() => zoomBy(1 / BUTTON_ZOOM)} disabled={!zoomed} aria-label="Zoom out" title="Zoom out (−)"><ZoomOut size={16} aria-hidden="true" /></button>
              <button type="button" onClick={() => zoomBy(BUTTON_ZOOM)} disabled={view.span <= MIN_SPAN + 1e-9} aria-label="Zoom in" title="Zoom in (+)"><ZoomIn size={16} aria-hidden="true" /></button>
              <span className="zoom-level" aria-live="polite">{zoomLevel(view).toFixed(1)}×</span>
              <button type="button" className="zoom-reset" onClick={() => apply(FULL_VIEW)} disabled={!zoomed} title="Show everything (0)"><Maximize2 size={14} aria-hidden="true" />Reset</button>
            </div>
          </div>
          <svg
            ref={svgRef}
            tabIndex={-1}
            className={`power-chart${zoomed ? ' is-zoomed' : ''}${panning ? ' is-panning' : ''}`}
            viewBox={`0 0 ${width} ${height}`}
            role="img"
            aria-labelledby={`${clipId}-title ${clipId}-desc`}
            onPointerDown={beginGesture}
            onPointerMove={moveGesture}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
            onDoubleClick={(event) => {
              const { rx, ry } = toPlot(event.clientX, event.clientY)
              if (rx >= 0 && rx <= 1 && ry >= 0 && ry <= 1) apply(zoomView(viewRef.current, 2, rx, ry))
            }}
          >
            <title id={`${clipId}-title`}>Advertised price versus backtesting work performance</title>
            <desc id={`${clipId}-desc`}>{model.points.length} qualifying eBay listings compared with the current ASUS G16 at work performance 100 and £1,170. Zoom with the buttons, the scroll wheel or a pinch.</desc>
            <defs>
              <clipPath id={clipId}><rect x={pad.left} y={pad.top} width={innerWidth} height={innerHeight} /></clipPath>
            </defs>
            <g className="chart-grid" aria-hidden="true">
              {xAxis.ticks.map((tick) => <line key={`x-${tick}`} x1={x(tick)} x2={x(tick)} y1={pad.top} y2={height - pad.bottom} />)}
              {yAxis.ticks.map((tick) => <line key={`y-${tick}`} x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />)}
            </g>
            <g className="chart-axes" aria-hidden="true">
              {xAxis.ticks.map((tick) => <text key={tick} x={x(tick)} y={height - 26} textAnchor="middle">{priceTick(tick)}</text>)}
              {yAxis.ticks.map((tick) => <text key={tick} x={pad.left - 14} y={y(tick) + 4} textAnchor="end">{tick}</text>)}
              <text x={pad.left + innerWidth / 2} y={height - 4} textAnchor="middle" className="axis-title">ADVERTISED PRICE</text>
              <text transform={`translate(${compact ? 11 : 17} ${pad.top + innerHeight / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">{compact ? 'WORK PERFORMANCE' : 'BACKTESTING WORK PERFORMANCE'}</text>
            </g>
            <g clipPath={`url(#${clipId})`}>
              <line className="baseline-line" x1={pad.left} x2={width - pad.right} y1={y(100)} y2={y(100)} />
              <line className="baseline-price" x1={x(BASELINE_PRICE)} x2={x(BASELINE_PRICE)} y1={pad.top} y2={height - pad.bottom} />
              <path className="equal-value-line" d={equalValuePath} />
              {lineLabel && <text className="value-region-label" textAnchor="middle" transform={`translate(${lineLabel.cx} ${lineLabel.cy}) rotate(${lineLabel.angle}) translate(0 -8)`}>{lineLabel.text}</text>}
              {frontier32Path && <path className="pareto-line tier-32" d={frontier32Path} />}
              {frontierPath && <path className="pareto-line" d={frontierPath} />}
              {drawOrder.map((point) => {
                const opened = openedIds.has(point.id)
                const value = assessValue(point.plottedPower, point.valuePrice)
                const px = x(point.plottedPrice)
                const py = y(point.plottedPower)
                const extent = point.ramTier === 32 ? radius * DIAMOND_SCALE : radius
                return (
                  <g
                    key={point.id}
                    className="point"
                    tabIndex={0}
                    role="button"
                    aria-label={`${point.title}, ${point.ramGb} GB, ${MONEY.format(point.plottedPrice)} advertised, work performance ${point.plottedPower}, ${value.label}, ${opened ? 'clicked' : 'not clicked yet'}`}
                    onClick={() => { if (!justPanned.current) open(point) }}
                    onFocus={(event) => {
                      onSelect(point)
                      if (event.currentTarget.matches(':focus-visible')) reveal(point)
                    }}
                    onMouseEnter={() => { if (!panning) onSelect(point) }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        open(point)
                      }
                    }}
                  >
                    {model.frontierIds.has(point.id) && <circle className={`halo-frontier tier-${point.ramTier}`} cx={px} cy={py} r={extent + 3.5} />}
                    <Marker tier={point.ramTier} x={px} y={py} r={radius} opened={opened} />
                    <title>{`${point.title}\n${point.ramGb} GB · ${MONEY.format(point.plottedPrice)} advertised · work performance ${point.plottedPower}\n${value.label}\n${opened ? 'Clicked' : 'Not clicked yet'}`}</title>
                  </g>
                )
              })}
              {selected && (
                <g className="selected-overlay" aria-hidden="true">
                  <circle className="halo-selected" cx={x(selected.plottedPrice)} cy={y(selected.plottedPower)} r={(selected.ramTier === 32 ? radius * DIAMOND_SCALE : radius) + 8} />
                  <Marker tier={selected.ramTier} x={x(selected.plottedPrice)} y={y(selected.plottedPower)} r={radius + 1} opened={openedIds.has(selected.id)} extra=" is-selected" />
                </g>
              )}
            </g>
            {showBaselineLabel && (
              <g className="baseline-label" aria-hidden="true">
                {/* Sits below the baseline line: every qualifying listing scores at
                    least 100, so the band underneath is always empty, while the band
                    above is where the cheapest near-baseline machines plot. */}
                <rect x={baselineLabelX} y={baselineLabelY} width={baselineLabelWidth} height="24" rx="2" />
                <text x={baselineLabelX + 9} y={baselineLabelY + 16}>{compact ? 'YOUR G16 · £1,170' : 'YOUR G16 · £1,170 · 100'}</text>
              </g>
            )}
          </svg>
        </>
      )}
      <ChartKey model={model} opened={openedPlotted} onClear={onClearOpened} />
      <div className="chart-selection" aria-live="polite">
        {selected ? (
          <>
            <div><LiveBadge status={live.get(selected.id)} capturedAt={capturedAt} /><strong>{selected.title}</strong><span>{selected.cpuModel} · {selected.gpuModel} · {selected.ramGb} GB · {selected.condition}</span><small>Multi-core {signedPercent(selected.cpuMultiPower)} · single-thread {signedPercent(selected.cpuSinglePower)}</small><small>{buildRecommendationReason(selected, { minRamGb: selected.ramTier })}</small></div>
            <div className="selection-numbers"><strong>{MONEY.format(selected.plottedPrice)} advertised</strong>{selected.snapshotPrice != null && <span className="upgrade-total">{selected.plottedPrice < selected.snapshotPrice ? 'reduced' : 'raised'} from {MONEY.format(selected.snapshotPrice)}</span>}{selected.upgradeCost ? <span className="upgrade-total">≈ {MONEY.format(selected.plottedPrice + selected.upgradeCost)} with a 64 GB kit</span> : selected.upgradeCost === null ? <span className="upgrade-total">RAM soldered: stays {selected.ramGb} GB</span> : null}<span>work performance {signedPercent(selected.plottedPower)} · {assessValue(selected.plottedPower, selected.valuePrice).label}</span>{selected.surplusCredit > 0 && <small>value uses {MONEY.format(selected.valuePrice)} after {MONEY.format(selected.surplusCredit)} surplus RAM and storage credit</small>}</div>
            <a href={selected.listingUrl} target="_blank" rel="noreferrer" onClick={() => onOpen(selected.id)}>View on eBay <ArrowUpRight size={14} /></a>
          </>
        ) : <span>Hover or focus a point to inspect it; click or tap to mark it as clicked.</span>}
      </div>
    </div>
  )
}

function ListingCard({ row, gate = {}, shortlisted, onShortlist }: { row: LaptopListing; gate?: GateOptions; shortlisted: boolean; onShortlist: () => void }) {
  const risk = row.riskFlags.length > 0 || row.hardExcluded
  const readiness = classifyReadiness(row, gate)
  const assessment = assessBestBuy(row, gate)
  const value = assessment.workPerformance == null ? null : assessValue(assessment.workPerformance, assessment.effectivePrice)
  const readinessLabel = {
    ready: gate.minRamGb === 32 ? 'Passes at 32 GB' : 'Passes every floor',
    'specs-incomplete': 'Not a confirmed match',
  }[readiness]
  return (
    <article className={`listing-card readiness-${readiness}${readiness !== 'ready' ? ' needs-checking' : ''}`}>
      <div className="listing-image">
        {row.imageUrl ? <img src={row.imageUrl} alt="" loading="lazy" /> : <Laptop aria-hidden="true" />}
        <span className={`confidence confidence-${row.specConfidence}`}>{row.specConfidence} confidence</span>
      </div>
      <div className="listing-main">
        <div className="listing-kicker">
          {isNewListing(row) && <span className="new-badge">NEW</span>}
          <span>{row.condition}</span>
          <span className={`readiness-badge readiness-${readiness}`}>{readinessLabel}</span>
          {row.aiEnrichment && <span className="ai-assisted"><Sparkles size={11} />Luna checked</span>}
          {row.returnsAccepted === true && <span className="positive"><ShieldCheck size={13} />Returns</span>}
          {risk && <span className="warning"><TriangleAlert size={13} />{row.riskFlags[0] ?? row.hardExclusionReason}</span>}
        </div>
        <h3>{row.title}</h3>
        <div className="spec-strip">
          <span><Cpu size={14} />{row.cpuModel?.replace('Intel Core ', '').replace('AMD ', '') ?? 'CPU unknown'}</span>
          <span><Zap size={14} />{row.gpuModel?.replace('NVIDIA GeForce ', '').replace(' Laptop GPU', '') ?? 'GPU unknown'}</span>
          <span><MemoryStick size={14} />{row.ramGb ? `${row.ramGb} GB` : 'RAM unknown'}</span>
          <span>{row.storageGb ? `${row.storageGb >= 1024 ? `${row.storageGb / 1024} TB` : `${row.storageGb} GB`} storage` : 'Storage unknown'}</span>
          <span>{row.screenInches ? `${row.screenInches}"${row.resolution ? ` ${row.resolution}` : ''}` : 'Screen unknown'}</span>
          {row.weightKg != null && <span>{row.weightKg} kg</span>}
        </div>
        <p className="seller-line">{row.sellerName} · {row.sellerFeedbackPercent == null ? 'feedback unknown' : `${row.sellerFeedbackPercent}% (${NUMBER.format(row.sellerFeedbackScore ?? 0)})`} · {row.location || 'location unknown'}</p>
        {row.missingSpecs.length > 0 && <p className="missing-line"><CircleAlert size={14} /> Check {row.missingSpecs.join(', ')} before buying</p>}
        <p className="recommendation-line"><Sparkles size={14} />{buildRecommendationReason(row, gate)}</p>
      </div>
      <div className="listing-metrics">
        <div><span>Advertised</span><strong>{MONEY.format(row.price)}</strong><small>{assessment.surplusCredit > 0 ? `value uses ${MONEY.format(assessment.effectivePrice)} after surplus credit` : 'postage is never ranked'}</small></div>
        <div className="power-number"><span>Work performance</span><strong>{assessment.workPerformance == null ? '—' : signedPercent(assessment.workPerformance)}</strong><small>multi {signedPercent(row.cpuMultiPower)} · single {signedPercent(row.cpuSinglePower)}</small></div>
        <div><span>Work value</span><strong>{value ? `${Math.round(value.ratio * 100)}%` : '—'}</strong><small>{value?.label ?? 'needs audited benchmark evidence'}</small></div>
      </div>
      <div className="listing-actions">
        <button type="button" className={`icon-button${shortlisted ? ' is-active' : ''}`} onClick={onShortlist} aria-label={shortlisted ? 'Remove from shortlist' : 'Add to shortlist'}>
          <Heart size={17} fill={shortlisted ? 'currentColor' : 'none'} />
        </button>
        <a className="ebay-button" href={row.listingUrl} target="_blank" rel="noreferrer">eBay <ExternalLink size={15} /></a>
      </div>
    </article>
  )
}

function ShortlistComparison({ rows, onRemove }: { rows: LaptopListing[]; onRemove: (id: string) => void }) {
  const visible = rows.slice(0, 6)
  const values: Array<[string, (row: LaptopListing) => React.ReactNode]> = [
    ['Advertised price', (row) => MONEY.format(row.price)],
    ['Work performance', (row) => signedPercent(row.workPerformance)],
    ['Multi / single', (row) => `${signedPercent(row.cpuMultiPower)} / ${signedPercent(row.cpuSinglePower)}`],
    ['Work value', (row) => row.workPerformance == null ? 'Unknown' : assessValue(row.workPerformance, effectivePrice(row)).label],
    ['CPU', (row) => row.cpuModel ?? 'Unknown'],
    ['GPU', (row) => row.gpuModel ?? 'Unknown'],
    ['RAM / storage', (row) => `${row.ramGb ?? '—'} GB / ${row.storageGb ?? '—'} GB`],
    ['Seller', (row) => row.sellerFeedbackPercent == null ? 'Unknown' : `${row.sellerFeedbackPercent}% (${NUMBER.format(row.sellerFeedbackScore ?? 0)})`],
    ['Returns', (row) => row.returnsAccepted === true ? 'Accepted' : row.returnsAccepted === false ? 'Not accepted' : 'Unknown'],
    ['Confidence', (row) => row.specConfidence],
    ['Risks', (row) => row.riskFlags.length ? row.riskFlags.join(', ') : 'None detected'],
  ]
  return (
    <div className="comparison-wrap">
      {rows.length > visible.length && <p>Showing the first {visible.length} of {rows.length} saved machines.</p>}
      <table className="comparison-table">
        <thead><tr><th scope="col">Metric</th>{visible.map((row) => <th scope="col" key={row.id}><span>{row.title}</span><button type="button" onClick={() => onRemove(row.id)}>Remove</button></th>)}</tr></thead>
        <tbody>
          {values.map(([label, render]) => <tr key={label}><th scope="row">{label}</th>{visible.map((row) => <td key={row.id}>{render(row)}</td>)}</tr>)}
          <tr><th scope="row">Listing</th>{visible.map((row) => <td key={row.id}><a href={row.listingUrl} target="_blank" rel="noreferrer">Open on eBay <ExternalLink size={13} /></a></td>)}</tr>
        </tbody>
      </table>
    </div>
  )
}

function App() {
  const [dataset, setDataset] = useState<LaptopDataset | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [filters, setFilters] = useState<LaptopFilters>(() => createDefaultFilters())
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Open on every qualifying machine. "New" only holds what appeared in the
  // last 24 hours, which on most days is nothing, and an empty first screen
  // reads as a broken board.
  const [mode, setMode] = useState<ResultMode>('matches')
  const [sortMode, setSortMode] = useState<SortMode>('recommended')
  const [shortlist, setShortlist] = useState<Set<string>>(() => parseShortlist(localStorage.getItem(SHORTLIST_STORAGE_KEY)))
  const [tiers, setTiers] = useState<Set<RamTier>>(loadTiers)
  // Dots whose listing has been clicked, tapped or opened on eBay. Remembered in
  // this browser so a return visit shows what is new to you at a glance.
  const [openedIds, setOpenedIds] = useState<Set<string>>(() => {
    try {
      return parseSeen(localStorage.getItem(SEEN_STORAGE_KEY))
    } catch {
      return new Set()
    }
  })
  const [drawer, setDrawer] = useState<DrawerName | null>(null)
  const [live, setLive] = useState<Map<string, LiveStatus>>(() => new Map())
  const [liveCheck, setLiveCheck] = useState<LiveCheck | null>(null)
  const drawerTrigger = useRef<HTMLElement | null>(null)
  const openDrawer = (name: DrawerName) => {
    drawerTrigger.current = document.activeElement as HTMLElement | null
    setDrawer(name)
  }
  const closeDrawer = useCallback(() => {
    setDrawer(null)
    requestAnimationFrame(() => drawerTrigger.current?.focus())
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/data/laptop-listings.json', { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Live data request returned HTTP ${response.status}`)
        return response.json() as Promise<LaptopDataset>
      })
      .then(setDataset)
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    localStorage.setItem(SHORTLIST_STORAGE_KEY, serializeShortlist(shortlist))
  }, [shortlist])

  useEffect(() => {
    try {
      localStorage.setItem(TIER_STORAGE_KEY, JSON.stringify([...tiers]))
    } catch {
      // Remembering the toggle is a convenience only.
    }
  }, [tiers])

  useEffect(() => {
    try {
      localStorage.setItem(SEEN_STORAGE_KEY, serializeSeen(openedIds))
    } catch {
      // Remembering what was opened is a convenience only.
    }
  }, [openedIds])

  const openListing = useCallback((id: string) => setOpenedIds((current) => markSeen(current, id)), [])
  const clearOpened = useCallback(() => setOpenedIds(new Set()), [])

  const facets = useMemo(() => deriveFacets(dataset?.listings ?? []), [dataset])
  // Every listing that can be plotted at either RAM tier gets a live check
  // when the page opens; ended ones leave the chart and the lists.
  const liveIds = useMemo(
    () => (dataset?.listings ?? []).filter((row) => assessBestBuy(row, { minRamGb: 32 }).eligible).map((row) => row.id),
    [dataset],
  )
  useEffect(() => {
    if (!liveIds.length) return
    const ids = liveIds
    let cancelled = false
    let checked = 0
    let ended = 0
    const found = new Map<string, LiveStatus>()
    checkListings(ids, fetchListingStatus, (batch) => {
      if (cancelled) return
      for (const status of batch) {
        found.set(status.id, status)
        if (status.state === 'ended') ended += 1
      }
      checked += batch.length
      setLive(new Map(found))
      setLiveCheck({ phase: 'checking', checked, total: ids.length, ended })
    }).then((outcome) => {
      if (!cancelled) setLiveCheck({ phase: outcome, checked, total: ids.length, ended })
    })
    return () => { cancelled = true }
  }, [liveIds])

  // Ended listings leave; a changed price moves the dot to what eBay asks now.
  const liveListings = useMemo(
    () => (dataset?.listings ?? []).flatMap((row) => {
      const status = live.get(row.id)
      if (status?.state === 'ended') return []
      if (status?.state === 'live' && status.price != null && Math.abs(status.price - row.price) >= 1) {
        return [{ ...row, price: status.price, snapshotPrice: row.price }]
      }
      return [row]
    }),
    [dataset, live],
  )
  const groups = useMemo(() => partitionResults(liveListings, filters, query), [liveListings, filters, query])
  const filtered = groups.matches
  const ram32 = groups.ram32Matches
  const newMatches = groups.newMatches
  const needsChecking = groups.needsChecking
  const shortlistRows = useMemo(() => (dataset?.listings ?? []).filter((row) => shortlist.has(row.id)), [dataset, shortlist])
  const gate = useMemo<GateOptions>(() => (mode === 'ram32' ? { minRamGb: 32 } : {}), [mode])
  const displayed = useMemo(() => {
    const rows = mode === 'new' ? newMatches : mode === 'matches' ? filtered : mode === 'ram32' ? ram32 : mode === 'needs-checking' ? needsChecking : shortlistRows
    if (sortMode === 'price') return rows.slice().sort((a, b) => chartPrice(a).price - chartPrice(b).price)
    if (sortMode === 'power') return rows.slice().sort((a, b) => (b.workPerformance ?? -1) - (a.workPerformance ?? -1))
    if (sortMode === 'value') return rows.slice().sort((a, b) => {
      const aValue = a.workPerformance == null ? -1 : assessValue(a.workPerformance, effectivePrice(a)).ratio
      const bValue = b.workPerformance == null ? -1 : assessValue(b.workPerformance, effectivePrice(b)).ratio
      return bValue - aValue
    })
    if (mode === 'shortlist' || mode === 'needs-checking') return rows
    return rankListings(rows, gate)
  }, [filtered, gate, mode, needsChecking, newMatches, ram32, shortlistRows, sortMode])
  const chart = useMemo(() => buildChartModel({
    ram64: tiers.has(64) ? filtered : [],
    ram32: tiers.has(32) ? ram32 : [],
  }), [filtered, ram32, tiers])

  const effectiveSelectedId = selectedId && chart.points.some((row) => row.id === selectedId)
    ? selectedId
    : chart.frontier[0]?.id ?? chart.frontier32[0]?.id ?? chart.points[0]?.id ?? null

  function toggleTier(tier: RamTier) {
    setTiers((current) => {
      const next = new Set(current)
      if (next.has(tier)) next.delete(tier)
      else next.add(tier)
      // Never leave the chart with nothing to plot.
      return next.size ? next : current
    })
  }

  function setNumber<K extends keyof LaptopFilters>(key: K, value: number) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function setBoolean<K extends keyof LaptopFilters>(key: K, value: boolean) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  function toggleFilter(key: SetFilterKey, value: string) {
    setFilters((current) => ({ ...current, [key]: toggleSelection(current[key] as Set<string>, value) }))
  }

  function reset() {
    setFilters(createDefaultFilters())
    setQuery('')
    setSortMode('recommended')
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, current: ResultMode) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const currentIndex = RESULT_MODES.indexOf(current)
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? RESULT_MODES.length - 1
        : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + RESULT_MODES.length) % RESULT_MODES.length
    const next = RESULT_MODES[nextIndex]
    setMode(next)
    requestAnimationFrame(() => document.getElementById(`tab-${next}`)?.focus())
  }

  if (loadError) {
    return <main className="load-state"><CircleAlert /><h1>Live laptop data could not load</h1><p>{loadError}</p><button onClick={() => location.reload()}><RefreshCw size={16} />Try again</button></main>
  }
  if (!dataset) {
    return <main className="load-state"><span className="loader" /><h1>Loading current eBay laptops</h1><p>Preparing power and price comparisons…</p></main>
  }

  // Until the first batch lands, the check is simply starting.
  const liveNote: LiveCheck = liveCheck ?? { phase: 'checking', checked: 0, total: liveIds.length, ended: 0 }

  const tabs: Array<[ResultMode, string, number]> = [
    ['new', 'New', newMatches.length],
    ['matches', '64 GB', filtered.length],
    ['ram32', '32 GB', ram32.length],
    ['needs-checking', 'Needs info', needsChecking.length],
    ['shortlist', 'Shortlist', shortlistRows.length],
  ]

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="brand-lockup">
          <div className="brand-mark"><Gauge size={25} /></div>
          <div><span className="eyebrow">EBAY UK · LIVE REPLACEMENT SEARCH</span><h1>Laptop Power Finder</h1></div>
        </div>
        <div className="header-tools">
          <div className="data-status"><span className="live-pulse" /><div><strong>{dataset.listingCount} listings scanned</strong><span>Captured {ageLabel(dataset.generatedAt)} · {dataset.scoredCount} power-scored</span></div></div>
          <button className="drawer-button" type="button" onClick={() => openDrawer('filters')}><SlidersHorizontal size={15} />Filters</button>
          <button className="drawer-button" type="button" onClick={() => openDrawer('listings')}><Laptop size={15} />Listings{newMatches.length > 0 && <span className="drawer-badge">{newMatches.length} new</span>}</button>
        </div>
      </header>

      <main className="dashboard-main">
        <section className="graph-section graph-hero">
          <div className="section-heading">
            <div><span>ADVERTISED PRICE / WORK PERFORMANCE · YOUR G16 = 100</span><h2>Where your money buys faster backtesting</h2></div>
            <div className="tier-toggle" role="group" aria-label="RAM shown on the chart">
              {RAM_TIERS.map((tier) => (
                <button key={tier} type="button" className={`tier-button tier-${tier}${tiers.has(tier) ? ' is-active' : ''}`} aria-pressed={tiers.has(tier)} onClick={() => toggleTier(tier)}>
                  <MemoryStick size={15} aria-hidden="true" />{tier} GB<span>{tier === 64 ? filtered.length : ram32.length}</span>
                </button>
              ))}
            </div>
          </div>
          {tiers.has(32) && <p className="tier-note"><MemoryStick size={14} aria-hidden="true" />Diamonds have 32 GB and pass every other floor. A 64 GB kit costs about {MONEY.format(RAM_UPGRADE_GBP)} today; tap a dot for the total.</p>}
          <p className={`live-note phase-${liveNote.phase}`}>
            <span className="live-dot" aria-hidden="true" />
            {liveNote.phase === 'checking' && <>Checking each laptop is still for sale on eBay… {liveNote.checked} of {liveNote.total}{liveNote.ended > 0 && ` · ${liveNote.ended} sold or ended, removed`}</>}
            {liveNote.phase === 'done' && <>Every dot checked live on eBay just now{liveNote.ended > 0 ? ` · ${liveNote.ended} sold or ended since the ${new Date(dataset.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} refresh, removed` : ' · all still for sale'}</>}
            {liveNote.phase === 'unavailable' && <>Live check unavailable — showing the snapshot from {ageLabel(dataset.generatedAt)}, so a dot may have sold since</>}
          </p>
          <PowerChart model={chart} selectedId={effectiveSelectedId} onSelect={(row) => setSelectedId(row.id)} onOpen={openListing} openedIds={openedIds} onClearOpened={clearOpened} live={live} capturedAt={dataset.generatedAt} />
        </section>
      </main>

      <Drawer open={drawer === 'filters'} side="left" title="Filters" onClose={closeDrawer}>
        <div className="filter-rail">
          <div className="filter-heading"><SlidersHorizontal size={17} /><strong>Decision controls</strong><span>{chart.points.length} plotted</span><button className="reset-button" type="button" onClick={reset}><RotateCcw size={15} />Reset</button></div>
          <label className="search-control"><Search size={15} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search model, CPU or GPU" /><span className="sr-only">Search listings</span></label>

          <FilterSection title="Price & power">
            <RangeControl label="Minimum price" value={filters.minPrice} min={0} max={3000} step={50} display={MONEY.format(filters.minPrice)} onChange={(value) => setNumber('minPrice', Math.min(value, filters.maxPrice))} />
            <RangeControl label="Maximum price" value={filters.maxPrice} min={0} max={3000} step={50} display={MONEY.format(filters.maxPrice)} onChange={(value) => setNumber('maxPrice', Math.max(value, filters.minPrice))} />
            <RangeControl label="Minimum work performance" value={filters.minCombinedPower} min={0} max={180} step={5} display={filters.minCombinedPower ? `${rangeLabel(filters.minCombinedPower)}${filters.minCombinedPower === 100 ? ' · your G16' : ''}` : 'Any qualifying match'} onChange={(value) => setNumber('minCombinedPower', value)} />
            <RangeControl label="Minimum multi-core" value={filters.minCpuPower} min={0} max={180} step={5} display={filters.minCpuPower ? `${rangeLabel(filters.minCpuPower)}${filters.minCpuPower === 100 ? ' · your G16' : ''}` : 'Any qualifying match'} onChange={(value) => setNumber('minCpuPower', value)} />
            <div className="priority-control">
              <div><span>Backtesting score</span><strong>70% multi-core · 30% single-thread</strong></div>
              <div className="priority-labels"><span>GPU has zero ranking weight</span><span>RTX 4060 minimum enforced</span></div>
            </div>
          </FilterSection>

          <FilterSection title="Hardware">
            <p className="filter-note">RAM is set by the 32 GB / 64 GB buttons on the chart.</p>
            <RangeControl label="Minimum VRAM" value={filters.minVramGb} min={0} max={24} step={2} display={filters.minVramGb ? `${filters.minVramGb} GB` : 'Any'} onChange={(value) => setNumber('minVramGb', value)} />
            <RangeControl label="Minimum storage" value={filters.minStorageGb} min={0} max={4096} step={256} display={filters.minStorageGb ? `${filters.minStorageGb >= 1024 ? `${filters.minStorageGb / 1024} TB` : `${filters.minStorageGb} GB`}` : 'Any'} onChange={(value) => setNumber('minStorageGb', value)} />
            <RangeControl label="Minimum screen" value={filters.minScreenInches} min={0} max={18} step={0.5} display={filters.minScreenInches ? `${filters.minScreenInches} in` : 'Any'} onChange={(value) => setNumber('minScreenInches', value)} />
            <RangeControl label="Maximum screen" value={filters.maxScreenInches} min={13} max={20} step={0.5} display={`${filters.maxScreenInches} in`} onChange={(value) => setNumber('maxScreenInches', value)} />
          </FilterSection>

          <FilterSection title="Seller & safety">
            <RangeControl label="Seller feedback" value={filters.minSellerFeedback} min={0} max={100} step={0.5} display={filters.minSellerFeedback ? `${filters.minSellerFeedback}%+` : 'Any'} onChange={(value) => setNumber('minSellerFeedback', value)} />
            <RangeControl label="Feedback count" value={filters.minSellerFeedbackCount} min={0} max={2000} step={50} display={filters.minSellerFeedbackCount ? `${NUMBER.format(filters.minSellerFeedbackCount)}+` : 'Any'} onChange={(value) => setNumber('minSellerFeedbackCount', value)} />
            <Switch checked={filters.returnsRequired} label="Returns required" onChange={(value) => setBoolean('returnsRequired', value)} />
            <Switch checked={filters.ukOnly} label="UK item location" onChange={(value) => setBoolean('ukOnly', value)} />
            <Switch checked={filters.showNeedsChecking} label="Include unknown power" hint="Keeps these off the graph" onChange={(value) => setBoolean('showNeedsChecking', value)} />
            <Switch checked={filters.showHardExcluded} label="Show faulty / parts" hint="Hidden for safety" onChange={(value) => setBoolean('showHardExcluded', value)} />
            {facets.riskFlags.length > 0 && <div className="chip-group"><span>Hide listings with</span><div>{facets.riskFlags.map((risk) => <ToggleChip key={risk} label={risk} checked={filters.excludedRisks.has(risk)} onChange={() => toggleFilter('excludedRisks', risk)} />)}</div></div>}
          </FilterSection>

          <FilterSection title="Condition & buying" open={false}>
            <div className="chip-group"><span>Condition</span><div>{facets.conditions.map((value) => <ToggleChip key={value} label={value} checked={filters.allowedConditions.has(value)} onChange={() => toggleFilter('allowedConditions', value)} />)}</div></div>
            <div className="chip-group"><span>Buying option</span><div>{facets.buyingOptions.map((value) => <ToggleChip key={value} label={value.replace('_', ' ')} checked={filters.allowedBuyingOptions.has(value)} onChange={() => toggleFilter('allowedBuyingOptions', value)} />)}</div></div>
            <div className="chip-group"><span>Specification confidence</span><div>{(['high', 'medium', 'low'] as SpecConfidence[]).map((value) => <ToggleChip key={value} label={value} checked={filters.allowedConfidence.has(value)} onChange={() => toggleFilter('allowedConfidence', value)} />)}</div></div>
          </FilterSection>

          <FilterSection title="Brand & platform" open={false}>
            <div className="chip-group"><span>Brand</span><div>{facets.brands.map((value) => <ToggleChip key={value} label={value} checked={filters.allowedBrands.has(value)} onChange={() => toggleFilter('allowedBrands', value)} />)}</div></div>
            <div className="chip-group"><span>CPU</span><div>{facets.cpuManufacturers.map((value) => <ToggleChip key={value} label={value} checked={filters.allowedCpuManufacturers.has(value)} onChange={() => toggleFilter('allowedCpuManufacturers', value)} />)}</div></div>
            <div className="chip-group"><span>GPU</span><div>{facets.gpuFamilies.map((value) => <ToggleChip key={value} label={value} checked={filters.allowedGpuFamilies.has(value)} onChange={() => toggleFilter('allowedGpuFamilies', value)} />)}</div></div>
          </FilterSection>
        </div>
      </Drawer>

      <Drawer open={drawer === 'listings'} side="right" title="Listings" onClose={closeDrawer}>
        <section className="results-section">
          <div className="results-toolbar">
            <div className="result-tabs" role="tablist" aria-label="Result groups">
              {tabs.map(([value, label, count]) => (
                <button key={value} id={`tab-${value}`} role="tab" aria-controls="results-panel" aria-selected={mode === value} tabIndex={mode === value ? 0 : -1} className={mode === value ? 'is-active' : ''} onKeyDown={(event) => handleTabKeyDown(event, value)} onClick={() => setMode(value)}>{label} <span>{count}</span></button>
              ))}
            </div>
            <label className="sort-control">Sort<select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="recommended">Recommended</option><option value="value">Best value</option><option value="power">Most powerful</option><option value="price">Lowest price</option></select></label>
          </div>
          <div className="result-explainer">
            {mode === 'new' && <><Sparkles size={16} />New since the last updates — every machine shown passes the complete replacement floor.</>}
            {mode === 'matches' && <><ShieldCheck size={16} />64 GB machines, ranked by work value on advertised price less surplus RAM and storage credit, then evidence, seller safety, returns and condition.</>}
            {mode === 'ram32' && <><MemoryStick size={16} />32 GB machines that pass every other floor. Never sent to Telegram. Check the RAM is in slots, not soldered, before counting on an upgrade.</>}
            {mode === 'needs-checking' && <><CircleAlert size={16} />These are not recommendations: they fail a floor or still need better hardware evidence.</>}
            {mode === 'shortlist' && <><Heart size={16} />Your saved comparison stays in this browser.</>}
          </div>
          <div id="results-panel" role="tabpanel" aria-labelledby={`tab-${mode}`}>
            {displayed.length === 0 ? (
              <div className="results-empty"><Laptop size={30} /><strong>{mode === 'shortlist' ? 'Your shortlist is empty' : 'No listings in this view'}</strong><span>{mode === 'shortlist' ? 'Use the heart button on any result to save it here.' : 'Reset or loosen the active filters.'}</span></div>
            ) : mode === 'shortlist' ? (
              <ShortlistComparison rows={displayed} onRemove={(id) => setShortlist((current) => toggleSelection(current, id))} />
            ) : (
              <div className="listing-stack">{displayed.slice(0, 100).map((row) => <ListingCard key={row.id} row={row} gate={gate} shortlisted={shortlist.has(row.id)} onShortlist={() => setShortlist((current) => toggleSelection(current, row.id))} />)}</div>
            )}
          </div>
        </section>
      </Drawer>

      <footer><span>Official eBay Browse API · {dataset.marketplaceId}</span><span>Benchmark catalog {dataset.benchmarkVersion}</span><span>Generated {new Date(dataset.generatedAt).toLocaleString('en-GB')}</span></footer>
    </div>
  )
}

export default App
