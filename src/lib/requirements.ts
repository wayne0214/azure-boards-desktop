import { customFieldsFor, descriptionField, fieldKind, idLikeField, verificationMethodField } from './customFields'
import { csvEscape, htmlToText, tagsOf } from './format'
import type { FieldDef, TeamContext, WorkItem, WorkItemType } from './types'

/** One level of the requirements hierarchy: UN (Epic), DI (Feature), SRS (Requirement). */
export interface Tier {
  level: 0 | 1 | 2
  type: WorkItemType
  /** Short label used across the view, from the ID field: "UN", "DI", "SRS". */
  label: string
  /** The type's own ID field, e.g. Custom.UNID ("UN ID"). Typed by hand. */
  idField?: FieldDef
  /** The type's main text: for SRS the "Software Requirement Specification" field. */
  textField?: FieldDef
}

export interface ReqConfig {
  tiers: [Tier, Tier, Tier]
  acceptanceField?: FieldDef
  riskField?: FieldDef
  /** How each SRS is verified: Test, Inspection, Analysis or Demonstration. */
  methodField?: FieldDef
  /** Fields to fetch beyond the standard set. */
  extraFields: string[]
}

const ACCEPTANCE = 'Microsoft.VSTS.Common.AcceptanceCriteria'
const REQ_TYPES = ['Requirement', 'User Story', 'Product Backlog Item']

/** Work out the hierarchy and its fields from the project's process; null if it has no Epic > Feature > Requirement. */
export function reqConfig(ctx: TeamContext | null): ReqConfig | null {
  if (!ctx) return null
  const byName = (n: string) => ctx.workItemTypes.find((t) => t.name === n && !t.isDisabled)
  const epic = byName('Epic')
  const feature = byName('Feature')
  const req = REQ_TYPES.map(byName).find(Boolean)
  if (!epic || !feature || !req) return null
  const tier = (level: 0 | 1 | 2, type: WorkItemType, fallback: string): Tier => {
    const idField = idLikeField(type)
    const label = idField?.name.replace(/\s*(id|no|number|ref|code)\s*$/i, '').trim() || fallback
    const text = descriptionField(ctx, type) ?? (level === 2 ? undefined : { referenceName: 'System.Description', name: 'Description' })
    return { level, type, label, idField, textField: text }
  }
  const tiers: [Tier, Tier, Tier] = [tier(0, epic, 'UN'), tier(1, feature, 'DI'), tier(2, req, 'SRS')]
  if (!tiers[2].textField) tiers[2].textField = { referenceName: 'System.Description', name: 'Description' }
  const reqDefs = req.fieldDefs ?? []
  const acceptanceField = reqDefs.find((f) => f.referenceName === ACCEPTANCE) ?? customFieldsFor(req).find((f) => /acceptance/i.test(f.name) && fieldKind(ctx, f) === 'html')
  const riskField = customFieldsFor(req).find((f) => /\brisk\b/i.test(f.name))
  const methodField = verificationMethodField(req)
  const extraFields = [...new Set([
    ...tiers.flatMap((t) => [t.idField?.referenceName, t.textField?.referenceName]),
    acceptanceField?.referenceName,
    riskField?.referenceName,
    methodField?.referenceName,
  ].filter((x): x is string => !!x))]
  return { tiers, acceptanceField, riskField, methodField, extraFields }
}

export interface ReqNode {
  item: WorkItem
  tier: Tier
  children: ReqNode[]
  /** Open bugs whose parent is this requirement. */
  bugs: WorkItem[]
  /** Tasks whose parent is this requirement (SRS rows only). */
  tasks: WorkItem[]
  /** Open change requests that Affect this item. */
  changes: WorkItem[]
  /** Tasks in this node's subtree and how many are done: the "Build" progress. */
  taskTotal: number
  taskDone: number
  /** Requirements under this node and how many of them are finished. */
  total: number
  done: number
  gaps: string[]
}

export interface ReqTree {
  roots: ReqNode[]
  /** DIs with no UN, and SRSs with no DI, shown in their own groups. */
  orphanDis: ReqNode[]
  orphanSrs: ReqNode[]
  byId: Map<number, ReqNode>
}

