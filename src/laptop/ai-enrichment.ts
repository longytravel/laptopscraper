import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'

import { CPU_BENCHMARKS, GPU_BENCHMARKS, matchBenchmark } from './benchmarks'
import { computeRecommendationScore, enrichListing } from './engine'
import type { LaptopListing, RawLaptopListing, SpecConfidence } from './types'

export const AI_MODEL = 'gpt-5.6-luna'
export const AI_PROMPT_VERSION = 'laptop-evidence-v2'

const confidenceSchema = z.enum(['high', 'medium', 'low'])
const textClaimSchema = z.object({
  value: z.string().nullable(),
  evidence: z.string().nullable(),
  confidence: confidenceSchema,
})
const numberClaimSchema = z.object({
  value: z.number().nullable(),
  evidence: z.string().nullable(),
  confidence: confidenceSchema,
})
const booleanClaimSchema = z.object({
  value: z.boolean().nullable(),
  evidence: z.string().nullable(),
  confidence: confidenceSchema,
})

export const AiListingExtractionSchema = z.object({
  fields: z.object({
    brand: textClaimSchema,
    cpuModel: textClaimSchema,
    gpuModel: textClaimSchema,
    ramGb: numberClaimSchema,
    storageGb: numberClaimSchema,
    screenInches: numberClaimSchema,
    resolution: textClaimSchema,
    vramGb: numberClaimSchema,
    ramUpgradeable: booleanClaimSchema,
  }),
  riskFlags: z.array(z.object({ label: z.string(), evidence: z.string() })),
  note: z.string(),
})

export type AiListingExtraction = z.infer<typeof AiListingExtractionSchema>
type AiFieldName = keyof AiListingExtraction['fields']

export interface AiResponseUsage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
}

export interface AiResponsesClient {
  responses: {
    parse(request: Record<string, unknown>): Promise<{
      id?: string
      output_parsed: unknown
      usage?: AiResponseUsage
    }>
  }
}

export interface AiEnrichmentResponse {
  responseId: string | null
  extraction: AiListingExtraction
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
}

export interface ValidatedAiExtraction {
  accepted: AiListingExtraction
  rejected: string[]
}

const SYSTEM_PROMPT = `Extract only laptop facts explicitly stated in the supplied eBay listing.
Every non-null value must include a short, exact evidence substring copied from the title, description, condition description, or structured eBay aspects.
Do not infer a CPU/GPU from a product family, estimate postage, invent benchmark scores, browse, or decide whether to buy.
The deterministic parse is context for checking conflicts, never a valid evidence source by itself.
Distinguish laptop GPUs from desktop parts and flag faults, locks, missing chargers, instability, and parts-only language.`

export function aiEvidenceBundle(listing: LaptopListing) {
  const deterministic = <T>(field: string, value: T, alias?: string): T | null => (
    listing.provenance[field] === 'ai' || (alias && listing.provenance[alias] === 'ai') ? null : value
  )
  return {
    rawEvidence: {
      title: listing.title,
      description: listing.description,
      condition: listing.condition,
      conditionDescription: listing.sourceEvidence?.conditionDescription ?? '',
      localizedAspects: listing.sourceEvidence?.localizedAspects ?? [],
    },
    deterministicParse: {
      brand: deterministic('brand', listing.brand),
      cpuModel: deterministic('cpuModel', listing.cpuModel, 'cpu'),
      gpuModel: deterministic('gpuModel', listing.gpuModel, 'gpu'),
      ramGb: deterministic('ramGb', listing.ramGb, 'ram'),
      storageGb: deterministic('storageGb', listing.storageGb, 'storage'),
      screenInches: deterministic('screenInches', listing.screenInches),
      resolution: deterministic('resolution', listing.resolution),
      vramGb: deterministic('vramGb', listing.vramGb),
      provenance: Object.fromEntries(Object.entries(listing.provenance).map(([field, source]) => [field, source === 'ai' ? 'unknown' : source])),
    },
  }
}

function listingInput(listing: LaptopListing): string {
  return JSON.stringify(aiEvidenceBundle(listing), null, 2)
}

