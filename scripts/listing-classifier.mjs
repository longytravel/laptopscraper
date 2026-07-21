export const exclusionPhrases = new Map([
  ['parts only', 'parts-only'],
  ['for parts', 'parts-only'],
  ['spares or repair', 'spares-repair'],
  ['spares repair', 'spares-repair'],
  ['faulty', 'faulty'],
  ['untested', 'untested'],
  ['manual only', 'accessory-only'],
  ['instruction manual', 'accessory-only'],
  ['user manual', 'accessory-only'],
  ['manual for', 'accessory-only'],
  ['box only', 'accessory-only'],
  ['cap only', 'accessory-only'],
  ['caps only', 'accessory-only'],
  ['hood only', 'accessory-only'],
  ['case only', 'accessory-only'],
  ['adapter only', 'accessory-only'],
])

export const riskPhrases = [
  'fungus',
  'haze',
  'scratch',
  'scratches',
  'dust',
  'autofocus issue',
  'af is not as refined',
  'not as accurate',
  'not smooth',
  '*read*',
  'stabilization issue',
  'dropped',
  'stiff zoom',
  'stiff focus',
  'oil on aperture',
  'missing rear cap',
  'missing front cap',
  'no test body',
  'untested',
  'stock photos',
  'poor photos',
  'paint coming off',
  'paint loss',
  'paint wear',
  'cosmetic wear',
  'heavy wear',
  'well used',
  'marks on body',
  'wear to barrel',
]

export function exclusionReasonFromTextAndAspects(title, description = '', aspects = []) {
  const haystack = `${title} ${description}`.toLowerCase()
  const phraseReason = [...exclusionPhrases.entries()].find(([phrase]) => haystack.includes(phrase))?.[1] ?? null
  if (phraseReason) return phraseReason

  if (/\blens\s+hood\b.*\(\s*only\s*\)/i.test(title)) return 'accessory-only'
  if (/\bhood\s+for\b/i.test(title) || /\blens\s+hood\s+for\b/i.test(title)) return 'accessory-only'
  if (/\binstruction\s+manual\b|\bowners?\s+guide\b/i.test(title)) return 'accessory-only'

  const aspectMap = new Map((aspects ?? []).map((aspect) => [String(aspect.name ?? '').toLowerCase(), String(aspect.value ?? '').toLowerCase()]))
  const type = aspectMap.get('type') ?? ''
  if (['lens hood', 'lens cap', 'filter', 'adapter', 'case', 'manual'].some((accessory) => type.includes(accessory))) {
    return 'accessory-only'
  }
  return null
}

export function riskFlagsFromText(title, description = '') {
  const haystack = `${title} ${description}`.toLowerCase()
  return riskPhrases.filter((phrase) => haystack.includes(phrase))
}