export const fieldText = (item: WorkItem, ref: string | undefined) => (ref ? String(item.fields[ref] ?? '').trim() : '')
/** Plain text of a field that may be stored as rich text (some ID fields come back as "<div>SRS-001</div>"). */
export function plainText(v: unknown): string {
  return String(v ?? '')
    .replace(/<br\s*\/?>|<\/(div|p|li)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

export const idOf = (n: ReqNode) => plainText(n.item.fields[n.tier.idField?.referenceName ?? ''])
const parentOf = (i: WorkItem) => (typeof i.fields['System.Parent'] === 'number' ? (i.fields['System.Parent'] as number) : null)

/** Natural order by the typed ID (UN-2 before UN-10), items without an ID last, then by work item number. */
function byReqId(a: ReqNode, b: ReqNode): number {
  const x = idOf(a)
  const y = idOf(b)
  if (x && y) return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }) || a.item.id - b.item.id
  if (x || y) return x ? -1 : 1
  return a.item.id - b.item.id
}

export function isFinished(types: WorkItemType[], item: WorkItem): boolean {
  const t = types.find((x) => x.name === item.fields['System.WorkItemType'])
  const st = t?.states.find((s) => s.name === item.fields['System.State'])
  return st ? st.category === 'Completed' || st.category === 'Removed' : /^(closed|done|completed|removed)$/i.test(String(item.fields['System.State']))
}

// ----- Tasks: who builds what -----

/** Disciplines a task can belong to, set by tag. Order is how they are shown. */
export const DISCIPLINES = ['FE', 'BE', 'QA'] as const
export type Discipline = (typeof DISCIPLINES)[number]
const PREFIX = /^\s*\[(FE|BE|QA)\]\s*[:\-–]?\s*/i

/** A task's discipline: from its tag, or (while the team moves to tags) from a "[FE]" title prefix. */
export function disciplineOf(task: WorkItem): { d: Discipline | null; fromPrefix: boolean } {
  const tags = tagsOf(task).map((t) => t.toUpperCase())
  const tagged = DISCIPLINES.find((d) => tags.includes(d))
  if (tagged) return { d: tagged, fromPrefix: false }
  const m = PREFIX.exec(String(task.fields['System.Title'] ?? ''))
  return m ? { d: m[1].toUpperCase() as Discipline, fromPrefix: true } : { d: null, fromPrefix: false }
}

/** The title without a "[FE] " style prefix. */
export const titleWithoutPrefix = (title: string) => title.replace(PREFIX, '')

/** A task counts as done once it is resolved or closed. */
export function isTaskDone(types: WorkItemType[], task: WorkItem): boolean {
  const t = types.find((x) => x.name === task.fields['System.WorkItemType'])
  const st = t?.states.find((s) => s.name === task.fields['System.State'])
  return st ? ['Resolved', 'Completed', 'Removed'].includes(st.category) : /^(resolved|closed|done|completed|removed)$/i.test(String(task.fields['System.State']))
}

export type DisciplineState = 'done' | 'active' | 'todo'

/** Per discipline under one SRS: done when all its tasks are, active once any has started. */
export function disciplineSummary(types: WorkItemType[], tasks: WorkItem[]): { d: Discipline | 'Other'; state: DisciplineState; done: number; total: number }[] {
  const groups = new Map<Discipline | 'Other', WorkItem[]>()
  for (const t of tasks) {
    const d = disciplineOf(t).d ?? 'Other'
    groups.set(d, [...(groups.get(d) ?? []), t])
  }
  const order: (Discipline | 'Other')[] = [...DISCIPLINES, 'Other']
  return order.filter((d) => groups.has(d)).map((d) => {
    const list = groups.get(d)!
    const done = list.filter((t) => isTaskDone(types, t)).length
    const started = list.some((t) => !/^(new|proposed|to do)$/i.test(String(t.fields['System.State'])))
    return { d, done, total: list.length, state: done === list.length ? 'done' : started || done > 0 ? 'active' : 'todo' }
  })
}

