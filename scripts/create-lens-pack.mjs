import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const inputPath = path.join(root, 'public', 'data', 'listings.json')
const defaultOutRoot = 'G:\\My Drive\\resale-arbitrage\\lens-packs'

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function totalCost(listing) {
  return Number(listing.price ?? 0) + Number(listing.shippingPrice ?? 0)
}

async function downloadImage(url, outPath) {
  const hiRes = url.replace(/s-l\d+\.jpg/i, 's-l1600.jpg')
  const response = await fetch(hiRes)
  if (!response.ok) {
    const fallback = await fetch(url)
    if (!fallback.ok) throw new Error(`image ${fallback.status}`)
    await writeFile(outPath, Buffer.from(await fallback.arrayBuffer()))
    return
  }
  await writeFile(outPath, Buffer.from(await response.arrayBuffer()))
}

function compactForAssessment(listing) {
  return {
    sourceListingId: listing.sourceListingId,
    listingUrl: listing.listingUrl,
    searchTerm: listing.searchTerm,
    title: listing.title,
    description: listing.description,
    condition: listing.condition,
    conditionDescription: listing.conditionDescription ?? null,
    price: listing.price,
    shippingPrice: listing.shippingPrice,
    totalBuyCost: totalCost(listing),
    sellerName: listing.sellerName,
    sellerFeedbackScore: listing.sellerFeedbackScore,
    sellerFeedbackPercent: listing.sellerFeedbackPercent,
    location: listing.location,
    excluded: listing.excluded,
    excludedReason: listing.excludedReason,
    riskFlags: listing.riskFlags ?? [],
    localizedAspects: listing.localizedAspects ?? listing.rawPayload?.localizedAspects ?? [],
    imageUrls: listing.imageUrls ?? [],
  }
}

function initialAssessment(listing) {
  const aspects = new Map((listing.localizedAspects ?? []).map((aspect) => [String(aspect.name ?? '').toLowerCase(), String(aspect.value ?? '')]))
  const type = aspects.get('type') ?? ''
  const title = listing.title.toLowerCase()
  const reasons = []
  if (listing.excluded) reasons.push(`Excluded by local classifier: ${listing.excludedReason}`)
  if (type && !/lens/i.test(type)) reasons.push(`Item specific Type is "${type}", not a lens`)
  if (/hood|cap|manual|adapter|filter|case/.test(title)) reasons.push('Title contains an accessory indicator')
  if ((listing.riskFlags ?? []).length) reasons.push(`Risk flags: ${listing.riskFlags.join(', ')}`)

  return {
    sourceListingId: listing.sourceListingId,
    decision: listing.excluded ? 'exclude' : 'needs_review',
    totalBuyCost: totalCost(listing),
    localReasons: reasons,
    aiAssessment: null,
  }
}

async function main() {
  const searchTerm = argValue('--search', 'Canon EF 50mm f/1.8 STM')
  const outRoot = argValue('--out', defaultOutRoot)
  const data = JSON.parse(await readFile(inputPath, 'utf8'))
  const rows = (data.listings ?? []).filter((listing) => listing.searchTerm === searchTerm)
  if (!rows.length) throw new Error(`No listings found for search term: ${searchTerm}`)

  rows.sort((a, b) => totalCost(a) - totalCost(b))
  const packDir = path.join(outRoot, slug(searchTerm))
  const imagesDir = path.join(packDir, 'images')
  await mkdir(imagesDir, { recursive: true })

  const listings = []
  for (const [listingIndex, listing] of rows.entries()) {
    const listingDir = path.join(imagesDir, String(listingIndex + 1).padStart(3, '0'))
    await mkdir(listingDir, { recursive: true })
    const imageFiles = []
    for (const [imageIndex, url] of (listing.imageUrls ?? []).entries()) {
      const imagePath = path.join(listingDir, `image-${imageIndex + 1}.jpg`)
      try {
        await downloadImage(url, imagePath)
        imageFiles.push(imagePath)
      } catch (error) {
        imageFiles.push(`FAILED: ${url} (${error.message})`)
      }
    }
    listings.push({
      ...compactForAssessment(listing),
      packIndex: listingIndex + 1,
      imageFiles,
    })
    console.log(`${listingIndex + 1}/${rows.length}: ${listing.title}`)
  }

  const assessments = listings.map(initialAssessment)
  const pack = {
    searchTerm,
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: data.generatedAt,
    sourceEnrichedAt: data.enrichedAt ?? null,
    listingCount: listings.length,
    listings,
  }

  await writeFile(path.join(packDir, 'listings-full.json'), JSON.stringify(pack, null, 2))
  await writeFile(path.join(packDir, 'assessments.json'), JSON.stringify({ searchTerm, assessments }, null, 2))
  await writeFile(
    path.join(packDir, 'README.md'),
    [
      `# Lens Pack: ${searchTerm}`,
      '',
      `Listings: ${listings.length}`,
      '',
      'Files:',
      '- `listings-full.json`: compact full detail for assessment.',
      '- `assessments.json`: local starter assessments; replace/fill `aiAssessment` after model review.',
      '- `images/`: downloaded listing photos grouped by ranked price order.',
      '',
      'Assessment goal:',
      '- identify true lens listings versus accessories/bundles/wrong products',
      '- assess condition from title, description, item specifics, and photos',
      '- recommend winners only after sold comps are available',
    ].join('\n'),
  )
  console.log(`Created pack: ${packDir}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
