export const BENCHMARK_VERSION = '2026-09-passmark-class-index-v5'

export interface BenchmarkSource {
  name: string
  url: string
  observedAt: string
  metric: string
  method: string
  derived: boolean
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

const CPU_SOURCE: Omit<BenchmarkSource, 'url'> = {
  name: 'PassMark CPU Mark',
  observedAt: '2026-09-02',
  metric: 'CPU Mark representative model index',
  method: 'Model-level catalog snapshot cross-checked against the PassMark laptop chart on 2026-09-02.',
  derived: true,
}

const GPU_SOURCE: Omit<BenchmarkSource, 'url'> = {
  name: 'PassMark G3D Mark',
  observedAt: '2026-09-02',
  metric: 'G3D Mark representative laptop-GPU class index',
  method: 'Model-level laptop-GPU catalog snapshot; real performance varies with TGP and cooling.',
  derived: true,
}

function cpuSourceUrl(model: string): string {
  return `https://www.cpubenchmark.net/cpu.php?cpu=${encodeURIComponent(model)}`
}

// PassMark's numeric ids pin the exact GPU page; the name alone is ambiguous
// between desktop and laptop parts and between adjacent tiers.
const PASSMARK_GPU_IDS: Record<string, { name: string; id: number }> = {
  'NVIDIA GeForce RTX 5090 Laptop GPU': { name: 'GeForce RTX 5090 Laptop GPU', id: 5754 },
  'NVIDIA GeForce RTX 5080 Laptop GPU': { name: 'GeForce RTX 5080 Laptop GPU', id: 6099 },
  'NVIDIA GeForce RTX 5070 Ti Laptop GPU': { name: 'GeForce RTX 5070 Ti Laptop GPU', id: 6216 },
  'NVIDIA GeForce RTX 5070 Laptop GPU': { name: 'GeForce RTX 5070 Laptop GPU', id: 6260 },
  'NVIDIA GeForce RTX 5060 Laptop GPU': { name: 'GeForce RTX 5060 Laptop GPU', id: 6330 },
  'NVIDIA GeForce RTX 4090 Laptop GPU': { name: 'GeForce RTX 4090 Laptop GPU', id: 4737 },
  'NVIDIA GeForce RTX 4080 Laptop GPU': { name: 'GeForce RTX 4080 Laptop GPU', id: 4736 },
  'NVIDIA GeForce RTX 4070 Laptop GPU': { name: 'GeForce RTX 4070 Laptop GPU', id: 4756 },
  'NVIDIA GeForce RTX 4060 Laptop GPU': { name: 'GeForce RTX 4060 Laptop GPU', id: 4752 },
  'NVIDIA GeForce RTX 3080 Ti Laptop GPU': { name: 'GeForce RTX 3080 Ti Laptop GPU', id: 4491 },
  'NVIDIA GeForce RTX 3080 Laptop GPU': { name: 'GeForce RTX 3080 Laptop GPU', id: 4332 },
  'NVIDIA GeForce RTX 3070 Ti Laptop GPU': { name: 'GeForce RTX 3070 Ti Laptop GPU', id: 4497 },
  'NVIDIA RTX PRO 5000 Blackwell Laptop GPU': { name: 'RTX PRO 5000 Blackwell Generation Laptop GPU', id: 6785 },
  'NVIDIA RTX PRO 4000 Blackwell Laptop GPU': { name: 'RTX PRO 4000 Blackwell Generation Laptop GPU', id: 6530 },
  'NVIDIA RTX PRO 3000 Blackwell Laptop GPU': { name: 'RTX PRO 3000 Blackwell Generation Laptop GPU', id: 6377 },
  'NVIDIA RTX PRO 2000 Blackwell Laptop GPU': { name: 'RTX PRO 2000 Blackwell Generation Laptop GPU', id: 6259 },
  'NVIDIA RTX 5000 Ada Laptop GPU': { name: 'RTX 5000 Ada Generation Laptop GPU', id: 4807 },
  'NVIDIA RTX 4000 Ada Laptop GPU': { name: 'RTX 4000 Ada Generation Laptop GPU', id: 4819 },
  'NVIDIA RTX 3500 Ada Laptop GPU': { name: 'RTX 3500 Ada Generation Laptop GPU', id: 4800 },
  'NVIDIA RTX 3000 Ada Laptop GPU': { name: 'RTX 3000 Ada Generation Laptop GPU', id: 4930 },
  'NVIDIA RTX 2000 Ada Laptop GPU': { name: 'RTX 2000 Ada Generation Laptop GPU', id: 4785 },
  'NVIDIA RTX A5500 Laptop GPU': { name: 'RTX A5500 Laptop GPU', id: 4562 },
  'NVIDIA RTX A5000 Laptop GPU': { name: 'RTX A5000 Laptop GPU', id: 4416 },
  'NVIDIA RTX A4500 Laptop GPU': { name: 'RTX A4500 Laptop GPU', id: 4565 },
  'AMD Radeon 8060S': { name: 'Radeon 8060S', id: 5327 },
}

function gpuSourceUrl(model: string): string {
  const source = PASSMARK_GPU_IDS[model]
  return `https://www.videocardbenchmark.net/video_lookup.php?gpu=${encodeURIComponent(source.name)}&id=${source.id}`
}

// CPU Mark values as published on PassMark's laptop and single-thread charts
// on 2026-09-02. Scoring uses the live-refreshed evidence store, not these;
// they exist so listings can be matched to a chip and so the audit can spot a
// live figure that has drifted far from the reference. Order matters where one
// name is a prefix of another: the longer suffix must come first.
const CPU_SEEDS: BenchmarkSeed[] = [
  { canonical: 'Intel Core Ultra 9 290HX Plus', patterns: [/\b(?:core\s*)?ultra\s*9\s*290hx(?:\s*plus)?\b/i], score: 59042, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 9 285HX', patterns: [/\b(?:core\s*)?ultra\s*9\s*285hx\b/i], score: 56560, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 9 285H', patterns: [/\b(?:core\s*)?ultra\s*9\s*285h\b/i], score: 34207, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 9 275HX', patterns: [/\b(?:core\s*)?ultra\s*9\s*275hx\b/i], score: 55738, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 7 270HX Plus', patterns: [/\b(?:core\s*)?ultra\s*7\s*270hx(?:\s*plus)?\b/i], score: 49310, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 7 265HX', patterns: [/\b(?:core\s*)?ultra\s*7\s*265hx\b/i], score: 47615, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 7 265H', patterns: [/\b(?:core\s*)?ultra\s*7\s*265h\b/i], score: 34030, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 7 255HX', patterns: [/\b(?:core\s*)?ultra\s*7\s*255hx\b/i], score: 48064, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 7 255H', patterns: [/\b(?:core\s*)?ultra\s*7\s*255h\b/i], score: 30736, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 7 251HX', patterns: [/\b(?:core\s*)?ultra\s*7\s*251hx\b/i], score: 46965, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 5 235HX', patterns: [/\b(?:core\s*)?ultra\s*5\s*235hx\b/i], score: 40900, manufacturer: 'Intel' },
  { canonical: 'Intel Core 7 245HX', patterns: [/\bcore\s+7\s+245hx\b/i], score: 41634, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 7 155H', patterns: [/\b(?:core\s*)?ultra\s*7\s*155h\b/i], score: 24486, manufacturer: 'Intel' },
  { canonical: 'Intel Core Ultra 9 185H', patterns: [/\b(?:core\s*)?ultra\s*9\s*185h\b/i], score: 28986, manufacturer: 'Intel' },
  { canonical: 'Intel Core i9-14900HX', patterns: [/\b(?:intel\s*)?(?:core\s*)?i9[-\s]?14900hx\b/i], score: 43661, manufacturer: 'Intel' },
  { canonical: 'Intel Core i9-13980HX', patterns: [/\bi9[-\s]?13980hx\b/i], score: 45332, manufacturer: 'Intel' },
  { canonical: 'Intel Core i9-13950HX', patterns: [/\bi9[-\s]?13950hx\b/i], score: 40471, manufacturer: 'Intel' },
  { canonical: 'Intel Core i9-13900HX', patterns: [/\bi9[-\s]?13900hx\b/i], score: 41498, manufacturer: 'Intel' },
  { canonical: 'Intel Core i9-13900H', patterns: [/\bi9[-\s]?13900h\b/i], score: 27073, manufacturer: 'Intel' },
  { canonical: 'Intel Core i9-12900HX', patterns: [/\bi9[-\s]?12900hx\b/i], score: 32922, manufacturer: 'Intel' },
  { canonical: 'Intel Core i7-14700HX', patterns: [/\bi7[-\s]?14700hx\b/i], score: 36511, manufacturer: 'Intel' },
  { canonical: 'Intel Core i7-14650HX', patterns: [/\bi7[-\s]?14650hx\b/i], score: 33473, manufacturer: 'Intel' },
  { canonical: 'Intel Core i7-13700HX', patterns: [/\bi7[-\s]?13700hx\b/i], score: 31594, manufacturer: 'Intel' },
  { canonical: 'Intel Core i7-13700H', patterns: [/\bi7[-\s]?13700h\b/i], score: 25835, manufacturer: 'Intel' },
  { canonical: 'Intel Core i7-13650HX', patterns: [/\bi7[-\s]?13650hx\b/i], score: 30012, manufacturer: 'Intel' },
  { canonical: 'AMD Ryzen 9 9955HX3D', patterns: [/\bryzen\s*9\s*9955hx3d\b/i], score: 62423, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 9955HX', patterns: [/\bryzen\s*9\s*9955hx\b/i], score: 56303, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 9850HX', patterns: [/\bryzen\s*9\s*9850hx\b/i], score: 51722, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 8945HX', patterns: [/\bryzen\s*9\s*8945hx\b/i], score: 51377, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 8945H', patterns: [/\bryzen\s*9\s*8945h\b/i], score: 30073, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 8940HX', patterns: [/\bryzen\s*9\s*8940hx\b/i], score: 49576, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 7945HX3D', patterns: [/\bryzen\s*9\s*7945hx3d\b/i], score: 57723, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 7945HX', patterns: [/\bryzen\s*9\s*7945hx\b/i], score: 53884, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 7845HX', patterns: [/\bryzen\s*9\s*7845hx\b/i], score: 44389, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen 9 7940HS', patterns: [/\bryzen\s*9\s*7940hs\b/i], score: 29782, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen AI Max+ Pro 395', patterns: [/\bryzen\s*ai\s*max\+?\s*pro\s*395\b/i], score: 51743, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen AI Max+ 395', patterns: [/\bryzen\s*ai\s*max\+?\s*395\b/i], score: 54906, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen AI Max+ 392', patterns: [/\bryzen\s*ai\s*max\+?\s*392\b/i], score: 45438, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen AI 9 HX 375', patterns: [/\bryzen\s*ai\s*9\s*hx\s*375\b/i], score: 35393, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen AI 9 HX 370', patterns: [/\bryzen\s*ai\s*9\s*hx\s*370\b/i], score: 34959, manufacturer: 'AMD' },
  { canonical: 'AMD Ryzen AI 9 365', patterns: [/\bryzen\s*ai\s*9\s*365\b/i], score: 30344, manufacturer: 'AMD' },
]

export const CPU_BENCHMARKS: BenchmarkEntry[] = CPU_SEEDS.map((entry) => ({
  ...entry,
  source: {
    ...CPU_SOURCE,
    url: cpuSourceUrl(entry.canonical),
    method: `Reference index ${entry.score} for ${entry.canonical} from the PassMark laptop chart; live scoring re-reads the verified model page.`,
  },
}))

// G3D Mark values from PassMark's GPU charts on 2026-09-02. Ti and PRO parts
// precede their plain namesakes so a longer name is never swallowed by a
// shorter pattern.
const GPU_SEEDS: BenchmarkSeed[] = [
  { canonical: 'NVIDIA GeForce RTX 5090 Laptop GPU', patterns: [/\brtx\s*5090\b/i], score: 28268, manufacturer: 'NVIDIA', family: 'RTX 50 series', vramGb: 24 },
  { canonical: 'NVIDIA GeForce RTX 5080 Laptop GPU', patterns: [/\brtx\s*5080\b/i], score: 26297, manufacturer: 'NVIDIA', family: 'RTX 50 series', vramGb: 16 },
  { canonical: 'NVIDIA GeForce RTX 5070 Ti Laptop GPU', patterns: [/\brtx\s*5070\s*ti\b/i], score: 22442, manufacturer: 'NVIDIA', family: 'RTX 50 series', vramGb: 12 },
  { canonical: 'NVIDIA GeForce RTX 5070 Laptop GPU', patterns: [/\brtx\s*5070\b/i], score: 19081, manufacturer: 'NVIDIA', family: 'RTX 50 series', vramGb: 8 },
  { canonical: 'NVIDIA GeForce RTX 5060 Laptop GPU', patterns: [/\brtx\s*5060\b/i], score: 16718, manufacturer: 'NVIDIA', family: 'RTX 50 series', vramGb: 8 },
  { canonical: 'NVIDIA GeForce RTX 4090 Laptop GPU', patterns: [/\brtx\s*4090\b/i], score: 27027, manufacturer: 'NVIDIA', family: 'RTX 40 series', vramGb: 16 },
  { canonical: 'NVIDIA GeForce RTX 4080 Laptop GPU', patterns: [/\brtx\s*4080\b/i], score: 24725, manufacturer: 'NVIDIA', family: 'RTX 40 series', vramGb: 12 },
  { canonical: 'NVIDIA GeForce RTX 4070 Laptop GPU', patterns: [/\brtx\s*4070\b/i], score: 19478, manufacturer: 'NVIDIA', family: 'RTX 40 series', vramGb: 8 },
  { canonical: 'NVIDIA GeForce RTX 4060 Laptop GPU', patterns: [/\brtx\s*4060\b/i], score: 17343, manufacturer: 'NVIDIA', family: 'RTX 40 series', vramGb: 8 },
  { canonical: 'NVIDIA GeForce RTX 3080 Ti Laptop GPU', patterns: [/\brtx\s*3080\s*ti\b/i], score: 18821, manufacturer: 'NVIDIA', family: 'RTX 30 series', vramGb: 16 },
  { canonical: 'NVIDIA GeForce RTX 3080 Laptop GPU', patterns: [/\brtx\s*3080\b/i], score: 16063, manufacturer: 'NVIDIA', family: 'RTX 30 series', vramGb: 8 },
  { canonical: 'NVIDIA GeForce RTX 3070 Ti Laptop GPU', patterns: [/\brtx\s*3070\s*ti\b/i], score: 17292, manufacturer: 'NVIDIA', family: 'RTX 30 series', vramGb: 8 },
  { canonical: 'NVIDIA RTX PRO 5000 Blackwell Laptop GPU', patterns: [/\brtx\s*pro\s*5000\b/i], score: 24629, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 24 },
  { canonical: 'NVIDIA RTX PRO 4000 Blackwell Laptop GPU', patterns: [/\brtx\s*pro\s*4000\b/i], score: 22849, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 16 },
  { canonical: 'NVIDIA RTX PRO 3000 Blackwell Laptop GPU', patterns: [/\brtx\s*pro\s*3000\b/i], score: 21015, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 12 },
  { canonical: 'NVIDIA RTX PRO 2000 Blackwell Laptop GPU', patterns: [/\brtx\s*pro\s*2000\b/i], score: 16346, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 8 },
  { canonical: 'NVIDIA RTX 5000 Ada Laptop GPU', patterns: [/\brtx\s*5000\s*ada\b/i], score: 23246, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 16 },
  { canonical: 'NVIDIA RTX 4000 Ada Laptop GPU', patterns: [/\brtx\s*4000\s*ada\b/i], score: 21967, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 12 },
  { canonical: 'NVIDIA RTX 3500 Ada Laptop GPU', patterns: [/\brtx\s*3500\s*ada\b/i], score: 19729, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 12 },
  { canonical: 'NVIDIA RTX 3000 Ada Laptop GPU', patterns: [/\brtx\s*3000\s*ada\b/i], score: 16100, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 8 },
  { canonical: 'NVIDIA RTX 2000 Ada Laptop GPU', patterns: [/\brtx\s*2000\s*ada\b/i], score: 14815, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 8 },
  { canonical: 'NVIDIA RTX A5500 Laptop GPU', patterns: [/\brtx\s*a5500\b/i], score: 17353, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 16 },
  { canonical: 'NVIDIA RTX A5000 Laptop GPU', patterns: [/\brtx\s*a5000\b/i], score: 16358, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 16 },
  { canonical: 'NVIDIA RTX A4500 Laptop GPU', patterns: [/\brtx\s*a4500\b/i], score: 16770, manufacturer: 'NVIDIA', family: 'RTX workstation', vramGb: 16 },
  // Strix Halo's integrated graphics. No dedicated VRAM; it borrows system memory.
  { canonical: 'AMD Radeon 8060S', patterns: [/\b(?:radeon\s*)?8060s\b/i], score: 18058, manufacturer: 'AMD', family: 'Radeon integrated' },
]

export const GPU_BENCHMARKS: BenchmarkEntry[] = GPU_SEEDS.map((entry) => ({
  ...entry,
  source: {
    ...GPU_SOURCE,
    url: gpuSourceUrl(entry.canonical),
    method: `Observed PassMark G3D model index ${entry.score} for ${entry.canonical}; used as a class estimate because laptop TGP and cooling vary.`,
  },
}))

export const CPU_BASELINE = CPU_BENCHMARKS.find((entry) => entry.canonical === 'Intel Core i9-14900HX')!.score
export const GPU_BASELINE = GPU_BENCHMARKS.find((entry) => entry.canonical === 'NVIDIA GeForce RTX 4060 Laptop GPU')!.score

export function matchBenchmark(text: string, catalog: BenchmarkEntry[]): BenchmarkEntry | null {
  return catalog.find((entry) => entry.patterns.some((pattern) => pattern.test(text))) ?? null
}
