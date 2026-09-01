import { createHash } from 'node:crypto'

import {
  AI_MODEL,
  AI_PROMPT_VERSION,
  aiEvidenceBundle,
  mergeAiEnrichment,
  requestListingEnrichment,
  validateAiEvidence,
  type AiListingExtraction,
  type AiResponsesClient,
} from './ai-enrichment'
import { G16_REFERENCE } from './best-buy'
import type { LaptopDataset, LaptopListing } from './types'

export interface AiCacheEntry {
  model: string
  promptVersion: string
  responseId: string | null
  createdAt: string
  usage: { inputTokens: number; outputTokens: number; totalTokens: number }
  extraction: AiListingExtraction
}

export interface AiEnrichmentCache {
  version: 1
  entries: Record<string, AiCacheEntry>
}

export interface AiRunStats {
  requested: number
  cached: number
  /** Left on deterministic evidence because the run's request budget was spent. */
  skipped: number
  /** Never requested: already measured under a hard gate that AI evidence cannot lift. */
  unqualifiable: number
  succeeded: number
  failed: number
  merged: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

export interface AiPipelineOptions {
  concurrency?: number
  retries?: number
  /**
   * Cap on uncached model requests in a single run. Cache hits are free and do
   * not count. Widening the eBay search multiplied the listing count, and an
   * uncapped run outgrew the workflow's job timeout, so each run now spends a
   * bounded budget on the listings most likely to qualify and lets the cache
   * fill in the rest over subsequent runs.
   */
  maxRequests?: number
  onCheckpoint?: (cache: AiEnrichmentCache) => Promise<void>
  onProgress?: (completed: number, total: number, stats: AiRunStats) => void
  sleep?: (milliseconds: number) => Promise<void>
}

/**
 * Whether a listing is already out of the running before any model call. The
 * merge never overrides a deterministic value with an AI claim, so a listing
 * whose own text or aspects put it under the RAM or storage floor, or mark it
 * as parts or faulty, cannot be rescued by more evidence. Around four listings
 * in five fall here, and paying to enrich them buys nothing.
 */
export function cannotQualify(listing: LaptopListing): boolean {
  return listing.hardExcluded
    || (listing.ramGb != null && listing.ramGb < G16_REFERENCE.ramGb)
    || (listing.storageGb != null && listing.storageGb < G16_REFERENCE.storageGb)
    || listing.price > 3000
}

export function listingFingerprint(listing: LaptopListing): string {
  return createHash('sha256').update(JSON.stringify({
    promptVersion: AI_PROMPT_VERSION,
    evidence: aiEvidenceBundle(listing),
  })).digest('hex')
}

function changedByMerge(before: LaptopListing, after: LaptopListing): boolean {
  return JSON.stringify({
    cpuModel: before.cpuModel,
    gpuModel: before.gpuModel,
    ramGb: before.ramGb,
    storageGb: before.storageGb,
    screenInches: before.screenInches,
    resolution: before.resolution,
    vramGb: before.vramGb,
    ramUpgradeable: before.ramUpgradeable,
    riskFlags: before.riskFlags,
  }) !== JSON.stringify({
    cpuModel: after.cpuModel,
    gpuModel: after.gpuModel,
    ramGb: after.ramGb,
    storageGb: after.storageGb,
    screenInches: after.screenInches,
    resolution: after.resolution,
    vramGb: after.vramGb,
    ramUpgradeable: after.ramUpgradeable,
    riskFlags: after.riskFlags,
  })
}

/**
 * A provider-level block — spent credits, a dead key, a suspended org. Retrying
 * cannot clear it and neither can the next listing, so the run stops asking.
 * These arrive as 429s alongside ordinary rate limiting, which is why the
 * message is inspected rather than the status alone.
 */
export function isProviderBlocked(error: unknown): boolean {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : 0
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (status === 401 || status === 403) return true
  return /no credits remaining|insufficient_quota|exceeded your current quota|billing|payment required|invalid[_ ]api[_ ]key/i.test(message)
}

function isTransient(error: unknown): boolean {
  if (isProviderBlocked(error)) return false
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: number }).status) : 0
  const name = error instanceof Error ? error.name : ''
  return name === 'ZodError' || status === 408 || status === 409 || status === 429 || status >= 500
}

