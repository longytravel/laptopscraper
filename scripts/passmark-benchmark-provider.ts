import {
  benchmarkKey,
  isFresh,
  type BenchmarkEvidenceStore,
  type BenchmarkKind,
} from '../src/laptop/benchmark-evidence'

export interface HardwareModel {
  kind: BenchmarkKind
  canonical: string
  sourceUrl: string
}

export interface RefreshOptions {
  now?: Date
  maxAgeDays?: number
  fetchImpl?: typeof fetch
}

export function visibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function numbersBetween(text: string, start: RegExp, end?: RegExp): number[] {
  const startMatch = start.exec(text)
  if (!startMatch) return []
  const remainder = text.slice(startMatch.index + startMatch[0].length)
  const endMatch = end?.exec(remainder)
  const section = endMatch ? remainder.slice(0, endMatch.index) : remainder
  return [...section.matchAll(/\b\d[\d,]*\b/g)].map((match) => Number(match[0].replaceAll(',', '')))
}

export function parsePassmarkCpuPage(html: string): { multiCoreScore: number; singleThreadScore: number; sampleCount: number } {
  const text = visibleText(html)
  const multi = numbersBetween(text, /Multithread Rating/i, /Single Thread Rating/i)[0]
  const single = numbersBetween(text, /Single Thread Rating/i, /Samples:/i)[0]
  const samples = numbersBetween(text, /Samples:/i)[0]
  if (![multi, single, samples].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('PassMark CPU metrics were not found')
  }
  return { multiCoreScore: multi, singleThreadScore: single, sampleCount: samples }
}

export function parsePassmarkGpuPage(html: string, target = -1): { graphicsScore: number; sampleCount: number | null } {
  if (target > 100) {
    const row = new RegExp(`<li\\b[^>]*\\bid=["']rk${target}["'][^>]*>[\\s\\S]*?<\\/li>`, 'i').exec(html)?.[0]
    const metrics = row?.match(/onclick=["']x\(\s*event\s*,\s*\d+\s*,\s*(\d+)\s*,\s*\d+\s*,\s*(\d+)/i)
    const graphicsScore = Number(metrics?.[1])
    const sampleCount = Number(metrics?.[2])
    if (Number.isFinite(graphicsScore) && graphicsScore > 0) {
      return {
        graphicsScore,
        sampleCount: Number.isFinite(sampleCount) && sampleCount > 0 ? sampleCount : null,
      }
    }
  }

  const text = visibleText(html)
  const samples = numbersBetween(text, /# of Samples/i, /G3D Rating/i)
  const ratings = numbersBetween(text, /G3D Rating/i)
  const index = target < 0 || target > 100 ? ratings.length - 1 : target
  const graphicsScore = ratings[index]
  const sampleCount = samples[index] ?? null
  if (!Number.isFinite(graphicsScore) || graphicsScore <= 0) throw new Error('PassMark GPU metrics were not found')
  return { graphicsScore, sampleCount }
}

function failureMessage(reason: unknown): string {
  if (reason instanceof Error && /^PassMark\b/.test(reason.message)) return reason.message
  if (reason instanceof Error && /^HTTP \d+/.test(reason.message)) return reason.message
  return 'Benchmark refresh failed'
}

async function fetchText(fetchImpl: typeof fetch, sourceUrl: string): Promise<string> {
  const response = await fetchImpl(sourceUrl, {
    headers: { 'user-agent': 'LaptopBestBuyEvidence/1.0' },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} while refreshing benchmark`)
  return response.text()
}

function gpuTargetId(sourceUrl: string): number {
  try {
    return Number(new URL(sourceUrl).searchParams.get('id') ?? -1)
  } catch {
    return -1
  }
}

export async function refreshBenchmarkEvidence(
  models: HardwareModel[],
  store: BenchmarkEvidenceStore,
  options: RefreshOptions = {},
): Promise<BenchmarkEvidenceStore> {
  const now = options.now ?? new Date()
  const maxAgeDays = options.maxAgeDays ?? 7
  const fetchImpl = options.fetchImpl ?? fetch
  const distinct = new Map(models.map((model) => [benchmarkKey(model.kind, model.canonical), model]))
  const records = { ...store.records }

  for (const [key, model] of distinct) {
    const previous = records[key]
    if (previous && isFresh(previous, now, maxAgeDays)) continue

    try {
      const html = await fetchText(fetchImpl, model.sourceUrl)
      const metrics = model.kind === 'cpu'
        ? parsePassmarkCpuPage(html)
        : parsePassmarkGpuPage(html, gpuTargetId(model.sourceUrl))
      records[key] = {
        kind: model.kind,
        canonical: model.canonical,
        ...metrics,
        sourceName: 'PassMark',
        sourceUrl: model.sourceUrl,
        observedAt: now.toISOString().slice(0, 10),
        retrievedAt: now.toISOString(),
        sampleCount: metrics.sampleCount,
        status: 'validated',
        providerVersion: 'passmark-html-v1',
      }
    } catch (error) {
      records[key] = previous ? {
        ...previous,
        status: 'stale',
        lastError: failureMessage(error),
      } : {
        kind: model.kind,
        canonical: model.canonical,
        sourceName: 'PassMark',
        sourceUrl: model.sourceUrl,
        observedAt: now.toISOString().slice(0, 10),
        retrievedAt: now.toISOString(),
        sampleCount: null,
        status: 'failed',
        providerVersion: 'passmark-html-v1',
        lastError: failureMessage(error),
      }
    }
  }

  return { schemaVersion: 1, refreshedAt: now.toISOString(), records }
}
