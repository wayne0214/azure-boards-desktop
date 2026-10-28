import { idOf, plainText, type ReqConfig, type ReqNode, type ReqTree } from '../requirements'
import { csvEscape } from '../format'
import type { WorkItem } from '../types'
import { STEPS, type TcConfig } from './config'
import type { Coverage } from './coverage'
import { parseTestData } from './params'
import type { RunRecord } from './run'
import { parseSteps, plain } from './steps'

export interface DocOptions {
  projectName: string
  rootDiId?: number | null
  /** With a release, each test case shows its outcome there and screenshots go to an appendix. */
  release?: string | null
  runs?: Map<number, RunRecord>
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const titleOf = (w: WorkItem) => String(w.fields['System.Title'] ?? '')
const sdvOf = (cfg: TcConfig, t: WorkItem) => (cfg.sdvField ? plainText(t.fields[cfg.sdvField.referenceName]) : '') || `#${t.id}`
const codeOf = (n: ReqNode) => idOf(n) || `#${n.item.id}`

/** The DIs in document order (under each UN, then those with no UN), each with its number. */
function dis(tree: ReqTree, rootDiId?: number | null): { di: ReqNode; num: number }[] {
  const all = [...tree.roots.flatMap((u) => u.children), ...tree.orphanDis].map((di, i) => ({ di, num: i + 1 }))
  return rootDiId ? all.filter((d) => d.di.item.id === rootDiId) : all
}

/** A test case's steps with shared steps written out, as [action, expected] HTML pairs. */
/** Steps in run order, shared steps expanded. `stepId` is what a step result names: "2", or "3;2" inside shared steps. */
export function flatSteps(t: WorkItem, shared: Map<number, WorkItem>): { action: string; expected: string; from?: string; stepId?: string }[] {
  return parseSteps(t.fields[STEPS] as string | undefined).flatMap((it) => {
    if (it.kind === 'step') return [{ action: it.action, expected: it.expected, stepId: it.id != null ? String(it.id) : undefined }]
    if (it.kind === 'shared') {
      const sh = shared.get(it.ref)
      const inner = parseSteps(sh?.fields[STEPS] as string | undefined).filter((x) => x.kind === 'step')
      return inner.map((x) => ({ action: x.kind === 'step' ? x.action : '', expected: x.kind === 'step' ? x.expected : '', from: sh ? titleOf(sh) : `Shared steps #${it.ref}`, stepId: it.id != null && x.id != null ? `${it.id};${x.id}` : undefined }))
    }
    return []
  })
}

function testDataRow(t: WorkItem): [string, string][] {
  const d = parseTestData(t.fields['Microsoft.VSTS.TCM.Parameters'] as string | undefined, t.fields['Microsoft.VSTS.TCM.LocalDataSource'] as string | undefined)
  if (!d.names.length || !d.rows.length) return []
  return [['Test data', d.names.map((n) => `@${esc(n)} = ${d.rows.map((r) => esc(r[n] ?? '')).join('; ')}`).join('<br>')]]
}

/** Rich text from a step or field, flattened so it sits inside a list item or cell. */
const inline = (html: string) => html.replace(/<\/?(p|div)\b[^>]*>/gi, ' ').replace(/\s+/g, ' ').trim()

const COLUMNS = ['SDV ID', 'SRS ID', 'Test Steps', 'Acceptance Criteria', 'Test Outcome']

function stepsCell(cfg: TcConfig, t: WorkItem, shared: Map<number, WorkItem>): string {
  const pre = String(t.fields[cfg.preconditionsField.referenceName] ?? '')
  const steps = flatSteps(t, shared)
  const data = testDataRow(t)
  return [
    plain(pre).trim() ? `<p><b>Preconditions:</b> ${inline(pre)}</p>` : '',
    steps.length
      ? `<ol>${steps.map((st, i) => `<li value="${i + 1}">${inline(st.action)}${st.from ? ` <em>(${esc(st.from)})</em>` : ''}</li>`).join('')}</ol>`
      : '<p class="doc-gap">No steps yet.</p>',
    data.length ? `<p><b>Test data:</b> ${data[0][1]}</p>` : '',
  ].join('')
}

/** What each step expects, numbered to match its step: that is what the test case accepts. */
function acceptanceCell(t: WorkItem, shared: Map<number, WorkItem>): string {
  const expected = flatSteps(t, shared).map((st, i) => ({ n: i + 1, html: inline(st.expected) })).filter((x) => plain(x.html).trim())
  return expected.length ? `<ol>${expected.map((x) => `<li value="${x.n}">${x.html}</li>`).join('')}</ol>` : ''
}

function outcomeCell(t: WorkItem, opts: DocOptions): string {
  if (!opts.release) return ''
  const r = opts.runs?.get(t.id)
  if (!r) return '<span class="doc-outcome none">Not run</span>'
  return `<span class="doc-outcome ${r.outcome}">${r.outcome === 'pass' ? 'Pass' : 'Fail'}</span><br><small>${esc(r.release)} · ${esc(r.date)} · ${esc(r.by)}</small>`
}

function testTable(cfg: TcConfig, cov: Coverage, tests: WorkItem[], shared: Map<number, WorkItem>, opts: DocOptions): string {
  const rows = tests.map((t) => {
    return `<tr data-id="${t.id}"><td class="c-id">${esc(sdvOf(cfg, t))}</td><td class="c-srs">${esc(srsCodesOf(cov, t).join(', '))}</td>`
      + `<td class="c-steps">${stepsCell(cfg, t, shared)}</td>`
      + `<td class="c-ac">${acceptanceCell(t, shared)}</td>`
      + `<td class="c-outcome">${outcomeCell(t, opts)}</td></tr>`
  })
  return `<table class="srs-table tc-table"><thead><tr>${COLUMNS.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
}

const srsCodesOf = (cov: Coverage, t: WorkItem) => [...cov.bySrs.values()].filter((c) => c.tests.includes(t)).map((c) => codeOf(c.node))
const bySdv = (cfg: TcConfig) => (a: WorkItem, b: WorkItem) => sdvOf(cfg, a).localeCompare(sdvOf(cfg, b), undefined, { numeric: true })
const heading = (n: ReqNode) => `${idOf(n) ? `${esc(idOf(n))} ` : ''}${esc(titleOf(n.item))}`

/**
 * The test specification, laid out like the SRS document: a numbered heading per UN and DI, and under
 * each DI one table of the test cases verifying its SRS. A test case appears once, under the first DI.
 */
export function buildTestDocument(cfg: TcConfig, reqCfg: ReqConfig, tree: ReqTree, cov: Coverage, shared: Map<number, WorkItem>, opts: DocOptions): string {
  const written = new Set<number>()
  const out: string[] = []
  const testsUnder = (srsList: ReqNode[]) => {
    const list = srsList.flatMap((srs) => cov.bySrs.get(srs.item.id)?.tests ?? []).filter((t) => !written.has(t.id))
    const unique = [...new Map(list.map((t) => [t.id, t])).values()].sort(bySdv(cfg))
    unique.forEach((t) => written.add(t.id))
    return unique
  }
  const diBlock = (di: ReqNode, num: string) => {
    out.push(`<h3 data-id="${di.item.id}">${num ? `${num}&ensp;` : ''}${heading(di)}</h3>`)
    const tests = testsUnder(di.children)
    out.push(tests.length ? testTable(cfg, cov, tests, shared, opts) : `<p class="doc-gap">No test cases under this ${esc(reqCfg.tiers[1].label)} yet.</p>`)
  }
  tree.roots.forEach((un, i) => {
    const dis = un.children.filter((d) => !opts.rootDiId || d.item.id === opts.rootDiId)
    if (opts.rootDiId && dis.length === 0) return
    out.push(`<h2 data-id="${un.item.id}">${i + 1}&ensp;${heading(un)}</h2>`)
    un.children.forEach((di, j) => { if (dis.includes(di)) diBlock(di, `${i + 1}.${j + 1}`) })
  })
  const orphanDis = tree.orphanDis.filter((d) => !opts.rootDiId || d.item.id === opts.rootDiId)
  if (orphanDis.length) {
    out.push(`<h2>${esc(reqCfg.tiers[1].label)} without a ${esc(reqCfg.tiers[0].label)}</h2>`)
    orphanDis.forEach((di) => diBlock(di, ''))
  }
  if (!opts.rootDiId) {
    const loose = testsUnder(tree.orphanSrs)
    if (loose.length) out.push(`<h2>${esc(reqCfg.tiers[2].label)} without a ${esc(reqCfg.tiers[1].label)}</h2>${testTable(cfg, cov, loose, shared, opts)}`)
    const unlinked = cov.unlinked.filter((t) => !written.has(t.id)).sort(bySdv(cfg))
    unlinked.forEach((t) => written.add(t.id))
    if (unlinked.length) out.push(`<h2>Not linked to any ${esc(reqCfg.tiers[2].label)}</h2>${testTable(cfg, cov, unlinked, shared, opts)}`)
  }
  if (opts.release && opts.runs) {
    const byId = new Map([...cov.bySrs.values()].flatMap((c) => c.tests).concat(cov.unlinked).map((t) => [t.id, t]))
    const withImages = [...written].map((id) => ({ t: byId.get(id), run: opts.runs!.get(id) })).filter((x) => x.t && x.run?.images.length)
    if (withImages.length) {
      out.push(`<h2>Evidence – ${esc(opts.release)}</h2>`)
      for (const { t, run } of withImages) {
        out.push(`<h4>${esc(sdvOf(cfg, t!))}&ensp;${esc(titleOf(t!))}</h4>${run!.images.map((im) => `<p><img src="${esc(im.url)}" alt="${esc(im.caption)}"><br><em>${esc(im.caption)}</em></p>`).join('')}`)
      }
    }
  }
  return out.join('\n')
}

/** SRS → the test cases that verify it, its other verification method, or a gap. */
export function buildMatrix(reqCfg: ReqConfig, tree: ReqTree, cov: Coverage, cfg: TcConfig, opts: { rootDiId?: number | null } = {}): string {
  const srsList = [...dis(tree, opts.rootDiId).flatMap(({ di }) => di.children), ...(opts.rootDiId ? [] : tree.orphanSrs)]
  const rows = srsList.map((srs) => {
    const c = cov.bySrs.get(srs.item.id)
    if (!c || c.removed) return ''
    const by = !c.needsTest
      ? `<td class="m-method">${esc(c.method ?? '')}</td>`
      : c.tests.length
        ? `<td>${c.tests.map((t) => esc(sdvOf(cfg, t))).join(', ')}</td>`
        : '<td class="m-gap">Not covered</td>'
    return `<tr data-id="${srs.item.id}"><td class="c-id">${esc(codeOf(srs))}</td><td>${esc(titleOf(srs.item))}</td>${by}</tr>`
  })
  return `<table class="srs-table tc-matrix"><thead><tr><th>${esc(reqCfg.tiers[2].label)} ID</th><th>${esc(reqCfg.tiers[2].label)}</th><th>Verified by</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
}

const csvCell = csvEscape

/** One row per test case in the team's Excel columns. */
export function buildTestCsv(cfg: TcConfig, _reqCfg: ReqConfig, _tree: ReqTree, cov: Coverage, shared: Map<number, WorkItem>, runs?: Map<number, RunRecord>): string {
  const tests = [...new Map([...cov.bySrs.values()].flatMap((c) => c.tests).concat(cov.unlinked).map((t) => [t.id, t])).values()]
    .sort((a, b) => sdvOf(cfg, a).localeCompare(sdvOf(cfg, b), undefined, { numeric: true }))
  const lines = [['SDV ID', 'SRS ID', 'Test Steps', 'Acceptance Criteria', 'Test Outcome'].join(',')]
  for (const t of tests) {
    const flat = flatSteps(t, shared)
    const steps = flat.map((s, i) => `${i + 1}. ${plain(s.action).trim()}`).join('\n')
    // Expected results are the acceptance criteria, numbered like their steps.
    const criteria = flat.map((s, i) => (plain(s.expected).trim() ? `${i + 1}. ${plain(s.expected).trim()}` : '')).filter(Boolean).join('\n')
    const run = runs?.get(t.id)
    lines.push([sdvOf(cfg, t), srsCodesOf(cov, t).join(', '), steps, criteria, run ? (run.outcome === 'pass' ? 'Pass' : 'Fail') : ''].map(csvCell).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}
