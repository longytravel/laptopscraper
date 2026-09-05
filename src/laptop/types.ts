export type SpecConfidence = 'high' | 'medium' | 'low'

export interface EbayAspect {
  name?: string
  value?: string
}

export interface RawLaptopListing {
  sourceListingId?: string
  title?: string
  description?: string
  conditionDescription?: string
  categoryId?: string
  price?: number
  shippingPrice?: number | null
  currency?: string
  condition?: string
  sellerName?: string
  sellerFeedbackScore?: number | null
  sellerFeedbackPercent?: number | null
  listingUrl?: string
  location?: string
  imageUrls?: string[]
  imageUrl?: string
  localizedAspects?: EbayAspect[]
  buyingOptions?: string[]
  returnTerms?: { returnsAccepted?: boolean; returnPeriodDays?: number | null; returnShippingPaidBy?: string | null } | null
  /** eBay's BUSINESS or INDIVIDUAL. A business seller owes UK consumer-rights protection on top of eBay's guarantee. */
  sellerAccountType?: string | null
  listedAt?: string | null
  scrapedAt?: string
  searchTerms?: string[]
  rawPayload?: Record<string, unknown>
}

export interface ParsedLaptop {
  brand: string | null
  cpuModel: string | null
  cpuManufacturer: string | null
  gpuModel: string | null
  gpuFamily: string | null
  ramGb: number | null
  storageGb: number | null
  screenInches: number | null
  resolution: string | null
  vramGb: number | null
  weightKg: number | null
  hardExcluded: boolean
  hardExclusionReason: string | null
  riskFlags: string[]
  warnings: string[]
  specConfidence: SpecConfidence
  provenance: Record<string, 'aspect' | 'title' | 'description' | 'catalog' | 'ai' | 'unknown'>
}

export interface LaptopListing extends ParsedLaptop {
  id: string
  title: string
  description: string
  sourceEvidence?: {
    conditionDescription: string
    localizedAspects: EbayAspect[]
  }
  listingUrl: string
  imageUrl: string | null
  price: number
  shippingPrice: number | null
  deliveredPrice: number | null
  currency: string
  condition: string
  sellerName: string
  sellerFeedbackScore: number | null
  sellerFeedbackPercent: number | null
  location: string
  buyingOptions: string[]
  returnsAccepted: boolean | null
  returnPeriodDays?: number | null
  returnShippingPaidBy?: string | null
  sellerAccountType?: string | null
  listedAt: string | null
  scrapedAt: string | null
  searchTerms: string[]
  cpuPower: number | null
  gpuPower: number | null
  combinedPower: number | null
  valueIndex: number | null
  recommendationScore: number
  missingSpecs: string[]
  cpuMultiPower?: number | null
  cpuSinglePower?: number | null
  workPerformance?: number | null
  workValue?: number | null
  bestBuyEligible?: boolean
  bestBuyFailures?: string[]
  benchmarkEvidenceAt?: string | null
  firstSeenAt?: string
  lastSeenAt?: string
  ramUpgradeable?: boolean | null
  aiEnrichment?: {
    model: string
    promptVersion: string
    responseId: string | null
    rejectedClaims: string[]
    acceptedClaims: Array<{
      field: string
      value: string | number | boolean
      evidence: string
      confidence: SpecConfidence
      applied: boolean
    }>
    riskEvidence: Array<{ label: string; evidence: string }>
    note: string
  }
}

export interface LaptopDataset {
  schemaVersion: number
  generatedAt: string
  refreshStatus?: 'fresh' | 'cached-fallback'
  marketplaceId: string
  benchmarkVersion: string
  rawCount: number
  listingCount: number
  scoredCount: number
  needsCheckingCount: number
  searchRuns: Array<{ searchTerm: string; returned: number; total: number; error?: string; transient?: boolean }>
  aiRun?: {
    model: string
    promptVersion: string
    requested: number
    cached: number
    /** Uncached listings left on deterministic evidence because the run's request budget was spent. */
    skipped?: number
    /** Uncached listings never requested because a hard gate already rules them out. */
    unqualifiable?: number
    succeeded: number
    failed: number
    merged: number
    inputTokens: number
    outputTokens: number
  }
  listings: LaptopListing[]
}

export interface LaptopFilters {
  minPrice: number
  maxPrice: number
  minCombinedPower: number
  minCpuPower: number
  minGpuPower: number
  cpuWeight: number
  minRamGb: number
  minVramGb: number
  minStorageGb: number
  minScreenInches: number
  maxScreenInches: number
  minSellerFeedback: number
  minSellerFeedbackCount: number
  returnsRequired: boolean
  ukOnly: boolean
  showNeedsChecking: boolean
  showHardExcluded: boolean
  allowedConditions: Set<string>
  allowedBrands: Set<string>
  allowedCpuManufacturers: Set<string>
  allowedGpuFamilies: Set<string>
  allowedBuyingOptions: Set<string>
  allowedConfidence: Set<SpecConfidence>
  excludedRisks: Set<string>
}

export interface FrontierPoint {
  id: string
  deliveredPrice: number | null
  combinedPower: number | null
}
