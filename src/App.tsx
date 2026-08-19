import { useEffect, useId, useMemo, useState } from 'react'
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
  MemoryStick,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TriangleAlert,
  Zap,
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
  parseShortlist,
  partitionResults,
  rankListings,
  serializeShortlist,
  SHORTLIST_STORAGE_KEY,
  toggleSelection,
} from './laptop/dashboard'
import { createDefaultFilters } from './laptop/engine'
import { assessBestBuy, effectivePrice } from './laptop/best-buy'
import type { ChartListing } from './laptop/dashboard'
import type { LaptopDataset, LaptopFilters, LaptopListing, SpecConfidence } from './laptop/types'

const MONEY = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 })
const NUMBER = new Intl.NumberFormat('en-GB')

type SetFilterKey = 'allowedConditions' | 'allowedBrands' | 'allowedCpuManufacturers' | 'allowedGpuFamilies' | 'allowedBuyingOptions' | 'allowedConfidence' | 'excludedRisks'
type ResultMode = 'new' | 'matches' | 'needs-checking' | 'shortlist'
type SortMode = 'recommended' | 'value' | 'power' | 'price'
const RESULT_MODES: ResultMode[] = ['new', 'matches', 'needs-checking', 'shortlist']

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

function PowerChart({
  rows,
  selectedId,
  onSelect,
}: {
  rows: LaptopListing[]
  selectedId: string | null
  onSelect: (row: LaptopListing) => void
}) {
  const clipId = useId().replace(/:/g, '')
  const model = useMemo(() => buildChartModel(rows), [rows])
  const width = 960
  const height = 500
  const pad = { top: 34, right: 34, bottom: 56, left: 64 }
  const innerWidth = width - pad.left - pad.right
  const innerHeight = height - pad.top - pad.bottom
  const x = (price: number) => pad.left + (price / 3000) * innerWidth
  const y = (power: number) => pad.top + (1 - (power - model.yDomain[0]) / (model.yDomain[1] - model.yDomain[0])) * innerHeight
  const xTicks = [0, 500, 1000, 1500, 2000, 2500, 3000]
  const yStep = Math.max(10, Math.ceil((model.yDomain[1] - model.yDomain[0]) / 6 / 10) * 10)
  const yTicks: number[] = []
  for (let value = Math.ceil(model.yDomain[0] / yStep) * yStep; value <= model.yDomain[1]; value += yStep) yTicks.push(value)
  const frontierPath = model.frontier.map((point, index) => `${index ? 'L' : 'M'} ${x(point.plottedPrice)} ${y(point.plottedPower)}`).join(' ')
  const equalValuePowerAtMax = (3000 / BASELINE_PRICE) * 100
  const equalValuePath = `M ${x(0)} ${y(0)} L ${x(3000)} ${y(equalValuePowerAtMax)}`
  const valueLabelPower = Math.min(model.yDomain[1] - 5, Math.max(model.yDomain[0] + 8, (2020 / BASELINE_PRICE) * 100 + 18))
  const selected = model.points.find((point) => point.id === selectedId) ?? null

  function activate(point: ChartListing) {
    onSelect(point)
  }

  return (
    <div className="chart-wrap">
      {model.points.length === 0 ? (
        <div className="chart-empty">
          <Filter size={28} aria-hidden="true" />
          <strong>No scored laptops match these filters</strong>
          <span>Lower a power or hardware threshold, or reset the controls.</span>
        </div>
      ) : (
        <svg className="power-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${clipId}-title ${clipId}-desc`}>
          <title id={`${clipId}-title`}>Advertised price versus backtesting work performance</title>
          <desc id={`${clipId}-desc`}>{model.points.length} qualifying eBay listings compared with the current ASUS G16 at work performance 100 and £1,170.</desc>
          <defs>
            <clipPath id={clipId}><rect x={pad.left} y={pad.top} width={innerWidth} height={innerHeight} /></clipPath>
          </defs>
          <g className="chart-grid" aria-hidden="true">
            {xTicks.map((tick) => <line key={`x-${tick}`} x1={x(tick)} x2={x(tick)} y1={pad.top} y2={height - pad.bottom} />)}
            {yTicks.map((tick) => <line key={`y-${tick}`} x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} />)}
          </g>
          <g className="chart-axes" aria-hidden="true">
            {xTicks.map((tick) => <text key={tick} x={x(tick)} y={height - 26} textAnchor="middle">{tick === 0 ? '£0' : `£${tick / 1000}k`}</text>)}
            {yTicks.map((tick) => <text key={tick} x={pad.left - 14} y={y(tick) + 4} textAnchor="end">{tick}</text>)}
            <text x={pad.left + innerWidth / 2} y={height - 4} textAnchor="middle" className="axis-title">ADVERTISED PRICE</text>
            <text transform={`translate(17 ${pad.top + innerHeight / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">BACKTESTING WORK PERFORMANCE</text>
          </g>
          <g clipPath={`url(#${clipId})`}>
            <line className="baseline-line" x1={pad.left} x2={width - pad.right} y1={y(100)} y2={y(100)} />
            <line className="baseline-price" x1={x(BASELINE_PRICE)} x2={x(BASELINE_PRICE)} y1={pad.top} y2={height - pad.bottom} />
            <path className="equal-value-line" d={equalValuePath} />
            <text className="value-region-label" x={x(2020)} y={y(valueLabelPower)}>BETTER VALUE THAN YOUR G16 ↑</text>
            {frontierPath && <path className="pareto-line" d={frontierPath} />}
            {model.points.map((point) => {
              const isSelected = point.id === selectedId
              const isFrontier = model.frontierIds.has(point.id)
              const value = assessValue(point.plottedPower, point.valuePrice)
              const radius = 5 + Math.max(0, Math.min(4, point.recommendationScore / 25))
              return (
                <circle
                  key={point.id}
                  className={`listing-point value-${value.band}${isFrontier ? ' is-frontier' : ''}${isSelected ? ' is-selected' : ''}`}
                  cx={x(point.plottedPrice)}
                  cy={y(point.plottedPower)}
                  r={radius}
                  tabIndex={0}
                  role="button"
                  aria-label={`${point.title}, ${MONEY.format(point.plottedPrice)} advertised, work performance ${point.plottedPower}, ${value.label}`}
                  onClick={() => activate(point)}
                  onFocus={() => activate(point)}
                  onMouseEnter={() => activate(point)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      activate(point)
                    }
                  }}
                ><title>{`${point.title}\n${MONEY.format(point.plottedPrice)} advertised · work performance ${point.plottedPower}\n${value.label}`}</title></circle>
              )
            })}
          </g>
          <g className="baseline-label" aria-hidden="true">
            <rect x={x(BASELINE_PRICE) + 8} y={y(100) - 30} width="173" height="24" rx="2" />
            <text x={x(BASELINE_PRICE) + 17} y={y(100) - 14}>YOUR G16 · £1,170 · 100</text>
          </g>
        </svg>
      )}
      <div className="chart-counts" aria-label="Plotted qualifying listings">
        <strong>{model.points.length} plotted</strong>
        <span>advertised item prices</span>
        <span>all pass the replacement floor</span>
      </div>
      <div className="chart-legend" aria-hidden="true">
        <span><i className="legend-dot strong" />Strong value</span>
        <span><i className="legend-dot competitive" />Competitive</span>
        <span><i className="legend-dot weak" />Weak value</span>
        <span><i className="legend-dot frontier" />Best-buy frontier</span>
        <span><i className="legend-line" />Your G16 work performance</span>
      </div>
      <div className="chart-selection" aria-live="polite">
        {selected ? (
          <>
            <div><strong>{selected.title}</strong><span>{selected.cpuModel} · {selected.gpuModel}</span><small>Multi-core {signedPercent(selected.cpuMultiPower)} · single-thread {signedPercent(selected.cpuSinglePower)}</small><small>{buildRecommendationReason(selected)}</small></div>
            <div className="selection-numbers"><strong>{MONEY.format(selected.plottedPrice)} advertised</strong><span>work performance {signedPercent(selected.plottedPower)} · {assessValue(selected.plottedPower, selected.valuePrice).label}</span>{selected.surplusCredit > 0 && <small>value uses {MONEY.format(selected.valuePrice)} after {MONEY.format(selected.surplusCredit)} surplus RAM and storage credit</small>}</div>
            <a href={selected.listingUrl} target="_blank" rel="noreferrer">View on eBay <ArrowUpRight size={14} /></a>
          </>
        ) : <span>Focus or hover a point to inspect it.</span>}
      </div>
    </div>
  )
}

