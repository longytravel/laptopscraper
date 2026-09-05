import {
  CPU_BASELINE,
  CPU_BENCHMARKS,
  GPU_BASELINE,
  GPU_BENCHMARKS,
  matchBenchmark,
} from './benchmarks'
import type {
  EbayAspect,
  FrontierPoint,
  LaptopFilters,
  LaptopListing,
  ParsedLaptop,
  RawLaptopListing,
  SpecConfidence,
} from './types'

const BRANDS = ['ASUS', 'Lenovo', 'MSI', 'Alienware', 'Dell', 'HP', 'Acer', 'Razer', 'Gigabyte', 'Medion', 'Samsung']

const HARD_EXCLUSIONS: Array<[RegExp, string]> = [
  [/\b(?:box|manual|charger|screen|display|keyboard|motherboard|mainboard|shell|case)\s+only\b/i, 'accessory only'],
  [/\b(?:spares?\s*(?:or|&)?\s*repairs?|for\s+parts|parts\s+only|faulty|untested)\b/i, 'faulty or untested'],
  [/\b(?:no\s+power|liquid\s+damage|water\s+damage)\b/i, 'major damage'],
]

const TITLE_ONLY_EXCLUSIONS: Array<[RegExp, string]> = [
  [/\b(?:laptop\s+)?(?:motherboard|mainboard)\b/i, 'computer component only'],
]

const DESKTOP_GPU_CONTEXT = /\b(?:graphics\s+card\s+only|gpu\s+only|e-?gpu|external\s+gpu|desktop\s+(?:graphics\s+card|gpu)|graphics\s+card\s+for\s+desktop)\b/i
const LAPTOP_CONTEXT = /\b(?:laptop|notebook|mobile\s+workstation|rog|strix|legion|alienware|raider|predator|omen|blade|aorus)\b/i

const RISKS: Array<[RegExp, string]> = [
  [/\bno\s+(?:original\s+)?charger\b/i, 'no charger'],
  [/\b(?:blue\s*screen|bsod|random(?:ly)?\s+(?:crash|restart)|crash(?:es|ing)?|unstable|intermittent)\b/i, 'instability reported'],
  [/\b(?:bios|firmware|mdm|activation|account)\s*(?:is\s*)?(?:password|locked|lock)\b/i, 'firmware or account lock'],
  [/\b(?:overheat|overheating|runs\s+hot)\b/i, 'thermal concern'],
  [/\b(?:screen\s+damage|dead\s+pixel|screen\s+line|damaged\s+hinge|hinge\s+damage)\b/i, 'display or hinge damage'],
  [/\b(?:battery\s+(?:fault|issue|dead)|poor\s+battery|battery\s+not\s+holding)\b/i, 'battery concern'],
  [/\b(?:stock\s+photo|library\s+photo)\b/i, 'stock photos'],
  [/\bno\s+(?:dell|lenovo|asus|hp|msi|acer|razer|apple|samsung|manufacturer|manufacturer'?s|maker'?s|oem)\s+warranty\b|\b(?:manufacturer'?s?|dell|lenovo|asus|hp)\s+warranty\s+(?:has\s+)?(?:expired|ended|void|voided|lapsed)\b|\bout\s+of\s+(?:manufacturer'?s?\s+)?warranty\b|\bno\s+warranty\b/i, 'no manufacturer warranty'],
]

/**
 * Sellers say "no faults", "not for parts" and "fully tested, not untested"
 * far more often than the opposite once the full description is read, so a
 * hard-exclusion word inside the description only counts when nothing negates
 * it in the few words before. Titles are taken at face value.
 */
const NEGATION_BEFORE = /\b(?:no|not|never|isn'?t|aren'?t|without|non|zero|free\s+(?:of|from))\W+(?:\w+\W+){0,3}$/i

