import assert from 'node:assert/strict'
import test from 'node:test'

import { enrichListing } from '../src/laptop/engine.ts'
import {
  mergeAiEnrichment,
  requestListingEnrichment,
  validateAiEvidence,
  type AiListingExtraction,
  type AiResponsesClient,
} from '../src/laptop/ai-enrichment.ts'

function claim<T extends string | number | boolean>(value: T | null, evidence: string | null, confidence: 'high' | 'medium' | 'low' = 'high') {
  return { value, evidence, confidence }
}

function extraction(overrides: Partial<AiListingExtraction['fields']> = {}): AiListingExtraction {
  return {
    fields: {
      brand: claim(null, null),
      cpuModel: claim(null, null),
      gpuModel: claim(null, null),
      ramGb: claim(null, null),
      storageGb: claim(null, null),
      screenInches: claim(null, null),
      resolution: claim(null, null),
      vramGb: claim(null, null),
      ramUpgradeable: claim(null, null),
      ...overrides,
    },
    riskFlags: [],
    note: 'Only explicit listing evidence was used.',
  }
}

test('requests GPT-5.6 Luna structured extraction at medium effort without storage', async () => {
  let captured: Record<string, unknown> | null = null
  const expected = extraction({ cpuModel: claim('Intel Core i9-14900HX', 'i9-14900HX') })
  const client: AiResponsesClient = {
    responses: {
      parse: async (request) => {
        captured = request
        return { id: 'resp_test', output_parsed: expected, usage: { input_tokens: 120, output_tokens: 30, total_tokens: 150 } }
      },
    },
  }
  const row = enrichListing({
    sourceListingId: 'one',
    title: 'ASUS laptop with i9-14900HX',
    description: 'NVIDIA GeForce RTX 4070 Laptop GPU',
    conditionDescription: 'The lid has one small scratch.',
    localizedAspects: [{ name: 'RAM Size', value: '64 GB' }],
    price: 1000,
    shippingPrice: 0,
  })

  const result = await requestListingEnrichment(client, row)

  assert.equal(captured?.model, 'gpt-5.6-luna')
  assert.deepEqual(captured?.reasoning, { effort: 'medium' })
  assert.equal(captured?.store, false)
  assert.ok((captured?.input as unknown[]).length >= 2)
  const userInput = ((captured?.input as Array<{ content: string }>)[1]?.content ?? '')
  assert.match(userInput, /one small scratch/)
  assert.match(userInput, /RAM Size/)
  assert.match(userInput, /deterministic/i)
  assert.equal(result.responseId, 'resp_test')
  assert.equal(result.extraction.fields.cpuModel.value, 'Intel Core i9-14900HX')
})

test('rejects claims whose evidence is absent from the supplied listing', () => {
  const row = enrichListing({
    sourceListingId: 'two',
    title: 'ASUS creator laptop',
    description: 'Includes 64 GB RAM and 2 TB SSD.',
    price: 1000,
    shippingPrice: 0,
  })
  const result = validateAiEvidence(row, extraction({
    ramGb: claim(64, '64 GB RAM'),
    storageGb: claim(2048, '4 TB SSD'),
  }))

  assert.equal(result.accepted.fields.ramGb.value, 64)
  assert.equal(result.accepted.fields.storageGb.value, null)
  assert.deepEqual(result.rejected, ['storageGb: evidence not found'])
})

