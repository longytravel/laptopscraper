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
  onCheckpoint?: (cache: AiEnrichmentCache) => Promise<void>
  onProgress?: (completed: number, total: number, stats: AiRunStats) => void
  sleep?: (milliseconds: number) => Promise<void>
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

function isTransient(error: unknown): boolean {
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
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  const listings = dataset.listings.slice()
  const stats: AiRunStats = { requested: 0, cached: 0, succeeded: 0, failed: 0, merged: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  const failures: Array<{ id: string; error: string }> = []
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
      succeeded: stats.succeeded,
      failed: stats.failed,
      merged: stats.merged,
      inputTokens: stats.inputTokens,
      outputTokens: stats.outputTokens,
    },
    listings,
  }

  return { dataset: enrichedDataset, cache, stats, failures }
}
