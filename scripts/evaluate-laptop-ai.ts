import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'

import type { LaptopDataset, LaptopListing } from '../src/laptop/types'

const DATA_PATH = 'public/data/laptop-listings.json'
const FIELDS = ['brand', 'cpuModel', 'gpuModel', 'ramGb', 'storageGb', 'screenInches', 'resolution', 'vramGb'] as const

function chartCounts(rows: LaptopListing[]) {
  return {
    exact: rows.filter((row) => row.combinedPower != null && row.deliveredPrice != null).length,
    lowerBound: rows.filter((row) => row.combinedPower != null && row.deliveredPrice == null).length,
    total: rows.filter((row) => row.combinedPower != null).length,
  }
}

async function main() {
  const before = JSON.parse(execFileSync('git', ['show', `HEAD:${DATA_PATH}`], { encoding: 'utf8' })) as LaptopDataset
  const after = JSON.parse(await readFile(DATA_PATH, 'utf8')) as LaptopDataset
  const beforeById = new Map(before.listings.map((row) => [row.id, row]))
  const recoveries = Object.fromEntries(FIELDS.map((field) => [field, 0])) as Record<(typeof FIELDS)[number], number>
  const existingChanges: Array<{ id: string; field: string; before: unknown; after: unknown }> = []
  const invariantChanges: Array<{ id: string; field: string }> = []
  let addedRisks = 0
  let invalidEvidence = 0

  for (const row of after.listings) {
    const previous = beforeById.get(row.id)
    if (!previous) continue
    for (const field of FIELDS) {
      if (previous[field] == null && row[field] != null) recoveries[field] += 1
      else if (previous[field] != null && previous[field] !== row[field]) existingChanges.push({ id: row.id, field, before: previous[field], after: row[field] })
    }
    for (const field of ['price', 'shippingPrice', 'deliveredPrice', 'hardExcluded', 'hardExclusionReason'] as const) {
      if (previous[field] !== row[field]) invariantChanges.push({ id: row.id, field })
    }
    addedRisks += row.riskFlags.filter((risk) => !previous.riskFlags.includes(risk)).length
    const searchable = `${row.title}\n${row.description}`.toLocaleLowerCase()
    for (const claim of row.aiEnrichment?.acceptedClaims ?? []) {
      if (!searchable.includes(claim.evidence.toLocaleLowerCase())) invalidEvidence += 1
    }
    for (const risk of row.aiEnrichment?.riskEvidence ?? []) {
      if (!searchable.includes(risk.evidence.toLocaleLowerCase())) invalidEvidence += 1
    }
  }

  const summary = {
    beforeListings: before.listings.length,
    afterListings: after.listings.length,
    aiRows: after.listings.filter((row) => row.aiEnrichment).length,
    aiRun: after.aiRun,
    chartBefore: chartCounts(before.listings),
    chartAfter: chartCounts(after.listings),
    recoveries,
    addedRisks,
    existingFieldChanges: existingChanges.length,
    invariantChanges: invariantChanges.length,
    invalidEvidence,
    sampleExistingChanges: existingChanges.slice(0, 10),
    sampleInvariantChanges: invariantChanges.slice(0, 10),
  }
  console.log(JSON.stringify(summary, null, 2))
  if (before.listings.length !== after.listings.length || invariantChanges.length || existingChanges.length || invalidEvidence) process.exitCode = 1
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