// ----- Change requests and issues -----

export const AFFECTS = 'Microsoft.VSTS.Common.Affects-Forward'
const PARENT_LINK = 'System.LinkTypes.Hierarchy-Reverse'
const idFromUrl = (url: string) => Number(url.split('/').pop())

/** Ids an item links to, optionally only for some link types. */
export function linkedIds(item: WorkItem, rels?: string[]): number[] {
  return (item.relations ?? []).filter((r) => r.rel.startsWith('System.LinkTypes') || r.rel.startsWith('Microsoft.VSTS')).filter((r) => !rels || rels.includes(r.rel)).map((r) => idFromUrl(r.url)).filter(Number.isFinite)
}

/** Tasks an open issue holds up: anything the issue links to except its own parent. */
export function blockedBy(issues: WorkItem[]): Map<number, WorkItem[]> {
  const out = new Map<number, WorkItem[]>()
  for (const i of issues) for (const id of linkedIds(i).filter((x) => x !== parentIdOfItem(i))) out.set(id, [...(out.get(id) ?? []), i])
  return out
}

export function parentIdOfItem(i: WorkItem): number | null {
  if (typeof i.fields['System.Parent'] === 'number') return i.fields['System.Parent'] as number
  const r = i.relations?.find((x) => x.rel === PARENT_LINK)
  return r ? idFromUrl(r.url) : null
}

/**
 * A change request or issue that is really a piece of work: it has hours, an FE/BE/QA mark,
 * or sits directly under a requirement like a task does. Returns why, or null.
 */
export function looksLikeTask(w: WorkItem, srsIds: Set<number>): string | null {
  const reasons: string[] = []
  const p = parentIdOfItem(w)
  if (p !== null && srsIds.has(p)) reasons.push('under a requirement')
  const left = w.fields['Microsoft.VSTS.Scheduling.RemainingWork']
  if (typeof left === 'number' && left > 0) reasons.push(`${left}h remaining`)
  const d = disciplineOf(w)
  if (d.d) reasons.push(d.fromPrefix ? `[${d.d}] in title` : `${d.d} tag`)
  return reasons.length ? reasons.join(' · ') : null
}

export function buildTree(cfg: ReqConfig, types: WorkItemType[], items: WorkItem[], bugs: WorkItem[], tasks: WorkItem[] = [], changes: WorkItem[] = []): ReqTree {
  const tierOf = new Map(cfg.tiers.map((t) => [t.type.name, t]))
  const byId = new Map<number, ReqNode>()
  for (const item of items) {
    const tier = tierOf.get(String(item.fields['System.WorkItemType']))
    if (tier) byId.set(item.id, { item, tier, children: [], bugs: [], tasks: [], changes: [], total: 0, done: 0, taskTotal: 0, taskDone: 0, gaps: [] })
  }
  for (const c of changes) for (const id of linkedIds(c, [AFFECTS])) byId.get(id)?.changes.push(c)
  for (const t of tasks) {
    const p = parentOf(t)
    const n = p !== null ? byId.get(p) : undefined
    if (n && n.tier.level === 2) n.tasks.push(t)
  }
  for (const b of bugs) {
    const p = parentOf(b)
    const n = p !== null ? byId.get(p) : undefined
    if (n) n.bugs.push(b)
  }
  const roots: ReqNode[] = []
  const orphanDis: ReqNode[] = []
  const orphanSrs: ReqNode[] = []
  for (const n of byId.values()) {
    const p = parentOf(n.item)
    const parent = p !== null ? byId.get(p) : undefined
    // Only a link to the level directly above counts; anything else is shown as unlinked.
    if (parent && parent.tier.level === n.tier.level - 1) parent.children.push(n)
    else if (n.tier.level === 0) roots.push(n)
    else if (n.tier.level === 1) orphanDis.push(n)
    else orphanSrs.push(n)
  }
  const finish = (n: ReqNode) => {
    n.children.sort(byReqId)
    n.children.forEach(finish)
    if (n.tier.level === 2) {
      n.total = 1
      n.done = isFinished(types, n.item) ? 1 : 0
      n.tasks.sort((a, b) => (DISCIPLINES.indexOf(disciplineOf(a).d as Discipline) + 1 || 9) - (DISCIPLINES.indexOf(disciplineOf(b).d as Discipline) + 1 || 9) || a.id - b.id)
      n.taskTotal = n.tasks.length
      n.taskDone = n.tasks.filter((t) => isTaskDone(types, t)).length
    } else {
      n.total = n.children.reduce((a, c) => a + c.total, 0)
      n.done = n.children.reduce((a, c) => a + c.done, 0)
      n.taskTotal = n.children.reduce((a, c) => a + c.taskTotal, 0)
      n.taskDone = n.children.reduce((a, c) => a + c.taskDone, 0)
    }
    n.gaps = gapsOf(cfg, n)
  }
  for (const list of [roots, orphanDis, orphanSrs]) { list.sort(byReqId); list.forEach(finish) }
  return { roots, orphanDis, orphanSrs, byId }
}