export async function requestListingEnrichment(client: AiResponsesClient, listing: LaptopListing): Promise<AiEnrichmentResponse> {
  const response = await client.responses.parse({
    model: AI_MODEL,
    reasoning: { effort: 'medium' },
    store: false,
    max_output_tokens: 1600,
    input: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: listingInput(listing) },
    ],
    text: { format: zodTextFormat(AiListingExtractionSchema, 'laptop_listing_extraction') },
  })
  const extraction = AiListingExtractionSchema.parse(response.output_parsed)
  return {
    responseId: response.id ?? null,
    extraction,
    usage: {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
      totalTokens: response.usage?.total_tokens ?? 0,
    },
  }
}

function emptyClaim(field: AiFieldName): AiListingExtraction['fields'][AiFieldName] {
  const confidence: SpecConfidence = 'low'
  if (field === 'ramUpgradeable') return { value: null, evidence: null, confidence }
  if (['ramGb', 'storageGb', 'screenInches', 'vramGb'].includes(field)) return { value: null, evidence: null, confidence }
  return { value: null, evidence: null, confidence }
}

export function validateAiEvidence(listing: LaptopListing, extraction: AiListingExtraction): ValidatedAiExtraction {
  const searchable = [
    listing.title,
    listing.description,
    listing.condition,
    listing.sourceEvidence?.conditionDescription ?? '',
    ...(listing.sourceEvidence?.localizedAspects ?? []).flatMap((aspect) => [aspect.name ?? '', aspect.value ?? '']),
  ].join('\n').toLocaleLowerCase()
  const accepted = structuredClone(extraction)
  const rejected: string[] = []

  for (const [field, claim] of Object.entries(extraction.fields) as Array<[AiFieldName, AiListingExtraction['fields'][AiFieldName]]>) {
    if (claim.value == null) continue
    if (!claim.evidence || !searchable.includes(claim.evidence.toLocaleLowerCase())) {
      accepted.fields[field] = emptyClaim(field) as never
      rejected.push(`${field}: evidence not found`)
      continue
    }
    if (field === 'cpuModel' && !matchBenchmark(String(claim.value), CPU_BENCHMARKS)) {
      accepted.fields[field] = emptyClaim(field) as never
      rejected.push(`${field}: model not in benchmark catalog`)
    }
    if (field === 'gpuModel' && !matchBenchmark(String(claim.value), GPU_BENCHMARKS)) {
      accepted.fields[field] = emptyClaim(field) as never
      rejected.push(`${field}: model not in benchmark catalog`)
    }
  }

  accepted.riskFlags = extraction.riskFlags.filter((risk) => {
    const valid = Boolean(risk.evidence) && searchable.includes(risk.evidence.toLocaleLowerCase())
    if (!valid) rejected.push(`riskFlags: evidence not found for ${risk.label}`)
    return valid
  })
  return { accepted, rejected }
}

function rawFromListing(listing: LaptopListing, aspects: RawLaptopListing['localizedAspects']): RawLaptopListing {
  return {
    sourceListingId: listing.id,
    title: listing.title,
    description: listing.description,
    conditionDescription: listing.sourceEvidence?.conditionDescription,
    categoryId: '177',
    price: listing.price,
    shippingPrice: listing.shippingPrice,
    currency: listing.currency,
    condition: listing.condition,
    sellerName: listing.sellerName,
    sellerFeedbackScore: listing.sellerFeedbackScore,
    sellerFeedbackPercent: listing.sellerFeedbackPercent,
    listingUrl: listing.listingUrl,
    location: listing.location,
    imageUrl: listing.imageUrl ?? undefined,
    localizedAspects: [...(listing.sourceEvidence?.localizedAspects ?? []), ...(aspects ?? [])],
    buyingOptions: listing.buyingOptions,
    returnTerms: { returnsAccepted: listing.returnsAccepted ?? undefined },
    listedAt: listing.listedAt,
    scrapedAt: listing.scrapedAt ?? undefined,
    searchTerms: listing.searchTerms,
  }
}

