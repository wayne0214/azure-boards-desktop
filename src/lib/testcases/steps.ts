/** Test case steps in Azure DevOps' Microsoft.VSTS.TCM.Steps XML, plus text mode and paste helpers. */

export type StepItem =
  | { kind: 'step'; id: number | null; action: string; expected: string }
  | { kind: 'shared'; id: number | null; ref: number; title?: string }
  | { kind: 'raw'; id: number | null; xml: string }

const parseXml = (xml: string): Element | null => {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  const root = doc.documentElement
  if (!root || root.getElementsByTagName('parsererror').length > 0 || root.nodeName === 'parsererror') return null
  return root
}

const idOf = (el: Element): number | null => {
  const n = Number(el.getAttribute('id'))
  return el.hasAttribute('id') && Number.isFinite(n) ? n : null
}

const strings = (el: Element): Element[] =>
  Array.from(el.children).filter(c => c.nodeName === 'parameterizedString')

function itemOf(el: Element): StepItem {
  if (el.nodeName === 'step') {
    const [a, e] = strings(el)
    return { kind: 'step', id: idOf(el), action: a?.textContent ?? '', expected: e?.textContent ?? '' }
  }
  if (el.nodeName === 'compref') {
    return { kind: 'shared', id: idOf(el), ref: Number(el.getAttribute('ref')) }
  }
  return { kind: 'raw', id: idOf(el), xml: new XMLSerializer().serializeToString(el) }
}

export function parseSteps(xml: string | undefined): StepItem[] {
  if (!xml || !xml.trim()) return []
  const root = parseXml(xml)
  if (!root || root.nodeName !== 'steps') return []
  return Array.from(root.children).map(itemOf)
}

const same = (a: StepItem, b: StepItem): boolean => {
  if (a.kind !== b.kind || a.id !== b.id) return false
  if (a.kind === 'step' && b.kind === 'step') return a.action === b.action && b.expected === a.expected
  if (a.kind === 'shared' && b.kind === 'shared') return a.ref === b.ref
  if (a.kind === 'raw' && b.kind === 'raw') return a.xml === b.xml
  return false
}

/** Writes items back as steps XML. Elements of unchanged items (and the parts of a step we do not model) are kept from `previousXml`. */
export function serializeSteps(items: StepItem[], previousXml?: string): string {
  const prevRoot = previousXml ? parseXml(previousXml) : null
  const prevEls = new Map<number, Element>()
  if (prevRoot && prevRoot.nodeName === 'steps') {
    for (const el of Array.from(prevRoot.children)) {
      const id = idOf(el)
      if (id != null) prevEls.set(id, el)
    }
  }
  const out = new DOMParser().parseFromString('<steps/>', 'text/xml')
  const root = out.documentElement
  const ids = items.map(i => i.id).filter((n): n is number => n != null)
  const prevLast = Number(prevRoot?.getAttribute('last')) || 0
  let next = Math.max(prevLast, 0, ...ids)
  let last = 0

  for (const item of items) {
    const id = item.id ?? ++next
    last = Math.max(last, id)
    const orig = item.id != null ? prevEls.get(item.id) : undefined

    if (orig && same(itemOf(orig), item)) {
      root.appendChild(out.importNode(orig, true))
      continue
    }
    if (item.kind === 'raw') {
      const el = parseXml(item.xml)
      if (el) {
        if (item.id == null) el.setAttribute('id', String(id))
        root.appendChild(out.importNode(el, true))
      }
      continue
    }
    if (item.kind === 'shared') {
      const el = orig && orig.nodeName === 'compref' ? out.importNode(orig, true) as Element : out.createElement('compref')
      el.setAttribute('id', String(id))
      el.setAttribute('ref', String(item.ref))
      root.appendChild(el)
      continue
    }
    const el = orig && orig.nodeName === 'step' ? out.importNode(orig, true) as Element : out.createElement('step')
    el.setAttribute('id', String(id))
    el.setAttribute('type', item.expected.trim() ? 'ValidateStep' : 'ActionStep')
    const ps = strings(el)
    for (const [i, value] of [item.action, item.expected].entries()) {
      let p = ps[i]
      if (!p) {
        p = out.createElement('parameterizedString')
        p.setAttribute('isformatted', 'true')
        const desc = Array.from(el.children).find(c => c.nodeName === 'description')
        el.insertBefore(p, desc ?? null)
        ps[i] = p
      }
      p.textContent = value
      // What the grid writes is HTML; without this the portal shows the tags.
      p.setAttribute('isformatted', 'true')
    }
    if (!Array.from(el.children).some(c => c.nodeName === 'description')) el.appendChild(out.createElement('description'))
    root.appendChild(el)
  }
  root.setAttribute('id', '0')
  // Never lower "last": the portal gives new steps ids above it, so a removed step's id is never reused.
  root.setAttribute('last', String(Math.max(last, prevLast)))
  return new XMLSerializer().serializeToString(root)
}

