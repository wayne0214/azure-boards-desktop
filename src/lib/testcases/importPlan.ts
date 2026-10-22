import { htmlFromPlain, plain, stepsToText, textToSteps, type StepItem } from './steps'

/** Which spreadsheet column (index) holds what. The Acceptance Criteria column holds each step's expected result. */
export interface ImportMapping { sdv: number; srs: number; steps: number; criteria: number; title?: number; preconditions?: number }

export interface PlannedCase {
  sdv: string
  title: string
  /** False when the title was made up from the first step (it then never replaces an existing title). */
  titleGiven: boolean
  srsIds: number[]
  steps: StepItem[]
  /** The steps as text lines, so an update can match them against the steps already there. */
  stepsText: string
  preconditions: string
  /** The test case this SDV ID already belongs to; the import updates it. */
  existingId: number | null
  issues: string[]
}

const cell = (row: string[], i: number | undefined) => (i === undefined ? '' : String(row[i] ?? '').trim())
const EXPECTED = /\s+-\s*expected:\s*/i
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/

/** Expected results from the Acceptance Criteria column: "3. Saved" goes to step 3, unnumbered ones fill the steps in order. */
function withExpected(steps: StepItem[], lines: string[]): StepItem[] {
  const out = steps.map((s) => ({ ...s }))
  const set = (i: number, text: string) => { const s = out[i]; if (s?.kind === 'step') out[i] = { ...s, expected: htmlFromPlain(text) } }
  const loose: string[] = []
  for (const line of lines.map((l) => l.trim()).filter(Boolean)) {
    const m = NUMBERED.exec(line)
    if (m) set(Number(m[1]) - 1, m[2].trim())
    else loose.push(line)
  }
  for (const text of loose) {
    const i = out.findIndex((s) => s.kind === 'step' && !plain(s.expected).trim())
    if (i < 0) break
    set(i, text)
  }
  return out
}

/**
 * Rows from the team's spreadsheet as test cases: rows sharing an SDV ID are one case, SRS IDs are
 * matched to real requirements (unknown or removed ones are reported, never linked).
 */
export function planImport(rows: string[][], map: ImportMapping, srsByCode: Map<string, { id: number; removed: boolean }>, existingBySdv: Map<string, number>): PlannedCase[] {
  const byCode = new Map([...srsByCode].map(([k, v]) => [k.toUpperCase(), v]))
  const existing = new Map([...existingBySdv].map(([k, v]) => [k.toUpperCase(), v]))
  const cases = new Map<string, PlannedCase>()
  const acLines = new Map<string, string[]>()
  for (const row of rows) {
    const sdv = cell(row, map.sdv).toUpperCase()
    if (!sdv) continue
    const c = cases.get(sdv) ?? { sdv, title: cell(row, map.title), titleGiven: false, srsIds: [], steps: [], stepsText: '', preconditions: '', existingId: existing.get(sdv) ?? null, issues: [] }
    for (const code of cell(row, map.srs).split(/[,;/\s]+/).map((x) => x.trim().toUpperCase()).filter(Boolean)) {
      const hit = byCode.get(code)
      if (!hit) { if (!c.issues.includes(`${code} not found`)) c.issues.push(`${code} not found`) }
      else if (hit.removed) { if (!c.issues.includes(`${code} is removed`)) c.issues.push(`${code} is removed`) }
      else if (!c.srsIds.includes(hit.id)) c.srsIds.push(hit.id)
    }
    const stepText = cell(row, map.steps).split(/\r?\n/).map((l) => l.replace(EXPECTED, ' => ')).join('\n')
    c.steps.push(...textToSteps(stepText, [], new Map()))
    acLines.set(sdv, [...(acLines.get(sdv) ?? []), ...cell(row, map.criteria).split(/\r?\n/)])
    if (!c.preconditions) c.preconditions = cell(row, map.preconditions)
    cases.set(sdv, c)
  }
  return [...cases.values()].map((c0) => {
    const steps = withExpected(c0.steps, acLines.get(c0.sdv) ?? [])
    const c = { ...c0, steps, stepsText: stepsToText(steps) }
    const first = c.steps.find((s) => s.kind === 'step')
    return { ...c, titleGiven: !!c.title, title: c.title || (first?.kind === 'step' ? plain(first.action).trim().slice(0, 120) : '') || c.sdv }
  })
}