export function mergeAiEnrichment(listing: LaptopListing, validated: ValidatedAiExtraction, responseId: string | null = null): LaptopListing {
  const fields = validated.accepted.fields
  const warnings = [...listing.warnings]
  const used = new Set<AiFieldName>()
  const provenanceAlias: Partial<Record<AiFieldName, string>> = {
    cpuModel: 'cpu',
    gpuModel: 'gpu',
    ramGb: 'ram',
    storageGb: 'storage',
  }

  function choose<T>(field: AiFieldName, existing: T | null, candidate: T | null): T | null {
    if (existing != null) {
      if (candidate != null && String(existing).toLocaleLowerCase() !== String(candidate).toLocaleLowerCase()) {
        warnings.push(`AI conflict for ${field}; kept deterministic value`)
      } else if (candidate != null && (listing.provenance[field] === 'ai' || listing.provenance[provenanceAlias[field] ?? ''] === 'ai')) {
        used.add(field)
      }
      return existing
    }
    if (candidate != null) used.add(field)
    return candidate
  }

  const cpuModel = choose('cpuModel', listing.cpuModel, fields.cpuModel.value)
  const gpuModel = choose('gpuModel', listing.gpuModel, fields.gpuModel.value)
  const brand = choose('brand', listing.brand, fields.brand.value)
  const ramGb = choose('ramGb', listing.ramGb, fields.ramGb.value)
  const storageGb = choose('storageGb', listing.storageGb, fields.storageGb.value)
  const screenInches = choose('screenInches', listing.screenInches, fields.screenInches.value)
  const resolution = choose('resolution', listing.resolution, fields.resolution.value)
  const vramGb = choose('vramGb', listing.vramGb, fields.vramGb.value)
  const ramUpgradeable = choose('ramUpgradeable', listing.ramUpgradeable ?? null, fields.ramUpgradeable.value)

  const aspects = [
    brand && { name: 'Brand', value: brand },
    cpuModel && { name: 'Processor', value: cpuModel },
    gpuModel && { name: 'Graphics Processing Type', value: gpuModel },
    ramGb != null && { name: 'RAM Size', value: `${ramGb} GB` },
    storageGb != null && { name: 'SSD Capacity', value: `${storageGb} GB` },
    screenInches != null && { name: 'Screen Size', value: `${screenInches} in` },
    resolution && { name: 'Maximum Resolution', value: resolution },
  ].filter(Boolean) as Array<{ name: string; value: string }>

  const recomputed = enrichListing(rawFromListing(listing, aspects))
  const provenance = { ...recomputed.provenance }
  for (const field of used) {
    provenance[field] = 'ai'
    if (field === 'cpuModel') provenance.cpu = 'ai'
    if (field === 'gpuModel') provenance.gpu = 'ai'
    if (field === 'ramGb') provenance.ram = 'ai'
    if (field === 'storageGb') provenance.storage = 'ai'
  }

  const mergedRiskFlags = [...new Set([...recomputed.riskFlags, ...validated.accepted.riskFlags.map((risk) => risk.label)])]
  return {
    ...recomputed,
    sourceEvidence: listing.sourceEvidence ?? { conditionDescription: '', localizedAspects: [] },
    vramGb,
    ramUpgradeable,
    warnings: [...new Set([...recomputed.warnings, ...warnings])],
    riskFlags: mergedRiskFlags,
    recommendationScore: computeRecommendationScore({
      ...recomputed,
      riskFlags: mergedRiskFlags,
    }),
    provenance,
    aiEnrichment: {
      model: AI_MODEL,
      promptVersion: AI_PROMPT_VERSION,
      responseId,
      rejectedClaims: validated.rejected,
      acceptedClaims: Object.entries(fields).flatMap(([field, claim]) => claim.value == null || claim.evidence == null ? [] : [{
        field,
        value: claim.value,
        evidence: claim.evidence,
        confidence: claim.confidence,
        applied: used.has(field as AiFieldName),
      }]),
      riskEvidence: validated.accepted.riskFlags,
      note: validated.accepted.note,
    },
  }
}
