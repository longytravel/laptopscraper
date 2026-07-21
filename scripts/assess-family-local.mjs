import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const defaultPack = 'G:\\My Drive\\resale-arbitrage\\lens-packs\\canon-ef-50mm-f-1-8-stm\\listings-full.json'
const outputPath = path.join(root, 'public', 'data', 'family-assessments.json')

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}

function aspectValue(listing, name) {
  const aspect = (listing.localizedAspects ?? []).find((item) => String(item.name ?? '').toLowerCase() === name.toLowerCase())
  return String(aspect?.value ?? '')
}

function lowerText(listing) {
  return `${listing.title} ${listing.description ?? ''} ${listing.conditionDescription ?? ''} ${JSON.stringify(listing.localizedAspects ?? [])}`.toLowerCase()
}

function assessCanonEf50(listing) {
  const text = lowerText(listing)
  const type = aspectValue(listing, 'Type').toLowerCase()
  const mount = `${aspectValue(listing, 'Mount')} ${aspectValue(listing, 'Lens Fitting')} ${aspectValue(listing, 'Compatible Brand')}`.toLowerCase()
  const reasons = []
  const positives = []
  let decision = 'review'
  let conditionGrade = 'unknown'
  let valueMultiplier = 1

  const accessoryType = ['lens hood', 'lens cap', 'filter', 'adapter', 'case', 'manual'].some((accessory) => type.includes(accessory))
  const accessoryTitle = /\b(hood|cap|manual|guide|adapter)\s+(only|for)\b|\b(hood|cap|manual|guide|adapter)\b.*\bonly\b|\bcase only\b|\bfilter only\b/.test(text)
  const isAccessory = listing.excluded || accessoryType || accessoryTitle
  const isBundle = /\b(eos 2000d|dslr|camera body|body only|with camera|kit boxed extras|camera with)\b/.test(text) && !/\blens only\b/.test(text)
  const isRf = /\brf\s*50|canon rf|mount"\s*:\s*"canon rf/i.test(JSON.stringify(listing.localizedAspects ?? [])) || /\brf50mm\b/.test(text)
  const isFaulty = /faulty|spares|repair|not working|damaged|fungus|haze|mold|autofocus.*fault|af.*fault/.test(text)
  const missingRearCap = /missing back lid|missing rear cap|no rear cap/.test(text)

  if (isAccessory) {
    decision = 'exclude'
    valueMultiplier = 0
    reasons.push('Not the lens: accessory/manual/filter/hood/cap style listing.')
  }
  if (isBundle) {
    decision = 'exclude'
    valueMultiplier = 0
    reasons.push('Bundle listing: lens value cannot be separated cleanly.')
  }
  if (isRf) {
    decision = 'exclude'
    valueMultiplier = 0
    reasons.push('Wrong mount/product family: Canon RF 50mm, not Canon EF 50mm f/1.8 STM.')
  }
  if (!isAccessory && !isBundle && !isRf) {
    if (isFaulty) {
      decision = 'avoid'
      valueMultiplier = 0.35
      reasons.push('Fault/repair/optical-risk language makes sold-working comps invalid.')
    } else if (missingRearCap) {
      decision = 'review'
      valueMultiplier = 0.82
      reasons.push('Missing rear cap increases dust/damage risk and lowers resale presentation.')
    } else {
      decision = 'candidate'
      valueMultiplier = 1
    }
  }

  if (/mint|opened never used|top condition|stunning|excellent/.test(text)) {
    conditionGrade = 'excellent'
    positives.push('Strong condition wording.')
    if (decision === 'candidate') valueMultiplier = Math.max(valueMultiplier, 1.05)
  } else if (/good|works|used/.test(text)) {
    conditionGrade = 'good'
  }
  if (/boxed|box/.test(text)) {
    positives.push('Box included or boxed listing.')
    if (decision === 'candidate') valueMultiplier += 0.03
  }
  if (/front.*rear|rear.*front|both caps|front & rear caps|front and rear caps/.test(text)) {
    positives.push('Front and rear caps indicated.')
    if (decision === 'candidate') valueMultiplier += 0.03
  }
  if (!/stm/.test(text) && decision !== 'exclude') {
    decision = 'review'
    valueMultiplier = Math.min(valueMultiplier, 0.78)
    reasons.push('Title does not clearly confirm STM version.')
  }

  valueMultiplier = Math.max(0, Math.min(valueMultiplier, 1.12))
  return {
    sourceListingId: listing.sourceListingId,
    listingUrl: listing.listingUrl,
    title: listing.title,
    targetFamily: 'Canon EF 50mm f/1.8 STM',
    decision,
    conditionGrade,
    valueMultiplier: Number(valueMultiplier.toFixed(2)),
    reasons,
    positives,
    verifyBeforeBuying:
      decision === 'candidate' || decision === 'review'
        ? ['Confirm exact EF STM version', 'Confirm autofocus works', 'Confirm no fungus/haze/scratches', 'Confirm rear and front caps']
        : [],
  }
}

async function main() {
  const packPath = argValue('--pack', defaultPack)
  const pack = JSON.parse(await readFile(packPath, 'utf8'))
  const assessments = pack.listings.map(assessCanonEf50)
  const output = {
    generatedAt: new Date().toISOString(),
    method: 'local-specialist-assessment-v1',
    searchTerm: pack.searchTerm,
    count: assessments.length,
    assessments,
  }
  await mkdir(path.dirname(outputPath), { recursive: true })
  await writeFile(outputPath, JSON.stringify(output, null, 2))
  await writeFile(path.join(path.dirname(packPath), 'local-specialist-assessments.json'), JSON.stringify(output, null, 2))
  const summary = assessments.reduce((acc, item) => {
    acc[item.decision] = (acc[item.decision] ?? 0) + 1
    return acc
  }, {})
  console.log(JSON.stringify(summary, null, 2))
  console.log(`Saved assessments to ${outputPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
