import 'dotenv/config'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import OpenAI from 'openai'

const defaultEvidence = 'G:\\My Drive\\resale-arbitrage\\lens-packs\\canon-ef-50mm-f-1-8-stm\\evidence-cards.json'

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}

function chunk(values, size) {
  const chunks = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

const schema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    assessments: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sourceListingId: { type: 'string' },
          packIndex: { type: 'number' },
          decision: { type: 'string', enum: ['candidate', 'review', 'avoid', 'exclude'] },
          expertIdentity: {
            type: 'object',
            additionalProperties: false,
            properties: {
              isTargetLens: { type: 'boolean' },
              brand: { type: 'string' },
              model: { type: 'string' },
              mount: { type: 'string' },
              versionNotes: { type: 'string' },
            },
            required: ['isTargetLens', 'brand', 'model', 'mount', 'versionNotes'],
          },
          conditionGrade: { type: 'string', enum: ['new_open_box', 'excellent', 'good', 'acceptable', 'faulty_parts', 'unknown'] },
          valueMultiplier: { type: 'number' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          reasons: { type: 'array', items: { type: 'string' } },
          positiveSignals: { type: 'array', items: { type: 'string' } },
          riskFlags: { type: 'array', items: { type: 'string' } },
          verifyBeforeBuying: { type: 'array', items: { type: 'string' } },
          imageReviewNeeded: { type: 'boolean' },
          shortRecommendation: { type: 'string' },
        },
        required: [
          'sourceListingId',
          'packIndex',
          'decision',
          'expertIdentity',
          'conditionGrade',
          'valueMultiplier',
          'confidence',
          'reasons',
          'positiveSignals',
          'riskFlags',
          'verifyBeforeBuying',
          'imageReviewNeeded',
          'shortRecommendation',
        ],
      },
    },
  },
  required: ['assessments'],
}

async function assessBatch(client, model, searchTerm, cards) {
  const response = await client.responses.create({
    model,
    input: [
      {
        role: 'system',
        content:
          'You are a camera-lens resale expert. Review each listing as a human buyer would. Use all supplied evidence. Do not rely on generic keyword matching. Distinguish exact lens/version/mount, accessories, bundles, condition, seller risk, missing accessories, and whether photos need review. Pricing must remain sold-comps based; your job is identity, risk, condition, and value adjustment.',
      },
      {
        role: 'user',
        content: JSON.stringify({
          targetLens: searchTerm,
          instructions: [
            'Assess every listing independently.',
            'If full detail is needed, reference fullDetailReference; do not assume compact data is all that exists.',
            'valueMultiplier is how much of normal sold-comp value this listing deserves before fees: exclude=0, faulty/parts low, missing rear cap lower, excellent/boxed slightly higher.',
            'Set imageReviewNeeded true when text is insufficient or photos must verify model/glass/accessories.',
          ],
          listings: cards,
        }),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'lens_expert_batch_assessment',
        strict: true,
        schema,
      },
    },
  })
  return JSON.parse(response.output_text).assessments
}

async function main() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY in .env for gpt-5.4-mini assessment.')
  const evidencePath = argValue('--evidence', defaultEvidence)
  const model = argValue('--model', process.env.OPENAI_ASSESSMENT_MODEL || 'gpt-5.4-mini')
  const batchSize = Number(argValue('--batch-size', '5'))
  const limit = Number(argValue('--limit', '0'))
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
  const cards = limit > 0 ? evidence.cards.slice(0, limit) : evidence.cards
  const client = new OpenAI()
  const all = []

  for (const [batchIndex, batch] of chunk(cards, batchSize).entries()) {
    console.log(`Assessing batch ${batchIndex + 1}: ${batch.length} listings with ${model}`)
    all.push(...(await assessBatch(client, model, evidence.searchTerm, batch)))
  }

  const output = {
    generatedAt: new Date().toISOString(),
    method: 'gpt-mini-expert-assessment',
    model,
    searchTerm: evidence.searchTerm,
    evidencePath,
    count: all.length,
    assessments: all,
  }
  const outPath = path.join(path.dirname(evidencePath), 'gpt-mini-assessments.json')
  await mkdir(path.dirname(outPath), { recursive: true })
  await writeFile(outPath, JSON.stringify(output, null, 2))
  await writeFile(path.join(process.cwd(), 'public', 'data', 'family-assessments.json'), JSON.stringify(output, null, 2))
  console.log(`Saved ${all.length} assessments to ${outPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