export async function runAiEnrichment(
  dataset: LaptopDataset,
  client: AiResponsesClient,
  cache: AiEnrichmentCache,
  options: AiPipelineOptions = {},
) {
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4))
  const retries = Math.max(0, options.retries ?? 2)
  const maxRequests = Math.max(0, options.maxRequests ?? Number.POSITIVE_INFINITY)
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)))

  // Spend the request budget on listings that could still clear the replacement
  // floor. Anything already known to sit under the 64 GB gate is enriched last,
  // because no amount of extracted evidence can make it qualify.
  const couldQualify = (listing: LaptopListing): number => {
    if (listing.hardExcluded) return 3
    if (listing.ramGb != null && listing.ramGb < 64) return 2
    if (listing.ramGb != null && listing.ramGb >= 64) return 0
    return 1
  }
  const listings = dataset.listings.slice()
    .map((listing, index) => ({ listing, index, rank: couldQualify(listing) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.listing)
  const stats: AiRunStats = { requested: 0, cached: 0, skipped: 0, unqualifiable: 0, succeeded: 0, failed: 0, merged: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  const failures: Array<{ id: string; error: string }> = []
  let providerBlocked = false
  let providerBlockedReason: string | null = null
  let nextIndex = 0
  let completed = 0
  let checkpointChain = Promise.resolve()

  async function checkpoint() {
    if (!options.onCheckpoint) return
    checkpointChain = checkpointChain.then(() => options.onCheckpoint!(cache))
    await checkpointChain
  }

  async function requestWithRetry(listing: LaptopListing) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await requestListingEnrichment(client, listing)
      } catch (error) {
        if (attempt >= retries || !isTransient(error)) throw error
        await sleep(500 * (2 ** attempt))
      }
    }
  }

  async function processOne(index: number) {
    const listing = listings[index]
    const fingerprint = listingFingerprint(listing)
    let entry: AiCacheEntry | undefined = cache.entries[fingerprint]
    if (entry?.model !== AI_MODEL || entry.promptVersion !== AI_PROMPT_VERSION) entry = undefined

    try {
      if (entry) {
        stats.cached += 1
      } else if (cannotQualify(listing)) {
        // A cached extraction is free to apply; a new one for a listing that
        // can never clear the floor is money for nothing.
        stats.unqualifiable += 1
        return
      } else if (providerBlocked) {
        // The provider has already refused this run outright. Asking again just
        // burns time, so every remaining listing keeps its deterministic evidence.
        stats.skipped += 1
        return
      } else if (stats.requested >= maxRequests) {
        // Budget spent. Leave the listing on its deterministic evidence; a later
        // run picks it up once the higher-priority listings are cached.
        stats.skipped += 1
        return
      } else {
        stats.requested += 1
        const response = await requestWithRetry(listing)
        entry = {
          model: AI_MODEL,
          promptVersion: AI_PROMPT_VERSION,
          responseId: response.responseId,
          createdAt: new Date().toISOString(),
          usage: response.usage,
          extraction: response.extraction,
        }
        cache.entries[fingerprint] = entry
        stats.succeeded += 1
        stats.inputTokens += response.usage.inputTokens
        stats.outputTokens += response.usage.outputTokens
        stats.totalTokens += response.usage.totalTokens
        await checkpoint()
      }

      const validated = validateAiEvidence(listing, entry.extraction)
      const merged = mergeAiEnrichment(listing, validated, entry.responseId)
      if (merged.aiEnrichment) {
        merged.aiEnrichment.model = entry.model
        merged.aiEnrichment.promptVersion = entry.promptVersion
      }
      if (changedByMerge(listing, merged)) stats.merged += 1
      listings[index] = merged
    } catch (error) {
      if (isProviderBlocked(error) && !providerBlocked) {
        providerBlocked = true
        providerBlockedReason = error instanceof Error ? error.message : String(error)
      }
      stats.failed += 1
      failures.push({ id: listing.id, error: error instanceof Error ? error.message : String(error) })
    } finally {
      completed += 1
      options.onProgress?.(completed, listings.length, stats)
    }
  }

  async function worker() {
    while (true) {
      const index = nextIndex
      nextIndex += 1
      if (index >= listings.length) return
      await processOne(index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, listings.length) }, () => worker()))
  await checkpointChain
  const rowModels = [...new Set(listings.map((listing) => listing.aiEnrichment?.model).filter((value): value is string => Boolean(value)))]
  const rowPromptVersions = [...new Set(listings.map((listing) => listing.aiEnrichment?.promptVersion).filter((value): value is string => Boolean(value)))]

  const enrichedDataset: LaptopDataset = {
    ...dataset,
    schemaVersion: Math.max(6, dataset.schemaVersion),
    generatedAt: new Date().toISOString(),
    scoredCount: listings.filter((listing) => listing.combinedPower != null).length,
    needsCheckingCount: listings.filter((listing) => listing.combinedPower == null || listing.deliveredPrice == null).length,
    aiRun: {
      model: rowModels.length === 1 ? rowModels[0] : rowModels.length > 1 ? 'mixed' : AI_MODEL,
      promptVersion: rowPromptVersions.length === 1 ? rowPromptVersions[0] : rowPromptVersions.length > 1 ? 'mixed' : AI_PROMPT_VERSION,
      requested: stats.requested,
      cached: stats.cached,
      skipped: stats.skipped,
      unqualifiable: stats.unqualifiable,
      succeeded: stats.succeeded,
      failed: stats.failed,
      merged: stats.merged,
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
    },
    listings,
  }

  return { dataset: enrichedDataset, cache, stats, failures, providerBlocked, providerBlockedReason }
}