test('fills missing catalog-backed hardware and recalculates deterministic power', () => {
  const row = enrichListing({
    sourceListingId: 'three',
    title: 'ASUS professional laptop',
    description: "Processor is Intel's 14900 HX. Graphics are GeForce forty-seventy laptop. Memory is sixty-four gigabytes and storage is two terabytes SSD.",
    price: 1000,
    shippingPrice: 0,
    returnTerms: { returnsAccepted: true },
  })
  assert.equal(row.combinedPower, null)

  const validated = validateAiEvidence(row, extraction({
    cpuModel: claim('Intel Core i9-14900HX', '14900 HX'),
    gpuModel: claim('NVIDIA GeForce RTX 4070 Laptop GPU', 'GeForce forty-seventy laptop'),
    ramGb: claim(64, 'sixty-four gigabytes'),
    storageGb: claim(2048, 'two terabytes SSD'),
  }))
  const merged = mergeAiEnrichment(row, validated)

  assert.equal(merged.cpuModel, 'Intel Core i9-14900HX')
  assert.equal(merged.gpuModel, 'NVIDIA GeForce RTX 4070 Laptop GPU')
  assert.equal(merged.ramGb, 64)
  assert.equal(merged.storageGb, 2048)
  assert.ok((merged.combinedPower ?? 0) > 100)
  assert.equal(merged.provenance.cpuModel, 'ai')
  assert.ok(merged.aiEnrichment?.acceptedClaims.some((entry) => entry.field === 'cpuModel' && entry.evidence === '14900 HX'))
})

test('does not overwrite deterministic fields when AI conflicts', () => {
  const row = enrichListing({
    sourceListingId: 'four',
    title: 'ASUS i9-14900HX RTX 4060 64GB RAM 1TB SSD',
    description: 'The description also mentions an older RTX 4070 option.',
    price: 1000,
    shippingPrice: 0,
  })
  const validated = validateAiEvidence(row, extraction({
    gpuModel: claim('NVIDIA GeForce RTX 4070 Laptop GPU', 'RTX 4070'),
  }))
  const merged = mergeAiEnrichment(row, validated)

  assert.equal(merged.gpuModel, 'NVIDIA GeForce RTX 4060 Laptop GPU')
  assert.match(merged.warnings.join(' '), /AI conflict.*gpuModel/i)
})

test('AI-evidenced risks deterministically reduce the recommendation score', () => {
  const row = enrichListing({
    sourceListingId: 'five',
    title: 'ASUS i9-14900HX RTX 4060 64GB RAM 1TB SSD',
    description: 'Seller states that the battery only lasts ten minutes.',
    price: 1000,
    shippingPrice: 0,
    sellerFeedbackPercent: 100,
    sellerFeedbackScore: 1000,
    returnTerms: { returnsAccepted: true },
  })
  const validated = validateAiEvidence(row, {
    ...extraction(),
    riskFlags: [{ label: 'battery failure', evidence: 'battery only lasts ten minutes' }],
  })
  const merged = mergeAiEnrichment(row, validated)

  assert.ok(merged.riskFlags.includes('battery failure'))
  assert.ok(merged.recommendationScore < row.recommendationScore)
})

test('applies evidence-backed VRAM and RAM upgradeability claims explicitly', () => {
  const row = enrichListing({
    sourceListingId: 'six',
    title: 'Creator laptop with 12 GB VRAM',
    description: 'Two SODIMM slots make the RAM upgradeable.',
    price: 900,
    shippingPrice: 0,
  })
  const validated = validateAiEvidence(row, extraction({
    vramGb: claim(12, '12 GB VRAM'),
    ramUpgradeable: claim(true, 'RAM upgradeable'),
  }))

  const merged = mergeAiEnrichment(row, validated)

  assert.equal(merged.vramGb, 12)
  assert.equal(merged.ramUpgradeable, true)
  assert.equal(merged.provenance.vramGb, 'ai')
  assert.equal(merged.provenance.ramUpgradeable, 'ai')
  assert.equal(merged.aiEnrichment?.acceptedClaims.find((item) => item.field === 'vramGb')?.applied, true)
  assert.equal(merged.aiEnrichment?.acceptedClaims.find((item) => item.field === 'ramUpgradeable')?.applied, true)

  const replayed = mergeAiEnrichment(merged, validated)
  assert.equal(replayed.provenance.vramGb, 'ai')
  assert.equal(replayed.provenance.ramUpgradeable, 'ai')
  assert.equal(replayed.aiEnrichment?.acceptedClaims.find((item) => item.field === 'vramGb')?.applied, true)
})
