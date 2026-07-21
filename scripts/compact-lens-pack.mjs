import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const defaultPack = 'G:\\My Drive\\resale-arbitrage\\lens-packs\\canon-ef-50mm-f-1-8-stm\\listings-full.json'

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}

function hashJson(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function aspectObject(aspects = []) {
  return Object.fromEntries((aspects ?? []).map((aspect) => [String(aspect.name ?? ''), aspect.value ?? '']))
}

function totalCost(listing) {
  return Number(listing.price ?? 0) + Number(listing.shippingPrice ?? 0)
}

function lensEvidenceCard(listing, packDir) {
  const rawRef = path.join('raw', `${String(listing.packIndex).padStart(3, '0')}-${listing.sourceListingId.replaceAll('|', '_')}.json`)
  const evidence = {
    packIndex: listing.packIndex,
    sourceListingId: listing.sourceListingId,
    listingUrl: listing.listingUrl,
    searchTerm: listing.searchTerm,
    title: listing.title,
    description: listing.description ?? '',
    condition: listing.condition ?? '',
    conditionDescription: listing.conditionDescription ?? '',
    itemSpecifics: aspectObject(listing.localizedAspects ?? []),
    seller: {
      name: listing.sellerName ?? '',
      feedbackScore: listing.sellerFeedbackScore ?? null,
      feedbackPercent: listing.sellerFeedbackPercent ?? null,
    },
    location: listing.location ?? '',
    pricing: {
      price: Number(listing.price ?? 0),
      shippingPrice: Number(listing.shippingPrice ?? 0),
      totalBuyCost: totalCost(listing),
      currency: 'GBP',
    },
    listingFlagsFromCollector: {
      excluded: Boolean(listing.excluded),
      excludedReason: listing.excludedReason ?? null,
      riskFlags: listing.riskFlags ?? [],
    },
    images: (listing.imageFiles ?? []).map((file, index) => ({
      index: index + 1,
      path: file,
      relativePath: path.relative(packDir, file),
    })),
    fullDetailReference: {
      rawJsonRelativePath: rawRef,
      note: 'Full listing JSON is preserved here; compact card is not the source of truth.',
    },
  }
  return {
    ...evidence,
    contentHash: hashJson(evidence),
  }
}

async function main() {
  const packPath = argValue('--pack', defaultPack)
  const packDir = path.dirname(packPath)
  const compactDir = path.join(packDir, 'compact')
  const rawDir = path.join(packDir, 'raw')
  await mkdir(compactDir, { recursive: true })
  await mkdir(rawDir, { recursive: true })

  const pack = JSON.parse(await readFile(packPath, 'utf8'))
  const cards = []
  for (const listing of pack.listings) {
    const rawFile = path.join(rawDir, `${String(listing.packIndex).padStart(3, '0')}-${listing.sourceListingId.replaceAll('|', '_')}.json`)
    await writeFile(rawFile, JSON.stringify(listing, null, 2))
    const card = lensEvidenceCard(listing, packDir)
    cards.push(card)
    await writeFile(path.join(compactDir, `${String(listing.packIndex).padStart(3, '0')}.json`), JSON.stringify(card, null, 2))
  }

  const index = {
    searchTerm: pack.searchTerm,
    generatedAt: new Date().toISOString(),
    sourcePack: packPath,
    count: cards.length,
    cards,
  }
  await writeFile(path.join(packDir, 'evidence-cards.json'), JSON.stringify(index, null, 2))
  console.log(`Wrote ${cards.length} evidence cards to ${path.join(packDir, 'evidence-cards.json')}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
