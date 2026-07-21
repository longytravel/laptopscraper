export const BENCHMARK_VERSION = '2026-07-passmark-class-index-v2'

export interface BenchmarkSource {
  name: string
  url: string
  observedAt: string
  metric: string
  method: string
}

export interface BenchmarkEntry {
  canonical: string
  patterns: RegExp[]
  score: number
  manufacturer: string
  family?: string
  vramGb?: number
  source: BenchmarkSource
}

type BenchmarkSeed = Omit<BenchmarkEntry, 'source'>

const CPU_SOURCE: BenchmarkSource = {
  name: 'PassMark CPU Mark',
  url: 'https://www.cpubenchmark.net/cpu.php?cpu=Intel+Core+i9-14900HX&id=5867',
  observedAt: '2026-07-21',
  metric: 'CPU Mark representative model index',
  method: 'Model-level catalog snapshot; rounded class estimates are used where direct samples are sparse.',
}

const GPU_SOURCE: BenchmarkSource = {
  name: 'PassMark G3D Mark',
  url: 'https://www.videocardbenchmark.net/',
  observedAt: '2026-07-21',
  metric: 'G3D Mark representative laptop-GPU class index',
  method: 'Model-level laptop-GPU catalog snapshot; real performance varies with TGP and cooling.',
}

