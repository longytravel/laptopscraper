import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

const defaultSource = 'G:\\My Drive\\resale-arbitrage\\lens-packs\\canon-ef-50mm-f-1-8-stm\\codex-mini-assessments.json'
const target = path.join(process.cwd(), 'public', 'data', 'family-assessments.json')

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name)
  return index >= 0 ? (process.argv[index + 1] ?? fallback) : fallback
}

async function main() {
  const source = argValue('--source', defaultSource)
  const text = (await readFile(source, 'utf8')).replace(/^\uFEFF/, '')
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed.assessments)) throw new Error('Assessment file is missing assessments array.')
  for (const item of parsed.assessments) {
    for (const field of ['sourceListingId', 'packIndex', 'decision', 'conditionGrade', 'valueMultiplier', 'confidence']) {
      if (item[field] == null) throw new Error(`Assessment missing ${field}: ${JSON.stringify(item).slice(0, 200)}`)
    }
  }
  await writeFile(target, JSON.stringify(parsed, null, 2))
  console.log(`Synced ${parsed.assessments.length} assessments to ${target}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
