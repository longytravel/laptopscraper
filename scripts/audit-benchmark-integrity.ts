/**
 * Cross-checks the live-refreshed benchmark evidence against the seeded reference
 * table. The seeds are hand-curated; the refresh is scraped. Where they disagree
 * sharply, or where two different chips somehow share an identical score and
 * sample count, the scrape is the suspect party.
 *
 * Run with: npm run audit:laptop-benchmarks
 */
import { readFileSync } from 'node:fs'

import { CPU_BENCHMARKS, CPU_BASELINE } from '../src/laptop/benchmarks'
import type { BenchmarkEvidenceRecord, BenchmarkEvidenceStore } from '../src/laptop/benchmark-evidence'
import type { LaptopDataset, LaptopListing } from '../src/laptop/types'

const evidence = JSON.parse(readFileSync('data/laptop-benchmark-evidence.json', 'utf8')) as BenchmarkEvidenceStore
const dataset = JSON.parse(readFileSync('public/data/laptop-listings.json', 'utf8')) as LaptopDataset

const records: BenchmarkEvidenceRecord[] = Object.values(evidence.records).filter((record) => record.kind === 'cpu')
const eligible: LaptopListing[] = dataset.listings.filter((listing) => listing.bestBuyEligible)
const usedCpus = new Set(eligible.map((listing) => listing.cpuModel).filter((model): model is string => Boolean(model)))

// 1. Identical score + sampleCount across different chips means the scraper
//    resolved two lookups to the same upstream page.
const fingerprint = new Map<string, string[]>()
for (const record of records) {
  const key = `${record.multiCoreScore}|${record.singleThreadScore}|${record.sampleCount}`
  fingerprint.set(key, [...(fingerprint.get(key) ?? []), record.canonical])
}

console.log('== COLLISIONS: distinct chips sharing one benchmark record ==')
let collisions = 0
for (const [key, names] of fingerprint) {
  if (names.length < 2) continue
  collisions += 1
  const inUse = names.filter((name) => usedCpus.has(name))
  console.log(`  ${names.join('  ==  ')}`)
  console.log(`     score/sample: ${key}${inUse.length ? `   << AFFECTS RECOMMENDATIONS: ${inUse.join(', ')}` : ''}`)
}
if (!collisions) console.log('  none')

// 2. Page name vs requested chip. v2 records carry the name PassMark printed.
console.log('\n== PAGE NAMES: records whose PassMark page names a different chip ==')
let mismatches = 0
for (const record of records) {
  if (!record.verifiedName) continue
  const same = record.verifiedName.replace(/\W/g, '').toLowerCase() === record.canonical.replace(/\W/g, '').toLowerCase()
  if (same) continue
  mismatches += 1
  console.log(`  ${record.canonical}  ->  page says "${record.verifiedName}"`)
}
if (!mismatches) console.log(`  none (${records.filter((record) => record.verifiedName).length} of ${records.length} records carry a verified name)`)

// 3. Scraped value vs curated seed. Large divergence = wrong page scraped.
console.log('\n== DIVERGENCE: scraped multi-core vs seeded reference ==')
const rows: Array<{ name: string; seed: number; live: number; drift: number; used: boolean }> = []
for (const record of records) {
  const seed = CPU_BENCHMARKS.find((entry) => entry.canonical === record.canonical)
  if (!seed || !record.multiCoreScore) continue
  const drift = (record.multiCoreScore - seed.score) / seed.score
  rows.push({ name: record.canonical, seed: seed.score, live: record.multiCoreScore, drift, used: usedCpus.has(record.canonical) })
}
rows.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))
for (const row of rows.slice(0, 12)) {
  const pct = (row.drift * 100).toFixed(1).padStart(6)
  const flag = Math.abs(row.drift) > 0.15 ? ' <<< SUSPECT' : ''
  const used = row.used ? ' [in recommendations]' : ''
  console.log(`  ${pct}%  ${row.name.padEnd(30)} seed ${String(row.seed).padStart(6)} -> live ${String(row.live).padStart(6)}${flag}${used}`)
}

// 4. Re-derive the gate using seeded numbers: would each pick still qualify?
console.log(`\n== GATE RE-CHECK using seeded scores (baseline i9-14900HX = ${CPU_BASELINE}) ==`)
for (const listing of eligible) {
  const seed = CPU_BENCHMARKS.find((entry) => entry.canonical === listing.cpuModel)
  if (!seed) {
    console.log(`  ?  no seed for ${listing.cpuModel} — cannot re-check`)
    continue
  }
  if (seed.score >= CPU_BASELINE) continue
  console.log(`  FAIL  £${listing.price}  ${listing.cpuModel}`)
  console.log(`        seeded multi ${seed.score} < baseline ${CPU_BASELINE} -> should NOT be recommended`)
  console.log(`        ${listing.title.slice(0, 70)}`)
}
console.log('  (only failures listed)')

if (collisions || mismatches) process.exitCode = 1
