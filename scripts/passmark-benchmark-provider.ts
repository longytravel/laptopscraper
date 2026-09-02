import {
  benchmarkKey,
  CURRENT_PROVIDER_VERSION,
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

const CPU_SITE = 'https://www.cpubenchmark.net/'
const CPU_LOOKUP_URL = `${CPU_SITE}cpu_lookup.php`

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

/**
 * Collapses a CPU name to the part that identifies the chip. Vendor and
 * marketing words go, as does punctuation, but the model suffix stays intact:
 * "285H" and "285HX" are different processors, as are "Max 390" and "Max+ 395".
 */
export function normalizeCpuName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[®™]/g, '')
    .replace(/\b(?:intel|amd|core|processor|cpu)\b/g, '')
    .replace(/[^a-z0-9+]/g, '')
}

/** The chip a PassMark CPU page is actually about, or null when the markup carries no name. */
export function parsePassmarkCpuName(html: string): string | null {
  const span = /<span[^>]*\bclass=["'][^"']*\bcpuname\b[^"']*["'][^>]*>([^<]+)/i.exec(html)?.[1]
  const heading = /<h1[^>]*>([^<]+)<\/h1>/i.exec(html)?.[1]
  const title = /<title[^>]*>([^<]*?)\s+Benchmark\b[^<]*<\/title>/i.exec(html)?.[1]
  const raw = span ?? heading ?? title
  const name = raw ? visibleText(raw) : ''
  return name || null
}

export function parsePassmarkCpuPage(html: string): { cpuName: string | null; multiCoreScore: number; singleThreadScore: number; sampleCount: number } {
  const text = visibleText(html)
  const multi = numbersBetween(text, /Multithread Rating/i, /Single Thread Rating/i)[0]
  const single = numbersBetween(text, /Single Thread Rating/i, /Samples:/i)[0]
  const samples = numbersBetween(text, /Samples:/i)[0]
  if (![multi, single, samples].every((value) => Number.isFinite(value) && value > 0)) {
    throw new Error('PassMark CPU metrics were not found')
  }
  return { cpuName: parsePassmarkCpuName(html), multiCoreScore: multi, singleThreadScore: single, sampleCount: samples }
}

/**
 * The exact-model page link from PassMark's lookup catalogue. The catalogue
 * links every chip as cpu.php?cpu=<name>&id=<n>, and the id pins the page in a
 * way the name search does not.
 */
export function findPassmarkCpuLink(lookupHtml: string, canonical: string): string | null {
  const target = normalizeCpuName(canonical)
  for (const match of lookupHtml.matchAll(/href=["']([^"']*cpu\.php\?cpu=([^"'&]+)&(?:amp;)?id=\d+)["']/gi)) {
    let name: string
    try {
      name = decodeURIComponent(match[2].replace(/\+/g, ' '))
    } catch {
      continue
    }
    if (normalizeCpuName(name) === target) return new URL(match[1].replace(/&amp;/g, '&'), CPU_SITE).toString()
  }
  return null
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
    // The id pins one GPU. Falling through to "the last rating on the page"
    // would silently score the listing with whatever card PassMark happened to
    // print last, so a missing row is a failure, not a guess.
    throw new Error(`PassMark GPU page has no row for id ${target}`)
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

interface CpuEvidence {
  multiCoreScore: number
  singleThreadScore: number
  sampleCount: number
  sourceUrl: string
  verifiedName: string
}

/**
 * PassMark's name search is a nearest-match, not an exact one: asking for the
 * Ultra 9 285H returns the 285HX page and asking for the Ryzen 9 9955HX returns
 * the 9955HX3D page, each with the wrong chip's scores. Every page is therefore
 * checked against the chip it names, and a mismatch is resolved through the
 * lookup catalogue's id-pinned link or rejected outright.
 */
async function fetchCpuEvidence(
  model: HardwareModel,
  fetchImpl: typeof fetch,
  lookupCatalogue: () => Promise<string>,
): Promise<CpuEvidence> {
  const expected = normalizeCpuName(model.canonical)
  let sourceUrl = model.sourceUrl
  let page = parsePassmarkCpuPage(await fetchText(fetchImpl, sourceUrl))
  if (!page.cpuName) throw new Error('PassMark CPU page did not name its processor')

  if (normalizeCpuName(page.cpuName) !== expected) {
    const nearest = page.cpuName
    const exact = findPassmarkCpuLink(await lookupCatalogue(), model.canonical)
    if (!exact) throw new Error(`PassMark has no exact page for ${model.canonical}; the name search returned ${nearest}`)
    sourceUrl = exact
    page = parsePassmarkCpuPage(await fetchText(fetchImpl, sourceUrl))
    if (!page.cpuName || normalizeCpuName(page.cpuName) !== expected) {
      throw new Error(`PassMark returned ${page.cpuName ?? 'an unnamed page'} instead of ${model.canonical}`)
    }
  }

  return {
    multiCoreScore: page.multiCoreScore,
    singleThreadScore: page.singleThreadScore,
    sampleCount: page.sampleCount,
    sourceUrl,
    verifiedName: page.cpuName,
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

  // The lookup catalogue lists every chip PassMark knows, so one fetch serves
  // every mismatch in the run. It answers 404 to a nonsense query, hence the
  // real model name in the request.
  let catalogue: Promise<string> | null = null
  const lookupCatalogue = (canonical: string) => {
    catalogue ??= fetchText(fetchImpl, `${CPU_LOOKUP_URL}?cpu=${encodeURIComponent(canonical)}`)
    return catalogue
  }

  for (const [key, model] of distinct) {
    const previous = records[key]
    if (previous && isFresh(previous, now, maxAgeDays)) continue

    try {
      if (model.kind === 'cpu') {
        const evidence = await fetchCpuEvidence(model, fetchImpl, () => lookupCatalogue(model.canonical))
        records[key] = {
          kind: 'cpu',
          canonical: model.canonical,
          multiCoreScore: evidence.multiCoreScore,
          singleThreadScore: evidence.singleThreadScore,
          sourceName: 'PassMark',
          sourceUrl: evidence.sourceUrl,
          verifiedName: evidence.verifiedName,
          observedAt: now.toISOString().slice(0, 10),
          retrievedAt: now.toISOString(),
          sampleCount: evidence.sampleCount,
          status: 'validated',
          providerVersion: CURRENT_PROVIDER_VERSION,
        }
      } else {
        const html = await fetchText(fetchImpl, model.sourceUrl)
        const metrics = parsePassmarkGpuPage(html, gpuTargetId(model.sourceUrl))
        records[key] = {
          kind: 'gpu',
          canonical: model.canonical,
          graphicsScore: metrics.graphicsScore,
          sourceName: 'PassMark',
          sourceUrl: model.sourceUrl,
          observedAt: now.toISOString().slice(0, 10),
          retrievedAt: now.toISOString(),
          sampleCount: metrics.sampleCount,
          status: 'validated',
          providerVersion: CURRENT_PROVIDER_VERSION,
        }
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
        providerVersion: CURRENT_PROVIDER_VERSION,
        lastError: failureMessage(error),
      }
    }
  }

  return { schemaVersion: 1, refreshedAt: now.toISOString(), records }
}
