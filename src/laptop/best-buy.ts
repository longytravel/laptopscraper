import type { LaptopListing } from './types'

export const G16_REFERENCE = {
  advertisedPrice: 1170,
  cpuMultiScore: 43856,
  cpuSingleScore: 4177,
  gpuScore: 17359,
  ramGb: 64,
  storageGb: 1024,
} as const

/**
 * Street cost of the surplus hardware a listing carries above the G16 floor.
 * RAM and storage above the floor do not make a backtest faster, so they never
 * touch work performance; they save you buying the parts separately, so they
 * come off the price the value ratio is measured against.
 */
export const SURPLUS_CREDIT = {
  // DDR5 SO-DIMM, 28 September 2026: the cheapest 64 GB of DDR5-5600 on Amazon
  // UK was two 32 GB modules at £210 each (£6.56/GB). It was £2.50 in July.
  ramGbpPerGb: 6.5,
  storageGbpPerGb: 0.06,
} as const

/**
 * Indices at or above these count as matching the G16. Multi-core carries no
 * tolerance because it is what backtesting throughput actually rides on.
 * Single-thread and graphics are safety floors, and PassMark's own spread
 * between samples of one chip is wider than 5%, so a 4% shortfall on either is
 * noise, not a downgrade. This admits the Ryzen 9 7945HX class (single-thread
 * 96) and the RTX 5060 (graphics 96) without touching the multi-core rule.
 */
export const GATE_TOLERANCE = {
  singleThread: 95,
  graphics: 95,
} as const

/**
 * RAM floors the dashboard can plot. 64 GB is the replacement floor and the
 * only one Telegram ever recommends; 32 GB shows what a machine costs if you
 * accept, or upgrade from, 32 GB.
 */
export const RAM_TIERS = [64, 32] as const
export type RamTier = typeof RAM_TIERS[number]

export interface GateOptions {
  minRamGb?: RamTier
}

/**
 * Taking a 32 GB laptop to 64 GB means replacing both sticks, not adding to
 * them, so the estimate is a whole 64 GB kit at street price.
 */
export const RAM_UPGRADE_GBP = G16_REFERENCE.ramGb * SURPLUS_CREDIT.ramGbpPerGb

/**
 * Platforms that only ship with soldered or on-package memory, so the upgrade
 * route is closed: Strix Halo (Ryzen AI Max) and Lunar Lake (Core Ultra 200V).
 * Other laptops can still solder RAM, which is why the dashboard says to check.
 */
export function ramIsSoldered(listing: Pick<LaptopListing, 'cpuModel'>): boolean {
  return /Ryzen AI Max|Core Ultra [579] 2\d{2}V\b/i.test(listing.cpuModel ?? '')
}

/** What it costs to bring this machine up to the 64 GB floor; null when it cannot be done. */
export function ramUpgradeCost(listing: Pick<LaptopListing, 'cpuModel' | 'ramGb'>): number | null {
  if ((listing.ramGb ?? 0) >= G16_REFERENCE.ramGb) return 0
  return ramIsSoldered(listing) ? null : RAM_UPGRADE_GBP
}