function ListingCard({ row, shortlisted, onShortlist }: { row: LaptopListing; shortlisted: boolean; onShortlist: () => void }) {
  const risk = row.riskFlags.length > 0 || row.hardExcluded
  const readiness = classifyReadiness(row)
  const assessment = assessBestBuy(row)
  const value = assessment.workPerformance == null ? null : assessValue(assessment.workPerformance, assessment.effectivePrice)
  const readinessLabel = {
    ready: 'Passes every floor',
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
        <p className="recommendation-line"><Sparkles size={14} />{buildRecommendationReason(row)}</p>
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
  const [mode, setMode] = useState<ResultMode>('new')
  const [sortMode, setSortMode] = useState<SortMode>('recommended')
  const [shortlist, setShortlist] = useState<Set<string>>(() => parseShortlist(localStorage.getItem(SHORTLIST_STORAGE_KEY)))

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

  const facets = useMemo(() => deriveFacets(dataset?.listings ?? []), [dataset])
  const groups = useMemo(() => partitionResults(dataset?.listings ?? [], filters, query), [dataset, filters, query])
  const filtered = groups.matches
  const newMatches = groups.newMatches
  const scoredMatches = groups.scored
  const needsChecking = groups.needsChecking
  const shortlistRows = useMemo(() => (dataset?.listings ?? []).filter((row) => shortlist.has(row.id)), [dataset, shortlist])
  const displayed = useMemo(() => {
    const rows = mode === 'new' ? newMatches : mode === 'matches' ? filtered : mode === 'needs-checking' ? needsChecking : shortlistRows
    if (sortMode === 'price') return rows.slice().sort((a, b) => chartPrice(a).price - chartPrice(b).price)
    if (sortMode === 'power') return rows.slice().sort((a, b) => (b.workPerformance ?? -1) - (a.workPerformance ?? -1))
    if (sortMode === 'value') return rows.slice().sort((a, b) => {
      const aValue = a.workPerformance == null ? -1 : assessValue(a.workPerformance, effectivePrice(a)).ratio
      const bValue = b.workPerformance == null ? -1 : assessValue(b.workPerformance, effectivePrice(b)).ratio
      return bValue - aValue
    })
    if (mode === 'shortlist') return rows
    return rankListings(rows)
  }, [filtered, mode, needsChecking, newMatches, shortlistRows, sortMode])
  const chart = useMemo(() => buildChartModel(scoredMatches), [scoredMatches])

  const effectiveSelectedId = selectedId && scoredMatches.some((row) => row.id === selectedId)
    ? selectedId
    : chart.points[0]?.id ?? null

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

  return (
    <div className="app-shell">
      <header className="masthead">
        <div className="brand-lockup">
          <div className="brand-mark"><Gauge size={25} /></div>
          <div><span className="eyebrow">EBAY UK · LIVE REPLACEMENT SEARCH</span><h1>Laptop Power Finder</h1></div>
        </div>
        <div className="header-tools">
          <div className="data-status"><span className="live-pulse" /><div><strong>{dataset.listingCount} listings scanned</strong><span>Captured {ageLabel(dataset.generatedAt)} · {dataset.scoredCount} power-scored</span></div></div>
          <button className="reset-button" type="button" onClick={reset}><RotateCcw size={15} />Reset</button>
        </div>
      </header>

      <div className="dashboard-layout">
        <aside className="filter-rail" aria-label="Laptop filters">
          <div className="filter-heading"><SlidersHorizontal size={17} /><strong>Decision controls</strong><span>{filtered.length} shown</span></div>
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
            <RangeControl label="Minimum RAM" value={filters.minRamGb} min={0} max={128} step={16} display={filters.minRamGb ? `${filters.minRamGb} GB${filters.minRamGb === 64 ? ' · your G16' : ''}` : 'Any'} onChange={(value) => setNumber('minRamGb', value)} />
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
        </aside>

        <main className="dashboard-main">
          <section className="decision-strip" aria-label="Current filter summary">
            <div><span>QUALIFYING</span><strong>{chart.points.length}</strong><small>64 GB · 1 TB · no CPU downgrade</small></div>
            <div><span>NEW IN 24H</span><strong>{newMatches.length}</strong><small>qualified additions since the last updates</small></div>
            <div><span>BEST-BUY PICKS</span><strong>{chart.frontierIds.size}</strong><small>no cheaper equal-work rival</small></div>
            <p><Sparkles size={16} /> Your i9-14900HX G16 is <strong>100</strong> for multi-core, single-thread and work performance. The RTX 4060 is a pass/fail floor; faster graphics do not change rank.</p>
          </section>

          <section className="graph-section">
            <div className="section-heading"><div><span>ADVERTISED PRICE / WORK FIELD</span><h2>Where your money buys faster local backtesting</h2></div><div className="weight-readout"><Cpu size={16} />70% multi-core <span>/</span> 30% single-thread</div></div>
            <PowerChart rows={scoredMatches} selectedId={effectiveSelectedId} onSelect={(row) => setSelectedId(row.id)} />
          </section>

          <section className="results-section">
            <div className="results-toolbar">
              <div className="result-tabs" role="tablist" aria-label="Result groups">
                <button id="tab-new" role="tab" aria-controls="results-panel" aria-selected={mode === 'new'} tabIndex={mode === 'new' ? 0 : -1} className={mode === 'new' ? 'is-active' : ''} onKeyDown={(event) => handleTabKeyDown(event, 'new')} onClick={() => setMode('new')}>New <span>{newMatches.length}</span></button>
                <button id="tab-matches" role="tab" aria-controls="results-panel" aria-selected={mode === 'matches'} tabIndex={mode === 'matches' ? 0 : -1} className={mode === 'matches' ? 'is-active' : ''} onKeyDown={(event) => handleTabKeyDown(event, 'matches')} onClick={() => setMode('matches')}>Matches <span>{filtered.length}</span></button>
                <button id="tab-needs-checking" role="tab" aria-controls="results-panel" aria-selected={mode === 'needs-checking'} tabIndex={mode === 'needs-checking' ? 0 : -1} className={mode === 'needs-checking' ? 'is-active' : ''} onKeyDown={(event) => handleTabKeyDown(event, 'needs-checking')} onClick={() => setMode('needs-checking')}>Needs info <span>{needsChecking.length}</span></button>
                <button id="tab-shortlist" role="tab" aria-controls="results-panel" aria-selected={mode === 'shortlist'} tabIndex={mode === 'shortlist' ? 0 : -1} className={mode === 'shortlist' ? 'is-active' : ''} onKeyDown={(event) => handleTabKeyDown(event, 'shortlist')} onClick={() => setMode('shortlist')}>Shortlist <span>{shortlistRows.length}</span></button>
              </div>
              <label className="sort-control">Sort<select value={sortMode} onChange={(event) => setSortMode(event.target.value as SortMode)}><option value="recommended">Recommended</option><option value="value">Best value</option><option value="power">Most powerful</option><option value="price">Lowest price</option></select></label>
            </div>
            <div className="result-explainer">
              {mode === 'new' && <><Sparkles size={16} />New since the last updates — every machine shown passes the complete replacement floor.</>}
              {mode === 'matches' && <><ShieldCheck size={16} />Ranked by work value on advertised price less surplus RAM and storage credit, then evidence, seller safety, returns and condition.</>}
              {mode === 'needs-checking' && <><CircleAlert size={16} />These are not recommendations: they fail a floor or still need better hardware evidence.</>}
              {mode === 'shortlist' && <><Heart size={16} />Your saved comparison stays in this browser.</>}
            </div>
            <div id="results-panel" role="tabpanel" aria-labelledby={`tab-${mode}`}>
              {displayed.length === 0 ? (
                <div className="results-empty"><Laptop size={30} /><strong>{mode === 'shortlist' ? 'Your shortlist is empty' : 'No listings in this view'}</strong><span>{mode === 'shortlist' ? 'Use the heart button on any result to save it here.' : 'Reset or loosen the active filters.'}</span></div>
              ) : mode === 'shortlist' ? (
                <ShortlistComparison rows={displayed} onRemove={(id) => setShortlist((current) => toggleSelection(current, id))} />
              ) : (
                <div className="listing-stack">{displayed.slice(0, 100).map((row) => <ListingCard key={row.id} row={row} shortlisted={shortlist.has(row.id)} onShortlist={() => setShortlist((current) => toggleSelection(current, row.id))} />)}</div>
              )}
            </div>
          </section>
        </main>
      </div>

      <footer><span>Official eBay Browse API · {dataset.marketplaceId}</span><span>Benchmark catalog {dataset.benchmarkVersion}</span><span>Generated {new Date(dataset.generatedAt).toLocaleString('en-GB')}</span></footer>
    </div>
  )
}

export default App
