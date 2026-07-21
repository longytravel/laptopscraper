import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const outputPath = path.join(process.cwd(), 'public', 'data', 'sold-comps.json')

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}

function moneyFrom(text) {
  const match = String(text ?? '').match(/(?:£|GBP)\s*([0-9,.]+)/i)
  if (!match) return 0
  return Number(match[1].replaceAll(',', ''))
}

function looksLikeListingTitle(line) {
  return (
    /canon|lens|hood|cap|stm|ef\s*50|nifty/i.test(line) &&
    !/preview|edit|actions|postage|sales|sold|date|filter|research|seller hub|feedback|category|condition|format|price|marketplace/i.test(
      line,
    ) &&
    !/^(fixed price|auction|ebay delivery|\d+|-)$/i.test(line)
  )
}

function classifyComp(title) {
  const text = String(title ?? '').toLowerCase()
  const reasons = []

  if (/\bcap\b|lens cap|49mm filter lens cap/.test(text)) reasons.push('accessory_cap')
  if (/\bhood\b|es-68/.test(text)) reasons.push('accessory_hood')
  if (/\b(ii|f\/1\.8\s+ii|1\.8\s+ii)\b/.test(text) && !/\bstm\b/.test(text)) {
    reasons.push('wrong_version_ef_ii')
  }
  if (/\b(eos\s*t3i|600d|digital camera|camera\s*\+|bundle|kit)\b/.test(text)) reasons.push('bundle_or_camera')
  if (!/\bstm\b/.test(text)) reasons.push('missing_stm_identity')

  const includeInValuation =
    reasons.length === 0 &&
    /canon/.test(text) &&
    /50\s*mm|50mm/.test(text) &&
    /1\.8|f1\.8|f\/1\.8/.test(text) &&
    /stm/.test(text)

  return {
    targetFamily: includeInValuation ? 'canon-ef-50mm-f1.8-stm' : 'non_target_or_uncertain',
    includeInValuation,
    exclusionReasons: reasons,
  }
}

function parseTerapeakRows(text) {
  const lines = text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  const rows = []
  let i = 0

  while (i < lines.length) {
    const title = lines[i]
    if (!looksLikeListingTitle(title)) {
      i += 1
      continue
    }

    const window = lines.slice(i, i + 22)
    const priceIndex = window.findIndex((line) => /(?:£|GBP)\s*\d/i.test(line))
    if (priceIndex < 0) {
      i += 1
      continue
    }

    const price = moneyFrom(window[priceIndex])
    const format = window[priceIndex + 1] ?? ''
    const postageLine =
      window.find(
        (line, index) => index > priceIndex && (/(?:£|GBP)\s*\d/i.test(line) || /free postage|ebay delivery/i.test(line)),
      ) ?? ''
    const shippingPrice = /free postage/i.test(postageLine) ? 0 : moneyFrom(postageLine)
    const totalSoldLine = window.find((line, index) => index > priceIndex && /^\d+$/.test(line) && Number(line) > 0) ?? '1'
    const totalSold = Number(totalSoldLine)
    const itemSalesLine = window.find((line, index) => index > priceIndex + 1 && /(?:£|GBP)\s*\d/i.test(line))
    const soldDate = window.find((line) => /\b\d{1,2}\s+[A-Za-z]{3}\s+20\d{2}\b/.test(line)) ?? null
    const classification = classifyComp(title)

    rows.push({
      source: 'terapeak-paste',
      title,
      price,
      shippingPrice,
      format,
      totalSold,
      itemSales: itemSalesLine ? moneyFrom(itemSalesLine) : price * totalSold,
      soldDate,
      rawText: window.join(' | '),
      ...classification,
    })

    i += Math.max(priceIndex + 8, 1)
  }

  return rows
}

function parsePastedTerapeak(text, searchTerm) {
  return parseTerapeakRows(text).map((row, index) => ({
    ...row,
    searchTerm,
    soldItemId: `terapeak-paste-${index + 1}`,
    soldUrl: '',
    totalSoldValue: row.price + row.shippingPrice,
    currency: 'GBP',
    condition: '',
  }))
}

async function main() {
  const file = argValue('--file')
  const searchTerm = argValue('--search', 'Canon EF 50mm f/1.8 STM')
  if (!file) throw new Error('Use --file "G:\\My Drive\\...\\terapeak-paste.txt"')

  const comps = parsePastedTerapeak(await readFile(file, 'utf8'), searchTerm)
  const included = comps.filter((comp) => comp.includeInValuation)
  const excluded = comps.filter((comp) => !comp.includeInValuation)
  const output = {
    generatedAt: new Date().toISOString(),
    source: 'terapeak-paste',
    marketplaceId: 'EBAY_GB',
    soldCompCount: comps.length,
    includedValuationCompCount: included.length,
    excludedCompCount: excluded.length,
    errors: [],
    comps,
    note: `Imported from copied eBay Product Research/Terapeak text: ${file}`,
  }

  await writeFile(outputPath, JSON.stringify(output, null, 2))
  console.log(`Imported ${comps.length} sold rows to ${outputPath}`)
  console.log(`Included valuation comps: ${included.length}; excluded/not target: ${excluded.length}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