const ENTITIES: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** HTML to plain text: block boundaries become newlines, entities are decoded. */
export const plain = (html: string): string =>
  html
    .replace(/<\/(p|div)>\s*<(p|div)\b[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?(p|div)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(code) ? String.fromCodePoint(code) : m
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/^\n+|\n+$/g, '')

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Plain text to the portal's HTML (`<P>…</P>`, `<BR/>` for newlines). */
export const htmlFromPlain = (text: string): string =>
  text.trim() ? `<P>${text.replace(/\r\n?/g, '\n').split('\n').map(escHtml).join('<BR/>')}</P>` : ''

const oneLine = (s: string) => plain(s).replace(/\s*\n\s*/g, ' ').trim()

const RAW_LINE = '(other step)'

function lineOf(item: StepItem): string {
  if (item.kind === 'shared') return `/${item.title ?? `#${item.ref}`}`
  if (item.kind === 'raw') return RAW_LINE
  const a = oneLine(item.action)
  const e = oneLine(item.expected)
  return e ? `${a} => ${e}` : a
}

export function stepsToText(items: StepItem[]): string {
  return items.map((it, i) => `${i + 1}. ${lineOf(it)}`).join('\n')
}

const NUMBERING = /^\s*\d+[.)](?:\s+|$)/

export function textToSteps(text: string, prev: StepItem[], sharedByTitle: Map<string, number>): StepItem[] {
  const lines = text.split(/\r?\n/)
    .map(l => ({ body: l.replace(NUMBERING, '').trim(), numbered: NUMBERING.test(l) }))
    .filter(l => l.body !== '' || l.numbered)
    .map(l => l.body)
  // First, lines that are unchanged keep their item.
  const used = new Set<number>()
  const match: (number | null)[] = lines.map((line) => {
    const at = prev.findIndex((old, i) => !used.has(i) && lineOf(old).trim() === line)
    if (at < 0) return null
    used.add(at)
    return at
  })
  // Then an edited line takes the id of an unclaimed step between the same unchanged neighbours,
  // so the step's description, attachments and Test Plans results stay with it.
  const isStepLine = (line: string) => line !== RAW_LINE && !(line.startsWith('/') && stepRef(line, sharedByTitle) != null)
  const reuse: (StepItem | null)[] = lines.map(() => null)
  lines.forEach((line, li) => {
    if (match[li] != null || !isStepLine(line)) return
    const before = match.slice(0, li).reduce<number>((m, x) => (x != null ? Math.max(m, x) : m), -1)
    const afterAll = match.slice(li + 1).filter((x): x is number => x != null)
    const after = afterAll.length ? Math.min(...afterAll) : prev.length
    const at = prev.findIndex((old, i) => i > before && i < after && !used.has(i) && old.kind === 'step')
    if (at < 0) return
    used.add(at)
    reuse[li] = prev[at]
  })
  const out: StepItem[] = []
  lines.forEach((line, li) => {
    const m = match[li]
    if (m != null) { out.push(prev[m]); return }
    if (line === RAW_LINE) return
    const ref = line.startsWith('/') ? stepRef(line, sharedByTitle) : undefined
    if (ref != null) { out.push({ kind: 'shared', id: null, ref }); return }
    const at = line.indexOf('=>')
    const action = (at >= 0 ? line.slice(0, at) : line).trim()
    const expected = at >= 0 ? line.slice(at + 2).trim() : ''
    out.push({ kind: 'step', id: reuse[li]?.id ?? null, action: htmlFromPlain(action), expected: htmlFromPlain(expected) })
  })
  return out
}

