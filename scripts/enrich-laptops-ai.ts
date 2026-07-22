import 'dotenv/config'

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import OpenAI from 'openai'

import { AI_MODEL, AI_PROMPT_VERSION, type AiResponsesClient } from '../src/laptop/ai-enrichment'
import { runAiEnrichment, type AiEnrichmentCache } from '../src/laptop/ai-pipeline'
import type { LaptopDataset } from '../src/laptop/types'

const DATA_PATH = path.resolve('public/data/laptop-listings.json')
const CACHE_PATH = path.resolve('.cache/laptop-ai-enrichment.json')

async function readCache(): Promise<AiEnrichmentCache> {
  try {
    const parsed = JSON.parse(await readFile(CACHE_PATH, 'utf8')) as AiEnrichmentCache
    return parsed.version === 1 && parsed.entries ? parsed : { version: 1, entries: {} }
  } catch {
    return { version: 1, entries: {} }
  }
}

async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(temporary, target)
}

export async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY?.trim()
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for npm run enrich:laptops:ai; no files were changed.')

  const dataset = JSON.parse(await readFile(DATA_PATH, 'utf8')) as LaptopDataset
  const cache = await readCache()
  const client = new OpenAI({ apiKey }) as unknown as AiResponsesClient
  console.log(`Enriching ${dataset.listings.length} listings with ${AI_MODEL} (${AI_PROMPT_VERSION}, medium effort).`)

  const result = await runAiEnrichment(dataset, client, cache, {
    concurrency: 4,
    retries: 3,
    onCheckpoint: (nextCache) => writeJsonAtomic(CACHE_PATH, nextCache),
    onProgress: (completed, total, stats) => {
      if (completed === total || completed % 10 === 0) {
        console.log(`${completed}/${total} · API ${stats.succeeded}/${stats.requested} · cache ${stats.cached} · failed ${stats.failed}`)
      }
    },
  })

  await writeJsonAtomic(DATA_PATH, result.dataset)
  const inputPricePerMillion = Number(process.env.LUNA_INPUT_PRICE_PER_MILLION ?? 1)
  const outputPricePerMillion = Number(process.env.LUNA_OUTPUT_PRICE_PER_MILLION ?? 6)
  const estimatedCost = result.stats.inputTokens * inputPricePerMillion / 1_000_000
    + result.stats.outputTokens * outputPricePerMillion / 1_000_000
  console.log(`AI enrichment complete: requested ${result.stats.requested}, cached ${result.stats.cached}, succeeded ${result.stats.succeeded}, failed ${result.stats.failed}, materially improved ${result.stats.merged}.`)
  console.log(`Usage: ${result.stats.inputTokens} input + ${result.stats.outputTokens} output tokens. Estimated cost: $${estimatedCost.toFixed(4)} at configured rates ($${inputPricePerMillion}/M input, $${outputPricePerMillion}/M output; defaults checked 2026-07-22).`)

  if (result.failures.length) {
    for (const failure of result.failures.slice(0, 20)) console.error(`${failure.id}: ${failure.error}`)
    process.exitCode = 1
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (entryPath && fileURLToPath(import.meta.url) === entryPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
