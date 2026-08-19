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
  ramGbpPerGb: 2.5,
  storageGbpPerGb: 0.06,
} as const

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

export function assessBestBuy(listing: LaptopListing): BestBuyAssessment {
  const multiPower = listing.cpuMultiPower ?? null
  const singlePower = listing.cpuSinglePower ?? null
  const power = workPerformance(multiPower, singlePower)
  const failures: string[] = []

  if (listing.hardExcluded) failures.push('not a complete working laptop')
  if (multiPower == null || singlePower == null) failures.push('CPU benchmark evidence missing')
  else {
    if (multiPower < 100) failures.push('multi-core below G16')
    if (singlePower < 100) failures.push('single-thread below G16')
  }
  if ((listing.ramGb ?? 0) < G16_REFERENCE.ramGb) failures.push('RAM below 64 GB')
  if ((listing.storageGb ?? 0) < G16_REFERENCE.storageGb) failures.push('storage below 1 TB')
  if ((listing.gpuPower ?? 0) < 100) failures.push('graphics below RTX 4060')
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

function dominates(a: LaptopListing, b: LaptopListing): boolean {
  const aAssessment = assessBestBuy(a)
  const bAssessment = assessBestBuy(b)
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

export function bestBuyFrontier(listings: LaptopListing[]): LaptopListing[] {
  const eligible = listings.filter((listing) => assessBestBuy(listing).eligible)
  return eligible.filter((listing, index) => !eligible.some((candidate, candidateIndex) => (
    candidateIndex !== index && dominates(candidate, listing)
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

export function rankBestBuys(listings: LaptopListing[]): LaptopListing[] {
  return bestBuyFrontier(listings).sort((a, b) => {
    const aAssessment = assessBestBuy(a)
    const bAssessment = assessBestBuy(b)
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