function gapsOf(cfg: ReqConfig, n: ReqNode): string[] {
  const g: string[] = []
  const below = cfg.tiers[n.tier.level + 1]
  if (n.tier.idField && !idOf(n)) g.push(`No ${n.tier.idField.name}`)
  if (below && n.children.length === 0) g.push(`No ${below.label}`)
  if (n.tier.level === 2) {
    if (!htmlToText(fieldText(n.item, n.tier.textField?.referenceName))) g.push(`No ${n.tier.textField?.name ?? 'specification'}`)
    if (cfg.acceptanceField && !htmlToText(fieldText(n.item, cfg.acceptanceField.referenceName))) g.push('No acceptance criteria')
    if (cfg.methodField && !fieldText(n.item, cfg.methodField.referenceName)) g.push('No verification method')
  }
  return g
}

/** Every node of the tree, parents before children (unlinked groups last). */
export function walk(tree: ReqTree): ReqNode[] {
  const out: ReqNode[] = []
  const go = (n: ReqNode) => { out.push(n); n.children.forEach(go) }
  for (const list of [tree.roots, tree.orphanDis, tree.orphanSrs]) list.forEach(go)
  return out
}

// ----- Document (reference for writing the SRS) -----

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Columns of the SRS table, as the team writes it: SRS ID, specification, acceptance criteria, DI ID. */
export function srsColumns(cfg: ReqConfig): { key: string; label: string }[] {
  const [, di, srs] = cfg.tiers
  return [
    { key: 'id', label: srs.idField?.name ?? `${srs.label} ID` },
    { key: 'spec', label: srs.textField?.name ?? 'Specification' },
    ...(cfg.acceptanceField ? [{ key: 'ac', label: cfg.acceptanceField.name }] : []),
    { key: 'di', label: di.idField?.name ?? `${di.label} ID` },
  ]
}

function srsTable(cfg: ReqConfig, rows: ReqNode[], diId: (n: ReqNode) => string): string {
  if (rows.length === 0) return ''
  const cols = srsColumns(cfg)
  const cell = (n: ReqNode, key: string) => {
    if (key === 'id') return esc(idOf(n) || `#${n.item.id}`)
    if (key === 'spec') {
      const spec = fieldText(n.item, n.tier.textField?.referenceName) || `<em>${esc(String(n.item.fields['System.Title'] ?? ''))}</em>`
      // A pending change means this text may not be final; say so in the document itself.
      const pending = n.changes.map((c) => `<p class="doc-change">Change pending: CR #${c.id} ${esc(String(c.fields['System.Title'] ?? ''))}</p>`).join('')
      return spec + pending
    }
    if (key === 'ac') return fieldText(n.item, cfg.acceptanceField?.referenceName)
    return esc(diId(n))
  }
  return `<table class="srs-table"><thead><tr>${cols.map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows
    .map((n) => `<tr data-id="${n.item.id}">${cols.map((c) => `<td class="c-${c.key}">${cell(n, c.key)}</td>`).join('')}</tr>`)
    .join('')}</tbody></table>`
}

