import { plain } from './steps'

/** A test run recorded as a comment on the test case, readable by people and by the app. */

export type Outcome = 'pass' | 'fail'

export interface RunRecord {
  outcome: Outcome
  release: string
  /** YYYY-MM-DD */
  date: string
  by: string
  criteria: { text: string; met: boolean }[]
  steps: { index: number; outcome: Outcome | null }[]
  note: string
  images: { url: string; caption: string }[]
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const MET = '✅'
const UNMET = '❌'
const HEAD = /^Test run · (PASS|FAIL) · Release (.+) · (\d{4}-\d{2}-\d{2}) · (.*)$/

/** Pass only when there is at least one criterion and every one is met. */
export const canPass = (criteria: { met: boolean }[]): boolean => criteria.length > 0 && criteria.every((c) => c.met)

export function runToComment(r: RunRecord): string {
  const out = [`<p><b>Test run</b> · ${r.outcome.toUpperCase()} · Release ${esc(r.release)} · ${r.date} · ${esc(r.by)}</p>`]
  if (r.criteria.length) out.push(`<p><b>Acceptance criteria</b></p><ul>${r.criteria.map((c) => `<li>${c.met ? MET : UNMET} ${esc(c.text)}</li>`).join('')}</ul>`)
  const steps = r.steps.filter((s) => s.outcome)
  if (steps.length) out.push(`<p><b>Steps</b></p><ul>${steps.map((s) => `<li>Step ${s.index}: ${s.outcome!.toUpperCase()}</li>`).join('')}</ul>`)
  if (r.note.trim()) out.push(`<p><b>Note</b></p>${r.note.split('\n').map((l) => `<p>${esc(l)}</p>`).join('')}`)
  if (r.images.length) out.push(`<p><b>Evidence</b></p>${r.images.map((i) => `<p><img src="${esc(i.url)}" alt="${esc(i.caption)}"><br>${esc(i.caption)}</p>`).join('')}`)
  return out.join('')
}

/** The run a comment records, or null for an ordinary comment. Tolerates the tag rewriting Azure DevOps does. */
export function commentToRun(html: string): RunRecord | null {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const blocks = Array.from(doc.body.children).filter((el) => (el.textContent ?? '').trim() || el.querySelector('img'))
  const head = HEAD.exec((blocks[0]?.textContent ?? '').trim())
  if (!head) return null
  const r: RunRecord = { outcome: head[1] === 'PASS' ? 'pass' : 'fail', release: head[2], date: head[3], by: head[4], criteria: [], steps: [], note: '', images: [] }
  const notes: string[] = []
  let section = ''
  for (const el of blocks.slice(1)) {
    const tag = el.tagName.toLowerCase()
    const bold = el.querySelector('b, strong')
    if (tag === 'p' && bold && bold.textContent?.trim() === el.textContent?.trim()) { section = el.textContent!.trim(); continue }
    if (section === 'Acceptance criteria' && tag === 'ul') {
      for (const li of Array.from(el.querySelectorAll('li'))) {
        const t = (li.textContent ?? '').trim()
        r.criteria.push({ met: t.startsWith(MET), text: t.replace(/^(✅|❌)\s*/u, '') })
      }
    } else if (section === 'Steps' && tag === 'ul') {
      for (const li of Array.from(el.querySelectorAll('li'))) {
        const m = /^Step (\d+): (PASS|FAIL)$/.exec((li.textContent ?? '').trim())
        if (m) r.steps.push({ index: Number(m[1]), outcome: m[2] === 'PASS' ? 'pass' : 'fail' })
      }
    } else if (section === 'Note') {
      notes.push(el.textContent ?? '')
    } else if (section === 'Evidence') {
      for (const img of Array.from(el.querySelectorAll('img'))) r.images.push({ url: img.getAttribute('src') ?? '', caption: img.getAttribute('alt') ?? '' })
    }
  }
  r.note = notes.join('\n')
  return r
}

/** What a run is judged against: each step's expected result, numbered like its step. */
export const expectedChecklist = (steps: { expected: string }[]): { n: number; text: string }[] =>
  steps.map((s, i) => ({ n: i + 1, text: plain(s.expected).trim() })).filter((x) => x.text)