export interface BestBuyAssessment {
  eligible: boolean
  failures: string[]
  workPerformance: number | null
  workValue: number | null
  surplusCredit: number
  effectivePrice: number
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function workPerformance(multiPower: number | null, singlePower: number | null): number | null {
  if (multiPower == null || singlePower == null) return null
  return round(100 * (multiPower / 100) ** 0.70 * (singlePower / 100) ** 0.30)
}

export function surplusCredit(ramGb: number | null | undefined, storageGb: number | null | undefined): number {
  const ram = Math.max(0, (ramGb ?? 0) - G16_REFERENCE.ramGb) * SURPLUS_CREDIT.ramGbpPerGb
  const storage = Math.max(0, (storageGb ?? 0) - G16_REFERENCE.storageGb) * SURPLUS_CREDIT.storageGbpPerGb
  return round(ram + storage, 2)
}

/** Advertised price less the market cost of surplus RAM and storage. Never below £1. */
export function effectivePrice(listing: Pick<LaptopListing, 'price' | 'ramGb' | 'storageGb'>): number {
  return round(Math.max(1, listing.price - surplusCredit(listing.ramGb, listing.storageGb)), 2)
}

export function workValueRatio(power: number | null, price: number): number | null {
  if (power == null || price <= 0) return null
  return round((power / price) / (100 / G16_REFERENCE.advertisedPrice))
}

function hasUnresolvedConflict(listing: LaptopListing): boolean {
  return listing.warnings.some((warning) => /^conflicting\b/i.test(warning))
}

export function assessBestBuy(listing: LaptopListing, options: GateOptions = {}): BestBuyAssessment {
  const minRamGb = options.minRamGb ?? G16_REFERENCE.ramGb
  const multiPower = listing.cpuMultiPower ?? null
  const singlePower = listing.cpuSinglePower ?? null
  const power = workPerformance(multiPower, singlePower)
  const failures: string[] = []

  if (listing.hardExcluded) failures.push('not a complete working laptop')
  if (multiPower == null || singlePower == null) failures.push('CPU benchmark evidence missing')
  else {
    if (multiPower < 100) failures.push('multi-core below G16')
    if (singlePower < GATE_TOLERANCE.singleThread) failures.push('single-thread more than 5% below G16')
  }
  if ((listing.ramGb ?? 0) < minRamGb) failures.push(`RAM below ${minRamGb} GB`)
  if ((listing.storageGb ?? 0) < G16_REFERENCE.storageGb) failures.push('storage below 1 TB')
  if ((listing.gpuPower ?? 0) < GATE_TOLERANCE.graphics) failures.push('graphics more than 5% below RTX 4060')
  if (hasUnresolvedConflict(listing)) failures.push('unresolved specification conflict')
  if (listing.price > 3000) failures.push('price above £3,000')

  const credit = surplusCredit(listing.ramGb, listing.storageGb)
  const priced = effectivePrice(listing)

  return {
    eligible: failures.length === 0,
    failures,
    workPerformance: power,
    workValue: workValueRatio(power, priced),
    surplusCredit: credit,
    effectivePrice: priced,
  }
}

function dominates(a: LaptopListing, b: LaptopListing, options: GateOptions): boolean {
  const aAssessment = assessBestBuy(a, options)
  const bAssessment = assessBestBuy(b, options)
  if (!aAssessment.eligible || !bAssessment.eligible) return false

  const noWorse = aAssessment.effectivePrice <= bAssessment.effectivePrice
    && aAssessment.workPerformance! >= bAssessment.workPerformance!
    && (a.ramGb ?? 0) >= (b.ramGb ?? 0)
    && (a.storageGb ?? 0) >= (b.storageGb ?? 0)
  const strictlyBetter = aAssessment.effectivePrice < bAssessment.effectivePrice
    || aAssessment.workPerformance! > bAssessment.workPerformance!
    || (a.ramGb ?? 0) > (b.ramGb ?? 0)
    || (a.storageGb ?? 0) > (b.storageGb ?? 0)

  return noWorse && strictlyBetter
}

export function bestBuyFrontier(listings: LaptopListing[], options: GateOptions = {}): LaptopListing[] {
  const eligible = listings.filter((listing) => assessBestBuy(listing, options).eligible)
  return eligible.filter((listing, index) => !eligible.some((candidate, candidateIndex) => (
    candidateIndex !== index && dominates(candidate, listing, options)
  )))
}

function conditionRank(condition: string): number {
  const normalized = condition.toLowerCase()
  if (normalized.includes('new')) return 4
  if (normalized.includes('certified')) return 3
  if (normalized.includes('refurb')) return 2
  if (normalized.includes('used')) return 1
  return 0
}

export function rankBestBuys(listings: LaptopListing[], options: GateOptions = {}): LaptopListing[] {
  return bestBuyFrontier(listings, options).sort((a, b) => {
    const aAssessment = assessBestBuy(a, options)
    const bAssessment = assessBestBuy(b, options)
    return (bAssessment.workValue! - aAssessment.workValue!)
      || Date.parse(b.benchmarkEvidenceAt ?? '1970-01-01') - Date.parse(a.benchmarkEvidenceAt ?? '1970-01-01')
      || (b.sellerFeedbackPercent ?? 0) - (a.sellerFeedbackPercent ?? 0)
      || (b.sellerFeedbackScore ?? 0) - (a.sellerFeedbackScore ?? 0)
      || Number(b.returnsAccepted === true) - Number(a.returnsAccepted === true)
      || conditionRank(b.condition) - conditionRank(a.condition)
      || aAssessment.effectivePrice - bAssessment.effectivePrice
      || a.id.localeCompare(b.id)
  })
}