// CPU Mark representative results, normalized in the engine against the
// i9-14900HX snapshot (43,881). Laptop cooling and power limits can move real
// performance materially, so the UI labels these as model-level estimates.
const CPU_SEEDS: BenchmarkSeed[] = [
  { canonical: 'Intel Core Ultra 9 285HX', patterns: [/\b(?:core\s*)?ultra\s*9\s*285hx\b/i], score: 59400, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 9 285H', patterns: [/\b(?:core\s*)?ultra\s*9\s*285h\b/i], score: 38500, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 9 275HX', patterns: [/\b(?:core\s*)?ultra\s*9\s*275hx\b/i], score: 54800, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 7 255HX', patterns: [/\b(?:core\s*)?ultra\s*7\s*255hx\b/i], score: 48000, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 7 265HX', patterns: [/\b(?:core\s*)?ultra\s*7\s*265hx\b/i], score: 52000, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 7 255H', patterns: [/\b(?:core\s*)?ultra\s*7\s*255h\b/i], score: 34000, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 7 155H', patterns: [/\b(?:core\s*)?ultra\s*7\s*155h\b/i], score: 25000, manufacturer: 'Intel' },
  { canonical: 'Intel Core i9-14900HX', patterns: [/\b(?:intel\s*)?(?:core\s*)?i9[-\s]?14900hx\b/i], score: 43881, manufacturer: 'Intel' },
  { canonical: 'Intel Core i9-13980HX', patterns: [/\bi9[-\s]?13980hx\b/i], score: 46800, manufacturer: 'Intel' },
  { canonical: 'Intel Core i9-13950HX', patterns: [/\bi9[-\s]?13950hx\b/i], score: 45500, manufacturer: 'Intel' },
  { canonical: 'Intel Core i9-13900HX', patterns: [/\bi9[-\s]?13900hx\b/i], score: 45000, manufacturer: 'Intel' },
  { canonical: 'Intel Core i7-14700HX', patterns: [/\bi7[-\s]?14700hx\b/i], score: 37000, manufacturer: 'Intel' },
  { canonical: 'Intel Core i7-14650HX', patterns: [/\bi7[-\s]?14650hx\b/i], score: 33000, manufacturer: 'Intel' },
  { canonical: 'Intel Core i7-13700HX', patterns: [/\bi7[-\s]?13700hx\b/i], score: 31000, manufacturer: 'Intel' },
  { canonical: 'Intel Core i7-13650HX', patterns: [/\bi7[-\s]?13650hx\b/i], score: 30500, manufacturer: 'Intel' },
  { canonical: 'Intel Core i7-13700H', patterns: [/\bi7[-\s]?13700h\b/i], score: 28000, manufacturer: 'Intel' },
  { canonical: 'Intel Core i9-13900H', patterns: [/\bi9[-\s]?13900h\b/i], score: 29000, manufacturer: 'Intel' },
  { canonical: 'Intel Core i9-12900HX', patterns: [/\bi9[-\s]?12900hx\b/i], score: 34000, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 9 185H', patterns: [/\b(?:core\s*)?ultra\s*9\s*185h\b/i], score: 29200, manufacturer: 'Intel' },
  { canonical: 'AMD Ryzen 9 9955HX3D', patterns: [/\bryzen\s*9\s*9955hx3d\b/i], score: 67500, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 9955HX', patterns: [/\bryzen\s*9\s*9955hx\b/i], score: 65500, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 7945HX3D', patterns: [/\bryzen\s*9\s*7945hx3d\b/i], score: 56000, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 7945HX', patterns: [/\bryzen\s*9\s*7945hx\b/i], score: 54500, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 8940HX', patterns: [/\bryzen\s*9\s*8940hx\b/i], score: 51000, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 8945H', patterns: [/\bryzen\s*9\s*8945h\b/i], score: 31000, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 7940HS', patterns: [/\bryzen\s*9\s*7940hs\b/i], score: 30000, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 7845HX', patterns: [/\bryzen\s*9\s*7845hx\b/i], score: 47000, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen AI Max+ 395', patterns: [/\bryzen\s*ai\s*max\+?\s*395\b/i], score: 58500, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen AI 9 HX 370', patterns: [/\bryzen\s*ai\s*9\s*hx\s*370\b/i], score: 35000, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen AI 9 HX 375', patterns: [/\bryzen\s*ai\s*9\s*hx\s*375\b/i], score: 36500, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen AI 9 365', patterns: [/\bryzen\s*ai\s*9\s*365\b/i], score: 33000, manufacturer: 'AMD' },
]

export const CPU_BENCHMARKS: BenchmarkEntry[] = CPU_SEEDS.map((entry) => ({ ...entry, source: CPU_SOURCE }))

// G3D-style representative class indices. The GPU name alone does not encode
// laptop TGP, so the UI keeps a visible model-estimate caveat.
const GPU_SEEDS: BenchmarkSeed[] = [
  { canonical: 'NVIDIA GeForce RTX 5090 Laptop GPU', patterns: [/\brtx\s*5090\b/i], score: 35000, manufacturer: 'NVIDIA', family: 'RTX 50 series', vramGb: 24 },
  { canonical: 'NVIDIA GeForce RTX 5080 Laptop GPU', patterns: [/\brtx\s*5080\b/i], score: 31500, manufacturer: 'NVIDIA', family: 'RTX 50 series', vramGb: 16 },
  { canonical: 'NVIDIA GeForce RTX 5070 Ti Laptop GPU', patterns: [/\brtx\s*5070\s*ti\b/i], score: 27000, manufacturer: 'NVIDIA', family: 'RTX 50 series', vramGb: 12 },
  { canonical: 'NVIDIA GeForce RTX 5070 Laptop GPU', patterns: [/\brtx\s*5070\b/i], score: 22500, manufacturer: 'NVIDIA', family: 'RTX 50 series', vramGb: 8 },
  { canonical: 'NVIDIA GeForce RTX 5060 Laptop GPU', patterns: [/\brtx\s*5060\b/i], score: 19500, manufacturer: 'NVIDIA', family: 'RTX 50 series', vramGb: 8 },
  { canonical: 'NVIDIA GeForce RTX 4090 Laptop GPU', patterns: [/\brtx\s*4090\b/i], score: 28500, manufacturer: 'NVIDIA', family: 'RTX 40 series', vramGb: 16 },
  { canonical: 'NVIDIA GeForce RTX 4080 Laptop GPU', patterns: [/\brtx\s*4080\b/i], score: 25500, manufacturer: 'NVIDIA', family: 'RTX 40 series', vramGb: 12 },
  { canonical: 'NVIDIA GeForce RTX 4070 Laptop GPU', patterns: [/\brtx\s*4070\b/i], score: 20500, manufacturer: 'NVIDIA', family: 'RTX 40 series', vramGb: 8 },
  { canonical: 'NVIDIA GeForce RTX 4060 Laptop GPU', patterns: [/\brtx\s*4060\b/i], score: 17500, manufacturer: 'NVIDIA', family: 'RTX 40 series', vramGb: 8 },
  { canonical: 'NVIDIA RTX 5000 Ada Laptop GPU', patterns: [/\brtx\s*5000\s*ada\b/i], score: 26000, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 16 },
  { canonical: 'NVIDIA RTX 4000 Ada Laptop GPU', patterns: [/\brtx\s*4000\s*ada\b/i], score: 22500, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 12 },
]

export const GPU_BENCHMARKS: BenchmarkEntry[] = GPU_SEEDS.map((entry) => ({ ...entry, source: GPU_SOURCE }))

export const CPU_BASELINE = CPU_BENCHMARKS.find((entry) => entry.canonical === 'Intel Core i9-14900HX')!.score
export const GPU_BASELINE = GPU_BENCHMARKS.find((entry) => entry.canonical === 'NVIDIA GeForce RTX 4060 Laptop GPU')!.score

export function matchBenchmark(text: string, catalog: BenchmarkEntry[]): BenchmarkEntry | null {
  return catalog.find((entry) => entry.patterns.some((pattern) => pattern.test(text))) ?? null
}
