import { useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import './App.css'
import type { LiveListing, SoldComp } from './data/types'

type Point = {
  listing: LiveListing
  totalCost: number
  marketValue: number
  marketValueSource: 'sold-comps' | 'active-median'
  adjustedReferenceValue: number
  buyPct: number
  adjustedBuyPct: number
  expectedProfit: number
  adjustedExpectedProfit: number
  riskPenaltyPct: number
  cx: number
  cy: number
}

type ChartMode = 'raw' | 'adjusted'

type FamilyAssessment = {
  sourceListingId: string
  decision: 'candidate' | 'review' | 'avoid' | 'exclude'
  valueMultiplier: number
  reasons: string[]
  positiveSignals: string[]
  riskFlags: string[]
  conditionGrade: string
  confidence: 'high' | 'medium' | 'low'
  imageReviewNeeded: boolean
  shortRecommendation: string
}

type AssessmentRun = {
  generatedAt: string | null
  method: string | null
  model: string | null
  count: number
  searchTerm: string | null
}

type SoldCompsRun = {
  generatedAt: string | null
  source: string
  soldCompCount: number
  includedValuationCompCount?: number
  excludedCompCount?: number
  errors: Array<{ searchTerm: string; status: number; error: unknown }>
  comps: SoldComp[]
  note: string
}

const WIDTH = 980
const HEIGHT = 560
const PAD = { left: 86, right: 34, top: 34, bottom: 76 }

function money(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `GBP ${value.toLocaleString('en-GB', { maximumFractionDigits: 0 })}`
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-'
  return `${value.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`
}

function expandDomain(values: number[], allowNegative = false): [number, number] {
  if (values.length === 0) return allowNegative ? [-1, 1] : [0, 1]
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (min === max) return [allowNegative ? min - 1 : 0, max + 1]
  const padding = (max - min) * 0.08
  return [allowNegative ? min - padding : Math.max(0, min - padding), max + padding]
}

function ticks(min: number, max: number, count = 5): number[] {
  const step = (max - min) / (count - 1)
  return Array.from({ length: count }, (_, index) => min + step * index)
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function percentile(values: number[], p: number): number {
  const sorted = values.slice().sort((a, b) => a - b)
  if (sorted.length === 0) return 0
  return sorted[Math.floor((sorted.length - 1) * p)]
}

function listingTotal(listing: LiveListing): number {
  return listing.price + listing.shippingPrice
}

function riskPenaltyPct(listing: LiveListing): number {
  if (listing.excluded) return 55
  const flags = new Set(listing.riskFlags ?? [])
  let penalty = Math.min(flags.size * 8, 32)
  const text = `${listing.title} ${listing.condition}`.toLowerCase()
  if (text.includes('*read*') || text.includes('read')) penalty += 10
  if (text.includes('untested')) penalty += 22
  if (text.includes('mold') || text.includes('fungus') || text.includes('haze')) penalty += 28
  return Math.min(penalty, 60)
}

function expectedProfit(marketValue: number, totalBuyCost: number): number {
  const platformFee = marketValue * 0.128
  const fixedFee = 0.3
  const postageOut = 5
  const packaging = 1
  const cleaningOrPrep = 3
  const riskBuffer = marketValue * 0.08
  return marketValue - totalBuyCost - platformFee - fixedFee - postageOut - packaging - cleaningOrPrep - riskBuffer
}

function App() {
  const [listings, setListings] = useState<LiveListing[]>([])
  const [generatedAt, setGeneratedAt] = useState<string | null>(null)
  const [selectedSearches, setSelectedSearches] = useState<Set<string>>(new Set())
  const [showExcluded, setShowExcluded] = useState(false)
  const [maxPriceInput, setMaxPriceInput] = useState('500')
  const [hovered, setHovered] = useState<Point | null>(null)
  const [assessments, setAssessments] = useState<Map<string, FamilyAssessment>>(new Map())
  const [assessmentRun, setAssessmentRun] = useState<AssessmentRun | null>(null)
  const [soldCompsRun, setSoldCompsRun] = useState<SoldCompsRun | null>(null)

  useEffect(() => {
    fetch('/data/listings.json')
      .then((response) => response.json())
      .then((data) => {
        const rows = (data.listings ?? []) as LiveListing[]
        setListings(rows)
        setGeneratedAt(data.generatedAt ?? null)
        const availableSearches = Array.from(new Set(rows.map((row) => row.searchTerm))).sort()
        setSelectedSearches(
          new Set(availableSearches.includes('Canon EF 50mm f/1.8 STM') ? ['Canon EF 50mm f/1.8 STM'] : availableSearches.slice(0, 1)),
        )
      })
      .catch(() => setListings([]))
  }, [])

  useEffect(() => {
    fetch('/data/family-assessments.json')
      .then((response) => response.json())
      .then((data) => {
        setAssessments(new Map((data.assessments ?? []).map((item: FamilyAssessment) => [item.sourceListingId, item])))
        setAssessmentRun({
          generatedAt: data.generatedAt ?? null,
          method: data.method ?? null,
          model: data.model ?? null,
          count: data.count ?? (data.assessments ?? []).length,
          searchTerm: data.searchTerm ?? null,
        })
      })
      .catch(() => {
        setAssessments(new Map())
        setAssessmentRun(null)
      })
  }, [])

  useEffect(() => {
    fetch('/data/sold-comps.json')
      .then((response) => response.json())
      .then((data) => setSoldCompsRun(data as SoldCompsRun))
      .catch(() => setSoldCompsRun(null))
  }, [])

  const searches = useMemo(() => Array.from(new Set(listings.map((row) => row.searchTerm))).sort(), [listings])
  const maxPrice = Number(maxPriceInput.replaceAll(',', ''))
  const effectiveMaxPrice = Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : Infinity

  const medianBySearch = useMemo(() => {
    const groups = new Map<string, number[]>()
    for (const listing of listings) {
      if (listing.excluded) continue
      const total = listingTotal(listing)
      if (total <= 0) continue
      groups.set(listing.searchTerm, [...(groups.get(listing.searchTerm) ?? []), total])
    }
    return new Map(Array.from(groups.entries()).map(([search, values]) => [search, median(values)]))
  }, [listings])

  const soldStatsBySearch = useMemo(() => {
    const groups = new Map<string, number[]>()
    for (const comp of soldCompsRun?.comps ?? []) {
      if (comp.includeInValuation === false) continue
      if (!comp.searchTerm || comp.price <= 0) continue
      groups.set(comp.searchTerm, [...(groups.get(comp.searchTerm) ?? []), comp.price])
    }
    return new Map(
      Array.from(groups.entries()).map(([search, values]) => [
        search,
        {
          count: values.length,
          low: percentile(values, 0.25),
          median: median(values),
          high: percentile(values, 0.75),
        },
      ]),
    )
  }, [soldCompsRun])

  const filtered = useMemo(
    () =>
      listings.filter((listing) => {
        if (!selectedSearches.has(listing.searchTerm)) return false
        if (!showExcluded && listing.excluded) return false
        const total = listingTotal(listing)
        if (total <= 0 || total > effectiveMaxPrice) return false
        return true
      }),
    [effectiveMaxPrice, listings, selectedSearches, showExcluded],
  )

  const rawRows = useMemo(() => {
    return filtered.map((listing) => {
      const totalCost = listingTotal(listing)
      const soldStats = soldStatsBySearch.get(listing.searchTerm)
      const marketValue = soldStats?.median ?? medianBySearch.get(listing.searchTerm) ?? totalCost
      const assessment = assessments.get(listing.sourceListingId)
      const penalty = assessment ? Math.max(0, (1 - assessment.valueMultiplier) * 100) : riskPenaltyPct(listing)
      const adjustedReferenceValue = marketValue * (assessment?.valueMultiplier ?? (1 - penalty / 100))
      return {
        listing,
        totalCost,
        marketValue,
        marketValueSource: soldStats ? 'sold-comps' as const : 'active-median' as const,
        adjustedReferenceValue,
        riskPenaltyPct: penalty,
        buyPct: marketValue > 0 ? (totalCost / marketValue) * 100 : 0,
        adjustedBuyPct: adjustedReferenceValue > 0 ? (totalCost / adjustedReferenceValue) * 100 : 999,
        expectedProfit: expectedProfit(marketValue, totalCost),
        adjustedExpectedProfit: expectedProfit(adjustedReferenceValue, totalCost),
      }
    })
  }, [assessments, filtered, medianBySearch, soldStatsBySearch])

  const buildChart = useCallback((mode: ChartMode) => {
    const xValues = rawRows.map((row) => (mode === 'raw' ? row.buyPct : row.adjustedBuyPct))
    const yValues = rawRows.map((row) => (mode === 'raw' ? row.expectedProfit : row.adjustedExpectedProfit))
    const xDomain = expandDomain(xValues)
    const yDomain = expandDomain(yValues, true)
    const plotW = WIDTH - PAD.left - PAD.right
    const plotH = HEIGHT - PAD.top - PAD.bottom
    const points: Point[] = rawRows.map((row) => {
      const xValue = mode === 'raw' ? row.buyPct : row.adjustedBuyPct
      const yValue = mode === 'raw' ? row.expectedProfit : row.adjustedExpectedProfit
      return {
        ...row,
        cx: PAD.left + ((xValue - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotW,
        cy: PAD.top + (1 - (yValue - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotH,
      }
    })
    const ranked = points
      .slice()
      .sort((a, b) => {
        const ay = mode === 'raw' ? a.expectedProfit : a.adjustedExpectedProfit
        const by = mode === 'raw' ? b.expectedProfit : b.adjustedExpectedProfit
        return by - ay || a.totalCost - b.totalCost
      })
    return {
      points,
      ranked,
      xDomain,
      yDomain,
      xTicks: ticks(xDomain[0], xDomain[1]),
      yTicks: ticks(yDomain[0], yDomain[1]),
      best:
        ranked.find((point) => !point.listing.excluded && (mode === 'raw' ? point.expectedProfit : point.adjustedExpectedProfit) > 0) ??
        ranked[0] ??
        null,
    }
  }, [rawRows])

  const chart = useMemo(() => {
    return buildChart('raw')
  }, [buildChart])

  const adjustedChart = useMemo(() => {
    return buildChart('adjusted')
  }, [buildChart])

  function renderScatter(chartData: ReturnType<typeof buildChart>, mode: ChartMode) {
    const isAdjusted = mode === 'adjusted'
    const title = isAdjusted ? 'Expert-adjusted profit map' : 'Sold-comps profit map'
    const subtitle = isAdjusted
      ? 'Resale value is reduced by the mini expert assessment before profit is calculated.'
      : 'Uses imported eBay Product Research sold comps where available; otherwise falls back to active median.'
    return (
      <section className="chart-card">
        <div className="chart-title">
          <div>
            <h2>{title}</h2>
            <p>{subtitle}</p>
          </div>
          <span>{chartData.points.length} dots</span>
        </div>
        <div className="chart-shell">
          {chartData.points.length === 0 && (
            <div className="empty">
              <h2>No listings for these filters</h2>
              <p>Select at least one search family or raise the max price.</p>
            </div>
          )}
          <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={title}>
            <rect width={WIDTH} height={HEIGHT} fill="#0b0d10" />
            <rect
              x={PAD.left}
              y={PAD.top}
              width={(WIDTH - PAD.left - PAD.right) * 0.45}
              height={(HEIGHT - PAD.top - PAD.bottom) * 0.5}
              fill="#22d3ee"
              fillOpacity="0.08"
              stroke="#22d3ee"
              strokeOpacity="0.45"
              strokeDasharray="6 6"
            />

            {chartData.yTicks.map((tick) => {
              const y = PAD.top + (1 - (tick - chartData.yDomain[0]) / (chartData.yDomain[1] - chartData.yDomain[0])) * (HEIGHT - PAD.top - PAD.bottom)
              return (
                <g key={`y-${mode}-${tick}`}>
                  <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} stroke={Math.abs(tick) < 0.01 ? '#64748b' : '#242832'} />
                  <text x={PAD.left - 12} y={y + 4} textAnchor="end" fill="#8b93a1" fontSize="12">{pct(tick)}</text>
                </g>
              )
            })}

            {chartData.xTicks.map((tick) => {
              const x = PAD.left + ((tick - chartData.xDomain[0]) / (chartData.xDomain[1] - chartData.xDomain[0])) * (WIDTH - PAD.left - PAD.right)
              return (
                <g key={`x-${mode}-${tick}`}>
                  <line x1={x} x2={x} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="#191d25" />
                  <text x={x} y={HEIGHT - PAD.bottom + 26} textAnchor="middle" fill="#8b93a1" fontSize="12">{pct(tick)}</text>
                </g>
              )
            })}

            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={HEIGHT - PAD.bottom} y2={HEIGHT - PAD.bottom} stroke="#4b5563" />
            <line x1={PAD.left} x2={PAD.left} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="#4b5563" />
            <text x={WIDTH / 2} y={HEIGHT - 18} textAnchor="middle" fill="#cbd5e1" fontSize="14">Total buy cost as percent of resale value</text>
            <text x="18" y={HEIGHT / 2} transform={`rotate(-90 18 ${HEIGHT / 2})`} textAnchor="middle" fill="#cbd5e1" fontSize="14">
              {isAdjusted ? 'Expected profit after expert adjustment' : 'Expected profit after fees and risk buffer'}
            </text>

            {chartData.points.map((point) => {
              const yValue = isAdjusted ? point.adjustedExpectedProfit : point.expectedProfit
              const xValue = isAdjusted ? point.adjustedBuyPct : point.buyPct
              return (
                <a key={`${mode}-${point.listing.sourceListingId}`} href={point.listing.listingUrl} target="_blank" rel="noreferrer">
                  <circle
                    cx={point.cx}
                    cy={point.cy}
                    r={point.listing.excluded ? 4 : point.riskPenaltyPct >= 30 ? 5 : 6}
                    fill={point.listing.excluded ? '#64748b' : yValue >= 20 && xValue <= 75 ? '#22d3ee' : yValue > 0 ? '#f59e0b' : '#ef4444'}
                    fillOpacity={point.listing.excluded ? 0.45 : 0.82}
                    stroke="#111827"
                    strokeWidth="1"
                    onMouseMove={(event) => onPointMove(event, point)}
                    onMouseLeave={() => setHovered(null)}
                  >
                    <title>{`${point.listing.title} - ${money(point.totalCost)} - ${pct(xValue)} of value - ${money(yValue)} profit`}</title>
                  </circle>
                </a>
              )
            })}
          </svg>

          <div className="legend">
            <span><i className="cyan" /> big discount</span>
            <span><i className="amber" /> below reference</span>
            <span><i className="red" /> above reference</span>
            <span><i className="grey" /> excluded</span>
          </div>

          {hovered && (
            <div className="tooltip">
              <strong>{hovered.listing.title}</strong>
              <span>{hovered.listing.searchTerm}</span>
              <em>
                {money(hovered.totalCost)} - {money(isAdjusted ? hovered.adjustedExpectedProfit : hovered.expectedProfit)} profit
              </em>
              <small>
                Market {money(hovered.marketValue)} ({hovered.marketValueSource}) - adjusted{' '}
                {money(hovered.adjustedReferenceValue)} - buy ratio {pct(isAdjusted ? hovered.adjustedBuyPct : hovered.buyPct)}
              </small>
              {assessments.get(hovered.listing.sourceListingId) && (
                <small>
                  Assessment: {assessments.get(hovered.listing.sourceListingId)?.decision} · {assessments.get(hovered.listing.sourceListingId)?.conditionGrade}
                </small>
              )}
              {hovered.listing.excluded && <b>Excluded: {hovered.listing.excludedReason}</b>}
            </div>
          )}
        </div>
      </section>
    )
  }

  function toggleSearch(search: string) {
    setSelectedSearches((current) => {
      const next = new Set(current)
      if (next.has(search)) next.delete(search)
      else next.add(search)
      return next
    })
  }

  function onPointMove(event: MouseEvent<SVGCircleElement>, point: Point) {
    setHovered(point)
    event.currentTarget.parentElement?.appendChild(event.currentTarget)
  }

  return (
    <main className="page">
      <header className="header">
        <div>
          <p>eBay lens scanner</p>
          <h1>Active listing value map</h1>
        </div>
        <div className="snapshot">
          Pull <span>{generatedAt ? new Date(generatedAt).toLocaleString('en-GB') : 'not run'}</span>
        </div>
      </header>

      <section className="controls">
        <div className="control-block">
          <div className="label">Search families</div>
          <div className="button-row">
            {searches.map((search) => (
              <button
                key={search}
                type="button"
                onClick={() => toggleSearch(search)}
                className={selectedSearches.has(search) ? 'selected' : ''}
              >
                {search}
              </button>
            ))}
          </div>
        </div>

        <div className="filter-grid">
          <label>
            <span>Max total buy cost</span>
            <input value={maxPriceInput} onChange={(event) => setMaxPriceInput(event.target.value)} inputMode="numeric" />
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={showExcluded} onChange={(event) => setShowExcluded(event.target.checked)} />
            <span>Show excluded/accessory listings</span>
          </label>
        </div>
      </section>

      {chart.best && (
        <a className="best" href={chart.best.listing.listingUrl} target="_blank" rel="noreferrer">
          <div>
            <p>Highest expected profit in current view</p>
            <h2>{chart.best.listing.title}</h2>
          </div>
          <div>
            <strong>{money(chart.best.totalCost)}</strong>
            <span>{money(chart.best.expectedProfit)} expected profit</span>
          </div>
        </a>
      )}

      {assessmentRun && (
        <section className="assessment-strip">
          <div>
            <span>Expert review</span>
            <strong>{assessmentRun.model ?? 'unknown model'}</strong>
          </div>
          <div>
            <span>Lens family</span>
            <strong>{assessmentRun.searchTerm ?? 'not set'}</strong>
          </div>
          <div>
            <span>Listings reviewed</span>
            <strong>{assessmentRun.count}</strong>
          </div>
          <div>
            <span>Generated</span>
            <strong>{assessmentRun.generatedAt ? new Date(assessmentRun.generatedAt).toLocaleString('en-GB') : '-'}</strong>
          </div>
        </section>
      )}

      {soldCompsRun && (
        <section className={`sold-strip ${soldCompsRun.soldCompCount === 0 ? 'blocked' : ''}`}>
          <div>
            <span>Sold comps</span>
            <strong>{soldCompsRun.includedValuationCompCount ?? soldCompsRun.soldCompCount}/{soldCompsRun.soldCompCount}</strong>
          </div>
          <div>
            <span>Excluded rows</span>
            <strong>{soldCompsRun.excludedCompCount ?? 0}</strong>
          </div>
          <div>
            <span>Source</span>
            <strong>{soldCompsRun.source}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{soldCompsRun.errors?.length ? `Blocked (${soldCompsRun.errors[0]?.status})` : 'Ready'}</strong>
          </div>
          <p>
            {soldCompsRun.errors?.length
              ? 'Official eBay sold-comps access was denied for this app. Import/export path is needed before true profit ranking.'
              : 'Sold comps are available for valuation.'}
          </p>
        </section>
      )}

      {renderScatter(chart, 'raw')}
      {renderScatter(adjustedChart, 'adjusted')}

      <section className="rankings">
        <div className="rank-header">
          <div>
            <h2>Listings behind the dots</h2>
            <p>Ranked by expected profit after fees, postage, prep and risk buffer.</p>
          </div>
          <span>{chart.ranked.length} shown</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Rank</th>
                <th>Listing</th>
                <th>Total</th>
                <th>Value</th>
                <th>Profit</th>
                <th>Seller</th>
                <th>Risk</th>
                <th>Assessment</th>
                <th>Expert view</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              {chart.ranked.slice(0, 80).map((point, index) => {
                const assessment = assessments.get(point.listing.sourceListingId)
                return (
                <tr key={point.listing.sourceListingId}>
                  <td className="mono">#{index + 1}</td>
                  <td>
                    <strong>{point.listing.title}</strong>
                    <span>{point.listing.searchTerm}</span>
                  </td>
                  <td className="mono price">{money(point.totalCost)}</td>
                  <td className="mono">{money(point.marketValue)}</td>
                  <td className={`mono ${point.adjustedExpectedProfit >= 0 ? 'good' : 'bad'}`}>{money(point.adjustedExpectedProfit)}</td>
                  <td>
                    <strong>{point.listing.sellerName || '-'}</strong>
                    <span>{point.listing.sellerFeedbackPercent ? `${point.listing.sellerFeedbackPercent}%` : ''}</span>
                  </td>
                  <td>{point.listing.excluded ? point.listing.excludedReason : point.listing.riskFlags.join(', ') || '-'}</td>
                  <td>
                    <strong>{assessment?.decision ?? '-'}</strong>
                    <span>{assessment ? `${assessment.conditionGrade} · ${assessment.confidence}` : ''}</span>
                  </td>
                  <td className="expert-cell">
                    <strong>{assessment?.shortRecommendation ?? '-'}</strong>
                    <span>{assessment?.reasons?.[0] ?? assessment?.positiveSignals?.[0] ?? ''}</span>
                  </td>
                  <td><a href={point.listing.listingUrl} target="_blank" rel="noreferrer">open</a></td>
                </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

export default App