/**
 * The tree as a numbered document: a heading per UN and DI with their text, and under each DI
 * the SRS table. Rich text stays as Azure DevOps stores it, so it pastes into Word with formatting.
 */
export function buildDocument(cfg: ReqConfig, tree: ReqTree, opts: { rootId?: number | null; projectName: string }): string {
  const [un, di] = cfg.tiers
  const heading = (n: ReqNode) => `${idOf(n) ? `${esc(idOf(n))} ` : ''}${esc(String(n.item.fields['System.Title'] ?? ''))}`
  const text = (n: ReqNode) => {
    const html = fieldText(n.item, n.tier.textField?.referenceName)
    return htmlToText(html) || /<img\b/i.test(html) ? `<div class="doc-text">${html}</div>` : ''
  }
  const out: string[] = []
  const roots = opts.rootId ? tree.roots.filter((r) => r.item.id === opts.rootId) : tree.roots
  roots.forEach((u, i) => {
    const num = opts.rootId ? tree.roots.indexOf(u) + 1 : i + 1
    out.push(`<h2 data-id="${u.item.id}">${num}&ensp;${heading(u)}</h2>${text(u)}`)
    if (u.children.length === 0) out.push(`<p class="doc-gap">No ${esc(di.label)} under this ${esc(un.label)} yet.</p>`)
    u.children.forEach((d, j) => {
      out.push(`<h3 data-id="${d.item.id}">${num}.${j + 1}&ensp;${heading(d)}</h3>${text(d)}`)
      out.push(d.children.length ? srsTable(cfg, d.children, () => idOf(d)) : `<p class="doc-gap">No ${esc(cfg.tiers[2].label)} under this ${esc(di.label)} yet.</p>`)
    })
  })
  if (!opts.rootId && tree.orphanDis.length) {
    out.push(`<h2>${esc(di.label)} without a ${esc(un.label)}</h2>`)
    for (const d of tree.orphanDis) out.push(`<h3 data-id="${d.item.id}">${heading(d)}</h3>${text(d)}${srsTable(cfg, d.children, () => idOf(d))}`)
  }
  if (!opts.rootId && tree.orphanSrs.length) {
    out.push(`<h2>${esc(cfg.tiers[2].label)} without a ${esc(di.label)}</h2>`)
    out.push(srsTable(cfg, tree.orphanSrs, () => ''))
  }
  return out.join('\n')
}

const csvCell = csvEscape

/** One row per SRS with its DI and UN, plain text, for Excel. */
export function buildCsv(cfg: ReqConfig, tree: ReqTree): string {
  const [un, di, srs] = cfg.tiers
  const head = [un.idField?.name ?? 'UN ID', `${un.label} title`, di.idField?.name ?? 'DI ID', `${di.label} title`, srs.idField?.name ?? 'SRS ID', `${srs.label} title`, srs.textField?.name ?? 'Specification', ...(cfg.acceptanceField ? [cfg.acceptanceField.name] : []), 'State', 'Work item']
  const lines = [head.map(csvCell).join(',')]
  const row = (u: ReqNode | null, d: ReqNode | null, s: ReqNode) => lines.push([
    u ? idOf(u) : '', u?.item.fields['System.Title'] ?? '', d ? idOf(d) : '', d?.item.fields['System.Title'] ?? '',
    idOf(s), s.item.fields['System.Title'], htmlToText(fieldText(s.item, s.tier.textField?.referenceName)),
    ...(cfg.acceptanceField ? [htmlToText(fieldText(s.item, cfg.acceptanceField.referenceName))] : []),
    s.item.fields['System.State'], s.item.id,
  ].map(csvCell).join(','))
  for (const u of tree.roots) for (const d of u.children) for (const s of d.children) row(u, d, s)
  for (const d of tree.orphanDis) for (const s of d.children) row(null, d, s)
  for (const s of tree.orphanSrs) row(null, null, s)
  return lines.join('\r\n') + '\r\n'
}
