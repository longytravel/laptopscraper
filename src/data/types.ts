export type Confidence = 'High' | 'Medium' | 'Low'
export type Risk = 'Low' | 'Medium' | 'High'
export type Decision = 'Strong buy' | 'Watch' | 'Avoid'

export interface Identity {
  brand: string
  lensModel: string
  mount: string
  focalLength: string
  aperture: string
  conditionGrade: string
  includedAccessories: string[]
}

export interface Opportunity {
  id: string
  score: number
  decision: Decision
  title: string
  source: string
  askingPrice: number
  marketValue: number
  lowValue: number
  highValue: number
  expectedProfit: number
  roiPercent: number
  confidence: Confidence
  risk: Risk
  compCount: number
  seller: string
  location: string
  listingAgeDays: number
  url: string
  imageUrls: string[]
  identity: Identity
  warnings: string[]
  checklist: string[]
}

export interface LiveListing {
  source: string
  searchTerm: string
  sourceListingId: string
  listingUrl: string
  title: string
  price: number
  shippingPrice: number
  currency: string
  condition: string
  sellerName: string
  sellerFeedbackScore: number | null
  sellerFeedbackPercent: number | null
  location: string
  category: string
  imageUrls: string[]
  listedAt: string | null
  scrapedAt: string
  excluded: boolean
  excludedReason: string | null
  riskFlags: string[]
}

export interface SoldComp {
  source: string
  searchTerm: string
  soldItemId: string
  soldUrl: string
  title: string
  price: number
  shippingPrice: number
  totalSoldValue: number
  currency: string
  condition: string
  soldDate: string | null
  includeInValuation?: boolean
  exclusionReasons?: string[]
  totalSold?: number
  itemSales?: number
}