/** The shared steps a "/Title" line refers to. */
function stepRef(line: string, sharedByTitle: Map<string, number>): number | undefined {
  const name = line.slice(1).trim()
  return sharedByTitle.get(name) ?? (/^#\d+$/.test(name) ? Number(name.slice(1)) : undefined)
}

/** Splits tab separated text with Excel-style quoting into rows of cells. */
function cells(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let atStart = true
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else quoted = false
      } else cell += c
    } else if (c === '"' && atStart) {
      quoted = true
      atStart = false
    } else if (c === '\t') {
      row.push(cell); cell = ''; atStart = true
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''; atStart = true
    } else {
      cell += c
      atStart = false
    }
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  return rows
}

/** Rows pasted from a spreadsheet as steps; null when the text is a single plain cell. */
export function stepsFromPaste(text: string): { action: string; expected: string }[] | null {
  const rows = cells(text).filter(r => r.some(c => c.trim() !== ''))
  if (rows.length === 0 || (rows.length === 1 && rows[0].length === 1)) return null
  return rows.map(r => ({ action: r[0].replace(NUMBERING, '').trim(), expected: (r[1] ?? '').trim() }))
}

// ----- Edits made in the step grid -----

const blankStep = (): StepItem => ({ kind: 'step', id: null, action: '', expected: '' })

/** A blank step after position `i` (-1 for the top). */
export const insertStep = (items: StepItem[], i: number): StepItem[] => [...items.slice(0, i + 1), blankStep(), ...items.slice(i + 1)]

/** Move the item at `i` one place up (-1) or down (1); unchanged at the ends. */
export function moveStep(items: StepItem[], i: number, dir: -1 | 1): StepItem[] {
  const j = i + dir
  if (j < 0 || j >= items.length) return items
  const next = items.slice()
  ;[next[i], next[j]] = [next[j], next[i]]
  return next
}

/** A copy of the item at `i` right after it, as a new item. */
export const duplicateStep = (items: StepItem[], i: number): StepItem[] => [...items.slice(0, i + 1), { ...items[i], id: null }, ...items.slice(i + 1)]

export const removeStep = (items: StepItem[], i: number): StepItem[] => items.filter((_, j) => j !== i)

/** Rows pasted from Excel: they replace the step at `i` when it is empty, else go after it. */
export function pasteSteps(items: StepItem[], i: number, rows: { action: string; expected: string }[]): StepItem[] {
  const cur = items[i]
  const empty = cur?.kind === 'step' && !plain(cur.action).trim() && !plain(cur.expected).trim()
  const made: StepItem[] = rows.map((r) => ({ kind: 'step', id: null, action: htmlFromPlain(r.action), expected: htmlFromPlain(r.expected) }))
  return empty ? [...items.slice(0, i), ...made, ...items.slice(i + 1)] : [...items.slice(0, i + 1), ...made, ...items.slice(i + 1)]
}

/** The chosen steps replaced by one reference to the shared steps made from them. */
export function replaceWithShared(items: StepItem[], indexes: number[], ref: number, title: string): StepItem[] {
  const at = Math.min(...indexes)
  const shared: StepItem = { kind: 'shared', id: null, ref, title }
  return items.flatMap((it, i) => (i === at ? [shared] : indexes.includes(i) ? [] : [it]))
}
