import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const outputPath = path.join(process.cwd(), 'public', 'data', 'sold-comps.json')

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}

function parseCsv(text) {
  const rows = []
  let row = []
  let value = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (quoted && char === '"' && next === '"') {
      value += '"'
      i += 1
    } else if (char === '"') {
      quoted = !quoted
    } else if (!quoted && char === ',') {
      row.push(value)
      value = ''
    } else if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') i += 1
      row.push(value)
      if (row.some((cell) => cell.trim() !== '')) rows.push(row)
      row = []
      value = ''
    } else {
      value += char
    }
  }
  row.push(value)
  if (row.some((cell) => cell.trim() !== '')) rows.push(row)
  return rows
}

function numberFrom(value) {
  if (value == null) return 0
  const cleaned = String(value).replace(/[£,$]/g, '').trim()
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

function pick(row, headers, names) {
  for (const name of names) {
    const index = headers.findIndex((header) => header.toLowerCase() === name.toLowerCase())
    if (index >= 0) return row[index]
  }
  return ''
}

async function main() {
  const file = argValue('--file')
  const searchTerm = argValue('--search', 'Canon EF 50mm f/1.8 STM')
  if (!file) throw new Error('Use --file path\\to\\sold-comps.csv')
  const rows = parseCsv(await readFile(file, 'utf8'))
  const headers = rows.shift()?.map((header) => header.trim()) ?? []
  const comps = rows.map((row, index) => {
    const price = numberFrom(pick(row, headers, ['sold_price', 'price', 'Sold price', 'Total price']))
    const shippingPrice = numberFrom(pick(row, headers, ['shipping_price', 'shipping', 'Postage', 'Delivery']))
    return {
      source: 'csv-import',
      searchTerm: pick(row, headers, ['searchTerm', 'search_term']) || searchTerm,
      soldItemId: pick(row, headers, ['soldItemId', 'itemId', 'Item number']) || `csv-${index + 1}`,
      soldUrl: pick(row, headers, ['soldUrl', 'url', 'URL']) || '',
      title: pick(row, headers, ['title', 'Title']),
      price,
      shippingPrice,
      totalSoldValue: price + shippingPrice,
      currency: pick(row, headers, ['currency', 'Currency']) || 'GBP',
      condition: pick(row, headers, ['condition', 'Condition']),
      soldDate: pick(row, headers, ['soldDate', 'date', 'Date sold']) || null,
    }
  }).filter((comp) => comp.title && comp.totalSoldValue > 0)

  const output = {
    generatedAt: new Date().toISOString(),
    source: 'csv-import',
    marketplaceId: 'EBAY_GB',
    soldCompCount: comps.length,
    errors: [],
    comps,
    note: `Imported from ${file}`,
  }
  await writeFile(outputPath, JSON.stringify(output, null, 2))
  console.log(`Imported ${comps.length} sold comps to ${outputPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