function hardExclusionIn(text: string, guarded: boolean): [RegExp, string] | undefined {
  for (const entry of HARD_EXCLUSIONS) {
    const pattern = new RegExp(entry[0].source, entry[0].flags.includes('g') ? entry[0].flags : `${entry[0].flags}g`)
    for (const match of text.matchAll(pattern)) {
      if (!guarded || !NEGATION_BEFORE.test(text.slice(Math.max(0, match.index - 40), match.index))) return entry
    }
  }
  return undefined
}

/**
 * "Upgradeable to 128GB", "supports up to 4TB" describe the chassis, not the
 * unit for sale. Left in, they read as a second capacity claim and mark a
 * correctly listed machine as conflicting.
 */
function withoutCapacityCeilings(text: string): string {
  return text.replace(/\b(?:up\s+to|upgrad(?:e|ed|eable|able)\s+to|max(?:imum)?(?:\s+of)?|supports?(?:\s+up\s+to)?|expandable\s+to|can\s+(?:be\s+)?(?:take|hold|upgraded?\s+to|fit)|room\s+for|capacity\s+(?:of|for))\s+(?:\d+(?:\.\d+)?\s*(?:GB|TB)\b[^.;\n]{0,40})/gi, ' ')
}

function aspectMap(aspects: EbayAspect[] = []): Map<string, string> {
  return new Map(aspects.map((aspect) => [String(aspect.name ?? '').trim().toLowerCase(), String(aspect.value ?? '').trim()]))
}

function findAspect(aspects: Map<string, string>, names: string[]): string {
  for (const name of names) {
    const exact = aspects.get(name)
    if (exact) return exact
    const fuzzy = [...aspects.entries()].find(([key]) => key.includes(name))?.[1]
    if (fuzzy) return fuzzy
  }
  return ''
}

function numericCapacity(text: string, kind: 'ram' | 'storage'): number | null {
  const patterns = kind === 'ram'
    ? [/(\d{1,3})\s*GB\s*(?:DDR\d?\s*)?(?:RAM|memory)/i, /(?:RAM|memory)\s*[:-]?\s*(\d{1,3})\s*GB/i, /(\d{1,3})\s*GB\s*DDR\d/i]
    : [/(\d+(?:\.\d+)?)\s*(TB|GB)\s*(?:NVMe|SSD|HDD|storage|solid\s+state)/i, /(?:storage|SSD|NVMe)\s*[:-]?\s*(\d+(?:\.\d+)?)\s*(TB|GB)/i]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (!match) continue
    const value = Number(match[1])
    const unit = match[2]?.toUpperCase()
    return unit === 'TB' ? Math.round(value * 1024) : Math.round(value)
  }
  return null
}

function aspectCapacity(value: string): number | null {
  const match = value.match(/(\d+(?:\.\d+)?)\s*(TB|GB)/i)
  if (!match) return null
  return Math.round(Number(match[1]) * (match[2].toUpperCase() === 'TB' ? 1024 : 1))
}

