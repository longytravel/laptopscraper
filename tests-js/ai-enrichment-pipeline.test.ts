import assert from 'node:assert/strict'
import test from 'node:test'

import { enrichListing } from '../src/laptop/engine.ts'
import { AI_MODEL, AI_PROMPT_VERSION, type AiResponsesClient } from '../src/laptop/ai-enrichment.ts'
import { listingFingerprint, runAiEnrichment, type AiEnrichmentCache } from '../src/laptop/ai-pipeline.ts'
import type { LaptopDataset } from '../src/laptop/types.ts'

const blankExtraction = {
  fields: {
    brand: { value: null, evidence: null, confidence: 'low' as const },
    cpuModel: { value: null, evidence: null, confidence: 'low' as const },
    gpuModel: { value: null, evidence: null, confidence: 'low' as const },
    ramGb: { value: null, evidence: null, confidence: 'low' as const },
    storageGb: { value: null, evidence: null, confidence: 'low' as const },
    screenInches: { value: null, evidence: null, confidence: 'low' as const },
    resolution: { value: null, evidence: null, confidence: 'low' as const },
    vramGb: { value: null, evidence: null, confidence: 'low' as const },
    ramUpgradeable: { value: null, evidence: null, confidence: 'low' as const },
  },
  riskFlags: [],
  note: 'No extra facts.',
}

function dataset(rows: LaptopDataset['listings']): LaptopDataset {
  return {
    schemaVersion: 5,
    generatedAt: '2026-07-22T00:00:00.000Z',
    marketplaceId: 'EBAY_GB',
    benchmarkVersion: 'test',
    rawCount: rows.length,
    listingCount: rows.length,
    scoredCount: rows.filter((row) => row.combinedPower != null).length,
    needsCheckingCount: rows.filter((row) => row.combinedPower == null || row.deliveredPrice == null).length,
    searchRuns: [],
    listings: rows,
  }
}

test('listing fingerprint is stable and changes with listing evidence', () => {
  const row = enrichListing({ sourceListingId: 'one', title: 'ASUS laptop', description: 'First description', price: 1, shippingPrice: 0 })
  assert.equal(listingFingerprint(row), listingFingerprint({ ...row }))
  assert.equal(listingFingerprint(row), listingFingerprint({ ...row, cpuModel: 'Intel Core i9-14900HX', ramGb: 64 }))
  assert.notEqual(listingFingerprint(row), listingFingerprint({ ...row, description: 'Changed description' }))
})

test('pipeline reuses cache and requests only changed listings', async () => {
  const cachedRow = enrichListing({ sourceListingId: 'cached', title: 'ASUS i9-14900HX RTX 4060 laptop', price: 1000, shippingPrice: 0 })
  const freshRow = enrichListing({ sourceListingId: 'fresh', title: 'ASUS laptop', description: 'Uses Intel 14900 HX and GeForce forty-seventy laptop.', price: 900, shippingPrice: null })
  const cache: AiEnrichmentCache = {
    version: 1,
    entries: {
      [listingFingerprint(cachedRow)]: {
        model: AI_MODEL,
        promptVersion: AI_PROMPT_VERSION,
        responseId: 'cached_response',
        createdAt: '2026-07-22T00:00:00.000Z',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        extraction: blankExtraction,
      },
    },
  }
  let calls = 0
  const client: AiResponsesClient = {
    responses: {
      parse: async () => {
        calls += 1
        return {
          id: 'fresh_response',
          usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 },
          output_parsed: {
            ...blankExtraction,
            fields: {
              ...blankExtraction.fields,
              cpuModel: { value: 'Intel Core i9-14900HX', evidence: '14900 HX', confidence: 'high' },
              gpuModel: { value: 'NVIDIA GeForce RTX 4070 Laptop GPU', evidence: 'GeForce forty-seventy laptop', confidence: 'high' },
            },
          },
        }
      },
    },
  }

  const result = await runAiEnrichment(dataset([cachedRow, freshRow]), client, cache, { concurrency: 1 })

  assert.equal(calls, 1)
  assert.equal(result.stats.cached, 1)
  assert.equal(result.stats.requested, 1)
  assert.equal(result.stats.succeeded, 1)
  assert.equal(result.dataset.listings[1].cpuModel, 'Intel Core i9-14900HX')
  assert.equal(result.dataset.listings[1].gpuModel, 'NVIDIA GeForce RTX 4070 Laptop GPU')
  assert.equal(result.dataset.aiRun?.inputTokens, 100)
})

test('pipeline records a failed request without mutating the listing', async () => {
  const row = enrichListing({ sourceListingId: 'failure', title: 'Unknown laptop', price: 500, shippingPrice: null })
  const client: AiResponsesClient = { responses: { parse: async () => { throw new Error('temporary failure') } } }

  const result = await runAiEnrichment(dataset([row]), client, { version: 1, entries: {} }, { concurrency: 1, retries: 0 })

  assert.equal(result.stats.failed, 1)
  assert.deepEqual(result.dataset.listings[0], row)
})