function screenSize(text: string): number | null {
  const match = text.match(/\b(1[3-9](?:\.\d)?)\s*(?:inch(?:es)?|in\b|")/i)
  return match ? Number(match[1]) : null
}

/** Maps any resolution wording ("2560 x 1600", "WQXGA", "QHD+") to the class label the parser stores. */
export function normalizeResolution(text: string): string | null {
  if (/\b(?:3840\s*x\s*2160|4k|uhd)\b/i.test(text)) return '4K/UHD'
  if (/\b(?:2560\s*x\s*(?:1440|1600)|qhd\+?|wqxga)\b/i.test(text)) return 'QHD'
  if (/\b(?:1920\s*x\s*(?:1080|1200)|fhd\+?)\b/i.test(text)) return 'FHD'
  return null
}

export function parseLaptopListing(raw: Pick<RawLaptopListing, 'title' | 'description' | 'conditionDescription' | 'localizedAspects' | 'categoryId'>): ParsedLaptop {
  const title = raw.title ?? ''
  const description = `${raw.description ?? ''} ${raw.conditionDescription ?? ''}`
  const fullText = `${title} ${description}`
  const aspects = aspectMap(raw.localizedAspects)
  const cpuAspect = findAspect(aspects, ['processor', 'cpu'])
  const gpuAspect = findAspect(aspects, ['graphics processing type', 'gpu', 'graphics card', 'graphics'])
  const aspectCpu = matchBenchmark(cpuAspect, CPU_BENCHMARKS)
  const aspectGpu = matchBenchmark(gpuAspect, GPU_BENCHMARKS)
  const titleCpu = matchBenchmark(title, CPU_BENCHMARKS)
  const titleGpu = matchBenchmark(title, GPU_BENCHMARKS)
  const descriptionCpu = matchBenchmark(description, CPU_BENCHMARKS)
  const descriptionGpu = matchBenchmark(description, GPU_BENCHMARKS)
  const cpu = aspectCpu ?? titleCpu ?? descriptionCpu
  const hasLaptopContext = raw.categoryId === '177' || LAPTOP_CONTEXT.test(fullText) || /laptop/i.test(gpuAspect) || /\b\d{4,5}h[xs]?\b/i.test(fullText)
  const gpu = hasLaptopContext && !DESKTOP_GPU_CONTEXT.test(fullText)
    ? aspectGpu ?? titleGpu ?? descriptionGpu
    : null
  const warnings: string[] = []

  if (cpuAspect && titleCpu && cpu?.canonical !== titleCpu.canonical) warnings.push('conflicting CPU specifications')
  if (gpuAspect && titleGpu && gpu?.canonical !== titleGpu.canonical) warnings.push('conflicting GPU specifications')

  const ramAspect = aspectCapacity(findAspect(aspects, ['ram size', 'installed ram', 'memory']))
  const storageAspect = aspectCapacity(findAspect(aspects, ['ssd capacity', 'storage capacity', 'hard drive capacity']))
  const descriptionForCapacity = withoutCapacityCeilings(description)
  const titleRam = numericCapacity(title, 'ram')
  const descriptionRam = numericCapacity(descriptionForCapacity, 'ram')
  const titleStorage = numericCapacity(title, 'storage')
  const descriptionStorage = numericCapacity(descriptionForCapacity, 'storage')
  const textRam = titleRam ?? descriptionRam
  const textStorage = titleStorage ?? descriptionStorage
  if (ramAspect && textRam && ramAspect !== textRam) warnings.push('conflicting RAM specifications')
  if (storageAspect && textStorage && storageAspect !== textStorage) warnings.push('conflicting storage specifications')
  // Sellers stuff inflated specs into eBay aspects to match search filters; when the
  // listing's own text disagrees, trust the smaller claim.
  const ramGb = ramAspect && textRam ? Math.min(ramAspect, textRam) : ramAspect ?? textRam
  const storageGb = storageAspect && textStorage ? Math.min(storageAspect, textStorage) : storageAspect ?? textStorage
  const screenAspect = screenSize(findAspect(aspects, ['screen size', 'display size']))
  const screenInches = screenAspect ?? screenSize(fullText)
  const resolutionValue = findAspect(aspects, ['maximum resolution', 'resolution'])
  const matchedExclusion = TITLE_ONLY_EXCLUSIONS.find(([pattern]) => pattern.test(title))
    ?? hardExclusionIn(title, false)
    ?? hardExclusionIn(description, true)
  const riskFlags = RISKS.filter(([pattern]) => pattern.test(fullText)).map(([, label]) => label)
  const brand = BRANDS.find((candidate) => new RegExp(`\\b${candidate}\\b`, 'i').test(`${findAspect(aspects, ['brand'])} ${fullText}`)) ?? null
  const hasStructuredPair = Boolean(cpuAspect && gpuAspect && cpu && gpu)
  const hasPair = Boolean(cpu && gpu)
  const conflict = warnings.length > 0
  const specConfidence = hasStructuredPair && !conflict ? 'high' : hasPair || conflict ? 'medium' : 'low'

  const provenance = {
    cpu: aspectCpu ? 'aspect' as const : titleCpu ? 'title' as const : descriptionCpu ? 'description' as const : 'unknown' as const,
    gpu: aspectGpu && gpu ? 'aspect' as const : titleGpu && gpu ? 'title' as const : descriptionGpu && gpu ? 'description' as const : 'unknown' as const,
    ram: ramAspect && !(textRam && textRam < ramAspect) ? 'aspect' as const : titleRam ? 'title' as const : descriptionRam ? 'description' as const : ramAspect ? 'aspect' as const : 'unknown' as const,
    storage: storageAspect && !(textStorage && textStorage < storageAspect) ? 'aspect' as const : titleStorage ? 'title' as const : descriptionStorage ? 'description' as const : storageAspect ? 'aspect' as const : 'unknown' as const,
  }

  const weightMatch = `${findAspect(aspects, ['item weight', 'weight'])} ${fullText}`.match(/(\d+(?:\.\d+)?)\s*kg\b/i)
  const weightCandidate = weightMatch ? Number(weightMatch[1]) : null
  // laptops weigh 0.8-6kg; anything else is package weight or noise
  const weightKg = weightCandidate && weightCandidate >= 0.8 && weightCandidate <= 6 ? weightCandidate : null

  return {
    brand,
    cpuModel: cpu?.canonical ?? null,
    cpuManufacturer: cpu?.manufacturer ?? null,
    gpuModel: gpu?.canonical ?? null,
    gpuFamily: gpu?.family ?? null,
    ramGb,
    storageGb,
    screenInches,
    weightKg,
    resolution: normalizeResolution(resolutionValue || fullText),
    vramGb: gpu?.vramGb ?? null,
    hardExcluded: Boolean(matchedExclusion),
    hardExclusionReason: matchedExclusion?.[1] ?? null,
    riskFlags: [...new Set(riskFlags)],
    warnings,
    specConfidence,
    provenance,
  }
}

function round(value: number, digits = 1): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

export function combinedPower(cpuPower: number | null, gpuPower: number | null, cpuWeight = 0.6): number | null {
  if (cpuPower == null || gpuPower == null || cpuPower <= 0 || gpuPower <= 0) return null
  const boundedWeight = Math.max(0.2, Math.min(0.9, cpuWeight))
  return round(100 * (cpuPower / 100) ** boundedWeight * (gpuPower / 100) ** (1 - boundedWeight))
}

export function computeRecommendationScore(input: {
  valueIndex: number | null
  specConfidence: SpecConfidence
  sellerFeedbackPercent: number | null
  sellerFeedbackScore: number | null
  returnsAccepted: boolean | null
  riskFlags: string[]
  hardExcluded: boolean
}): number {
  const confidencePoints = { high: 14, medium: 8, low: 0 }[input.specConfidence]
  const sellerPoints = (input.sellerFeedbackPercent != null && input.sellerFeedbackPercent >= 99 ? 8 : input.sellerFeedbackPercent != null && input.sellerFeedbackPercent >= 97 ? 4 : 0)
    + (input.sellerFeedbackScore != null && input.sellerFeedbackScore >= 100 ? 4 : 0)
  const safetyPenalty = input.riskFlags.length * 7 + (input.hardExcluded ? 50 : 0)
  return Math.max(0, Math.min(100, round((input.valueIndex ?? 0) * 0.55 + confidencePoints + sellerPoints + (input.returnsAccepted ? 6 : 0) - safetyPenalty, 0)))
}

export function enrichListing(raw: RawLaptopListing, cpuWeight = 0.6): LaptopListing {
  const parsed = parseLaptopListing(raw)
  const cpuEntry = parsed.cpuModel ? CPU_BENCHMARKS.find((entry) => entry.canonical === parsed.cpuModel) : null
  const gpuEntry = parsed.gpuModel ? GPU_BENCHMARKS.find((entry) => entry.canonical === parsed.gpuModel) : null
  const cpuPower = cpuEntry ? round(100 * cpuEntry.score / CPU_BASELINE) : null
  const gpuPower = gpuEntry ? round(100 * gpuEntry.score / GPU_BASELINE) : null
  const power = combinedPower(cpuPower, gpuPower, cpuWeight)
  const price = Number(raw.price ?? 0)
  const shippingPrice = raw.shippingPrice == null ? null : Number(raw.shippingPrice)
  const deliveredPrice = shippingPrice == null ? null : round(price + shippingPrice, 2)
  const valueIndex = power && deliveredPrice != null && deliveredPrice > 0 ? round(power / (deliveredPrice / 1000)) : null
  const missingSpecs = [
    !parsed.cpuModel && 'CPU',
    !parsed.gpuModel && 'GPU',
    parsed.ramGb == null && 'RAM',
    parsed.storageGb == null && 'storage',
    shippingPrice == null && 'shipping',
  ].filter(Boolean) as string[]
  const feedback = raw.sellerFeedbackPercent ?? null
  const feedbackCount = raw.sellerFeedbackScore ?? null
  const returnsAccepted = raw.returnTerms?.returnsAccepted ?? null
  const recommendationScore = computeRecommendationScore({
    valueIndex,
    specConfidence: parsed.specConfidence,
    sellerFeedbackPercent: feedback,
    sellerFeedbackScore: feedbackCount,
    returnsAccepted,
    riskFlags: parsed.riskFlags,
    hardExcluded: parsed.hardExcluded,
  })

  return {
    ...parsed,
    id: raw.sourceListingId ?? raw.listingUrl ?? titleId(raw.title ?? ''),
    title: raw.title ?? 'Untitled eBay listing',
    description: raw.description ?? '',
    sourceEvidence: {
      conditionDescription: raw.conditionDescription ?? '',
      localizedAspects: raw.localizedAspects ?? [],
    },
    listingUrl: raw.listingUrl ?? '',
    imageUrl: raw.imageUrls?.[0] ?? raw.imageUrl ?? null,
    price,
    shippingPrice,
    deliveredPrice,
    currency: raw.currency ?? 'GBP',
    condition: raw.condition ?? 'Unknown',
    sellerName: raw.sellerName ?? 'Unknown seller',
    sellerFeedbackScore: feedbackCount,
    sellerFeedbackPercent: feedback,
    location: raw.location ?? '',
    buyingOptions: raw.buyingOptions ?? [],
    returnsAccepted,
    returnPeriodDays: raw.returnTerms?.returnPeriodDays ?? null,
    returnShippingPaidBy: raw.returnTerms?.returnShippingPaidBy ?? null,
    sellerAccountType: raw.sellerAccountType ?? null,
    listedAt: raw.listedAt ?? null,
    scrapedAt: raw.scrapedAt ?? null,
    searchTerms: raw.searchTerms ?? [],
    cpuPower,
    gpuPower,
    combinedPower: power,
    valueIndex,
    recommendationScore,
    missingSpecs,
    ramUpgradeable: null,
  }
}

function titleId(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'unknown'
}

export function paretoFrontier<T extends FrontierPoint>(rows: T[]): T[] {
  const sorted = rows
    .filter((row): row is T & { combinedPower: number; deliveredPrice: number } => row.combinedPower != null && row.deliveredPrice != null)
    .slice()
    .sort((a, b) => a.deliveredPrice - b.deliveredPrice || b.combinedPower - a.combinedPower)
  const frontier: T[] = []
  let bestPower = -Infinity
  for (const row of sorted) {
    if (row.combinedPower > bestPower) {
      frontier.push(row)
      bestPower = row.combinedPower
    }
  }
  return frontier
}

export function createDefaultFilters(): LaptopFilters {
  return {
    minPrice: 0,
    maxPrice: 3000,
    minCombinedPower: 0,
    minCpuPower: 0,
    minGpuPower: 0,
    cpuWeight: 0.6,
    minRamGb: 64,
    minVramGb: 0,
    minStorageGb: 1000,
    minScreenInches: 0,
    maxScreenInches: 20,
    minSellerFeedback: 0,
    minSellerFeedbackCount: 0,
    returnsRequired: false,
    ukOnly: false,
    showNeedsChecking: false,
    showHardExcluded: false,
    allowedConditions: new Set(),
    allowedBrands: new Set(),
    allowedCpuManufacturers: new Set(),
    allowedGpuFamilies: new Set(),
    allowedBuyingOptions: new Set(),
    allowedConfidence: new Set(),
    excludedRisks: new Set(['instability reported', 'firmware or account lock', 'no charger', 'not a laptop']),
  }
}

function selected(set: Set<string>, value: string | null): boolean {
  return set.size === 0 || (value != null && set.has(value))
}

export function applyFilters(listings: LaptopListing[], filters: LaptopFilters): LaptopListing[] {
  return listings.filter((listing) => {
    const recomputedPower = combinedPower(listing.cpuPower, listing.gpuPower, filters.cpuWeight)
    const needsChecking = recomputedPower == null
    const unknownPrice = listing.deliveredPrice == null
    const filterPrice = listing.deliveredPrice ?? listing.price
    if (unknownPrice && !filters.showNeedsChecking) return false
    if (filterPrice < filters.minPrice || filterPrice > filters.maxPrice) return false
    if (listing.hardExcluded && !filters.showHardExcluded) return false
    if (needsChecking && !filters.showNeedsChecking) return false
    if (!needsChecking && recomputedPower! < filters.minCombinedPower) return false
    if (listing.cpuPower != null && listing.cpuPower < filters.minCpuPower) return false
    if (listing.gpuPower != null && listing.gpuPower < filters.minGpuPower) return false
    if ((listing.ramGb ?? 0) < filters.minRamGb) return false
    if ((listing.vramGb ?? 0) < filters.minVramGb) return false
    if ((listing.storageGb ?? 0) < filters.minStorageGb) return false
    if (listing.screenInches != null && (listing.screenInches < filters.minScreenInches || listing.screenInches > filters.maxScreenInches)) return false
    if ((listing.sellerFeedbackPercent ?? 0) < filters.minSellerFeedback) return false
    if ((listing.sellerFeedbackScore ?? 0) < filters.minSellerFeedbackCount) return false
    if (filters.returnsRequired && listing.returnsAccepted !== true) return false
    if (filters.ukOnly && !/\b(?:GB|UK|United Kingdom)\b/i.test(listing.location)) return false
    if (!selected(filters.allowedConditions, listing.condition)) return false
    if (!selected(filters.allowedBrands, listing.brand)) return false
    if (!selected(filters.allowedCpuManufacturers, listing.cpuManufacturer)) return false
    if (!selected(filters.allowedGpuFamilies, listing.gpuFamily)) return false
    if (!selected(filters.allowedConfidence, listing.specConfidence)) return false
    if (filters.allowedBuyingOptions.size && !listing.buyingOptions.some((option) => filters.allowedBuyingOptions.has(option))) return false
    if (listing.riskFlags.some((risk) => filters.excludedRisks.has(risk))) return false
    return true
  }).map((listing) => {
    const power = combinedPower(listing.cpuPower, listing.gpuPower, filters.cpuWeight)
    return {
      ...listing,
      combinedPower: power,
      valueIndex: power && listing.deliveredPrice != null && listing.deliveredPrice > 0 ? round(power / (listing.deliveredPrice / 1000)) : null,
    }
  })
}
