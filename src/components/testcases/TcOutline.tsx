import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, FlaskConical, Info, Loader2, Plus, Search, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Empty } from '@/components/ui/Empty'
import { idOf, plainText, type ReqNode, type ReqTree } from '@/lib/requirements'
import { hasSteps, type Coverage, type SrsCoverage, type TcFilter } from '@/lib/testcases/coverage'
import type { TcConfig } from '@/lib/testcases/config'
import type { WorkItem } from '@/lib/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useTcStore } from '@/store/useTcStore'
import { TcEditor } from './TcEditor'
import { useUiStore } from '@/store/useUiStore'

const FILTERS: { v: TcFilter; l: string }[] = [
  { v: 'all', l: 'All' },
  { v: 'uncovered', l: 'No test case' },
  { v: 'review', l: 'Needs review' },
  { v: 'nosteps', l: 'No steps' },
  { v: 'mine', l: 'Mine' },
]

const METHOD_NOTE_KEY = 'tc.methodNote.dismissed'

type Row =
  | { kind: 'group'; key: string; label: string }
  | { kind: 'di'; key: string; node: ReqNode }
  | { kind: 'srs'; key: string; cov: SrsCoverage; depth: number; parent: string | null }
  | { kind: 'tc'; key: string; test: WorkItem; srsId: number | null; depth: number; parent: string | null }
  | { kind: 'add'; key: string; srsId: number; label: string; depth: number }

type NavRow = Extract<Row, { kind: 'di' | 'srs' | 'tc' }>

const itemIdOf = (r: NavRow) => (r.kind === 'di' ? r.node.item.id : r.kind === 'srs' ? r.cov.node.item.id : r.test.id)
const sdvOf = (cfg: TcConfig, t: WorkItem) => (cfg.sdvField ? plainText(t.fields[cfg.sdvField.referenceName]) : '')
const titleOf = (w: WorkItem) => String(w.fields['System.Title'] ?? '')

/** Outline mode: DI > SRS > test case, with the coverage of each SRS, and an editor panel on the right. */
export function TcOutline({ tree, coverage, srsTypeName, labels }: { tree: ReqTree; coverage: Coverage; srsTypeName: string; labels: { di: string; srs: string } }) {
  const s = useTcStore(useShallow((st) => ({ cfg: st.cfg, collapsed: st.collapsed, create: st.create, creating: st.creating, filter: st.filter, reviewNeeded: st.reviewNeeded, search: st.search, select: st.select, selectedId: st.selectedId, setCollapsedAll: st.setCollapsedAll, setFilter: st.setFilter, setSearch: st.setSearch, tests: st.tests, toggle: st.toggle })))
  const cfg = s.cfg!
  const me = useAppStore((st) => st.account())
  const listRef = useRef<HTMLDivElement>(null)
  // A test case linked to two SRS shows twice, so the cursor is the row, not just the item.
  const [cursor, setCursor] = useState<string | null>(null)

  const srsOfDi = (di: ReqNode) => di.children.map((n) => coverage.bySrs.get(n.item.id)).filter((c): c is SrsCoverage => !!c)
  const isMine = (w: WorkItem) => {
    const a = w.fields['System.AssignedTo'] as { id?: string; displayName?: string } | undefined
    return !!a && !!me && (a.id === me.userId || a.displayName === me.userName)
  }

  const counts = useMemo(() => ({
    uncovered: [...coverage.bySrs.values()].filter((c) => c.needsTest && c.tests.length === 0).length,
    nosteps: s.tests.filter((t) => !hasSteps(t)).length,
    review: s.reviewNeeded.size,
  }), [coverage, s.tests, s.reviewNeeded])

  const rows = useMemo(() => {
    const q = s.search.trim().toLowerCase()
    const filtering = s.filter !== 'all' || !!q
    const tcOk = (t: WorkItem) => {
      if (s.filter === 'uncovered') return false
      if (s.filter === 'review' && !s.reviewNeeded.has(t.id)) return false
      if (s.filter === 'nosteps' && hasSteps(t)) return false
      if (s.filter === 'mine' && !isMine(t)) return false
      return !q || `${sdvOf(cfg, t)} ${titleOf(t)} ${t.id}`.toLowerCase().includes(q)
    }
    const srsOk = (c: SrsCoverage) => {
      if (s.filter === 'uncovered') { if (!(c.needsTest && c.tests.length === 0)) return false }
      else if (s.filter !== 'all') return false
      return !q || `${idOf(c.node)} ${titleOf(c.node.item)} ${c.node.item.id}`.toLowerCase().includes(q)
    }

    const out: Row[] = []
    const addSrs = (c: SrsCoverage, depth: number, parent: string | null) => {
      const id = c.node.item.id
      const hit = srsOk(c)
      // A matching SRS shows all its test cases; otherwise only the matching ones, for context.
      const tests = filtering && !(hit && s.filter === 'all') ? c.tests.filter(tcOk) : c.tests
      if (filtering && !hit && tests.length === 0) return 0
      const key = `s${id}`
      out.push({ kind: 'srs', key, cov: c, depth, parent })
      if (filtering || !s.collapsed.has(id)) tests.forEach((t) => out.push({ kind: 'tc', key: `t${id}-${t.id}`, test: t, srsId: id, depth: depth + 1, parent: key }))
      if (c.needsTest && c.tests.length === 0) out.push({ kind: 'add', key: `a${id}`, srsId: id, label: idOf(c.node) || `#${id}`, depth: depth + 1 })
      return 1
    }
    const addDi = (di: ReqNode) => {
      const key = `d${di.item.id}`
      const at = out.length
      out.push({ kind: 'di', key, node: di })
      if (!filtering && s.collapsed.has(di.item.id)) return
      const shown = srsOfDi(di).reduce((n, c) => n + addSrs(c, 1, key), 0)
      if (filtering && shown === 0) out.splice(at, 1)
    }
    tree.roots.forEach((un) => un.children.forEach(addDi))
    tree.orphanDis.forEach(addDi)
    const orphans = tree.orphanSrs.map((n) => coverage.bySrs.get(n.item.id)).filter((c): c is SrsCoverage => !!c)
    if (orphans.length) {
      const at = out.length
      out.push({ kind: 'group', key: 'gsrs', label: `${labels.srs} without a ${labels.di}` })
      if (orphans.reduce((n, c) => n + addSrs(c, 0, null), 0) === 0) out.splice(at, 1)
    }
    const unlinked = filtering ? coverage.unlinked.filter(tcOk) : coverage.unlinked
    if (unlinked.length) {
      out.push({ kind: 'group', key: 'gnone', label: 'Not linked to any SRS' })
      unlinked.forEach((t) => out.push({ kind: 'tc', key: `tu-${t.id}`, test: t, srsId: null, depth: 0, parent: null }))
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, coverage, cfg, s.filter, s.search, s.collapsed, me, labels.di, labels.srs])

  const navRows = rows.filter((r): r is NavRow => r.kind === 'di' || r.kind === 'srs' || r.kind === 'tc')
  const isSel = (r: NavRow) => (cursor ? r.key === cursor : itemIdOf(r) === s.selectedId)
  const pick = (r: NavRow) => { setCursor(r.key); s.select(itemIdOf(r)) }
  const go = (r: NavRow | undefined) => { if (r) { pick(r); listRef.current?.querySelector(`[data-row="${r.key}"]`)?.scrollIntoView({ block: 'nearest' }) } }
  const foldable = (r: NavRow) => (r.kind === 'di' ? r.node.children.length > 0 : r.kind === 'srs' ? r.cov.tests.length > 0 : false)
  const filtering = s.filter !== 'all' || !!s.search.trim()

  const newTestFor = (r: NavRow) => {
    if (r.kind === 'srs') void s.create(r.cov.node.item.id)
    else if (r.kind === 'tc') void s.create(r.srsId)
  }
  // Space: a test case opens in the editor; a DI or SRS in the details panel.
  const open = (r: NavRow) => {
    pick(r)
    if (r.kind === 'tc') return
    void useBoardStore.getState().openItem(r.kind === 'di' ? r.node.item : r.cov.node.item)
    useUiStore.getState().toggleInspector(true)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('input, textarea')) return
    const i = navRows.findIndex(isSel)
    const cur = i >= 0 ? navRows[i] : null
    if (e.key === 'ArrowDown') { e.preventDefault(); go(navRows[Math.min(navRows.length - 1, i + 1)]) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(navRows[i < 0 ? 0 : Math.max(0, i - 1)]) }
    else if (e.key === 'ArrowRight' && cur) { e.preventDefault(); if (!filtering && foldable(cur) && s.collapsed.has(itemIdOf(cur))) s.toggle(itemIdOf(cur)) }
    else if (e.key === 'ArrowLeft' && cur) {
      e.preventDefault()
      if (!filtering && foldable(cur) && !s.collapsed.has(itemIdOf(cur))) s.toggle(itemIdOf(cur))
      else if (cur.kind !== 'di' && cur.parent) go(navRows.find((r) => r.key === cur.parent))
    }
    else if (e.key === 'Enter' && cur) { e.preventDefault(); newTestFor(cur) }
    else if (e.key === ' ' && cur) { e.preventDefault(); open(cur) }
  }

  const parents = [
    ...[...tree.byId.values()].filter((n) => n.tier.level === 1 && n.children.length).map((n) => n.item.id),
    ...[...coverage.bySrs.values()].filter((c) => c.tests.length).map((c) => c.node.item.id),
  ]
  const anyOpen = parents.some((id) => !s.collapsed.has(id))
  const { covered, needingTest } = coverage.stats
  const pct = needingTest ? Math.round((covered / needingTest) * 100) : 0
  const selected = s.tests.find((t) => t.id === s.selectedId) ?? null

  return (
    <div className="tc-split">
      <aside className="tc-tree">
        <div className="tc-cov">
          <div><b>Coverage</b> <span className="faint">{covered} / {needingTest} SRS have a test case</span></div>
          <div className="tc-cov-bar"><i style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="tc-bar">
          <div className="search-box">
            <Search size={14} />
            <input value={s.search} onChange={(e) => s.setSearch(e.target.value)} placeholder="Find by SDV, SRS ID or title" onKeyDown={(e) => e.key === 'Escape' && s.setSearch('')} />
            {s.search && <button type="button" className="clear" onClick={() => s.setSearch('')}><X size={13} /></button>}
          </div>
          <button type="button" className="icon-btn" title={anyOpen ? 'Collapse all' : 'Expand all'} onClick={() => s.setCollapsedAll(anyOpen ? parents : [])}>
            {anyOpen ? <ChevronsDownUp size={16} /> : <ChevronsUpDown size={16} />}
          </button>
        </div>
        <div className="tc-filters">
          {FILTERS.map((f) => {
            const n = f.v === 'uncovered' ? counts.uncovered : f.v === 'nosteps' ? counts.nosteps : f.v === 'review' ? counts.review : 0
            return (
              <button key={f.v} type="button" className={`tc-chip ${s.filter === f.v ? 'on' : ''}`} onClick={() => s.setFilter(f.v)}>
                {f.l}{n > 0 && ` (${n})`}
              </button>
            )
          })}
        </div>
        {!cfg.methodField && <MethodNote srsTypeName={srsTypeName} />}

        <div className="tc-body" ref={listRef} tabIndex={0} onKeyDown={onKey}>
          {rows.length === 0 ? (
            filtering ? <Empty title="Nothing matches">Try another filter or search.</Empty> : (
              <Empty icon={<FlaskConical size={28} />} title="No test cases yet">Write requirements first, then a test case for each SRS that needs one.</Empty>
            )
          ) : (
            <div className="tc-list" role="tree">
              {rows.map((r) => {
                if (r.kind === 'group') return <div key={r.key} className="req-group">{r.label}</div>
                if (r.kind === 'add') {
                  return (
                    <button key={r.key} type="button" className="tc-add" style={{ paddingLeft: 10 + r.depth * 18 + 20 }} disabled={s.creating} onClick={() => void s.create(r.srsId)}>
                      {s.creating ? <><Loader2 size={12} className="spin" /> Creating test case…</> : <><Plus size={12} /> Write a test case for {r.label}</>}
                    </button>
                  )
                }
                const sel = isSel(r)
                const id = itemIdOf(r)
                const unfolded = filtering || !s.collapsed.has(id)
                const common = {
                  'data-row': r.key,
                  role: 'treeitem',
                  onClick: () => pick(r),
                }
                if (r.kind === 'di') {
                  return (
                    <div key={r.key} {...common} aria-expanded={unfolded} className={`req-row tc-row tc-di ${sel ? 'sel' : ''}`} style={{ paddingLeft: 6 }}>
                      <Chevron show={foldable(r)} open={unfolded} onClick={() => !filtering && s.toggle(id)} />
                      <span className="req-id">{idOf(r.node) || `#${id}`}</span>
                      <span className="req-name" title={titleOf(r.node.item)}>{titleOf(r.node.item)}</span>
                    </div>
                  )
                }
                if (r.kind === 'srs') {
                  const c = r.cov
                  return (
                    <div key={r.key} {...common} aria-expanded={foldable(r) ? unfolded : undefined} className={`req-row tc-row ${sel ? 'sel' : ''}`} style={{ paddingLeft: 6 + r.depth * 18 }}>
                      <Chevron show={foldable(r)} open={unfolded} onClick={() => !filtering && s.toggle(id)} />
                      <span className="req-id">{idOf(c.node) || `#${id}`}</span>
                      <span className="req-name" title={titleOf(c.node.item)}>{titleOf(c.node.item)}</span>
                      {c.needsTest
                        ? <span className={`tc-pill ${c.tests.length ? 'ok' : 'no'}`} title={`${c.tests.length} test case${c.tests.length === 1 ? '' : 's'}`}>{c.tests.length}</span>
                        : <span className="tc-pill method" title="Verified without a test case">{c.removed ? 'Removed' : c.method}</span>}
                    </div>
                  )
                }
                const t = r.test
                const outcome = cfg.lastOutcomeField ? String(t.fields[cfg.lastOutcomeField.referenceName] ?? '') : ''
                const sdv = sdvOf(cfg, t)
                return (
                  <div key={r.key} {...common} className={`req-row tc-row tc-case ${sel ? 'sel' : ''}`} style={{ paddingLeft: 6 + r.depth * 18 + 20 }}>
                    <i className="tc-ic" />
                    <span className={`req-id ${sdv ? '' : 'missing'}`}>{sdv || `#${t.id}`}</span>
                    <span className="req-name" title={titleOf(t)}>{titleOf(t)}</span>
                    {(outcome === 'Passed' || outcome === 'Failed') && <i className={`tc-dot ${outcome === 'Passed' ? 'pass' : 'fail'}`} title={`Last run: ${outcome}`} />}
                    {s.reviewNeeded.has(t.id) && <span className="tc-pill warn" title="A linked SRS changed after this test case was last reviewed">review</span>}
                    {r.srsId === null && <span className="tc-pill no">no SRS</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </aside>
      <section className="tc-editor">
        {selected ? <TcEditor key={selected.id} cfg={cfg} test={selected} tree={tree} /> : <Empty icon={<FlaskConical size={28} />} title="Select a test case">Pick a test case on the left to read and edit it.</Empty>}
      </section>
    </div>
  )
}

function Chevron({ show, open, onClick }: { show: boolean; open: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`req-chev ${show ? '' : 'none'}`} tabIndex={-1} onClick={(e) => { e.stopPropagation(); onClick() }}>
      {show ? (open ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : null}
    </button>
  )
}

/** Without a Verification Method field every SRS needs a test; says how to add the field. */
function MethodNote({ srsTypeName }: { srsTypeName: string }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(METHOD_NOTE_KEY) === '1' } catch { return false } })
  if (hidden) return null
  const dismiss = () => { try { localStorage.setItem(METHOD_NOTE_KEY, '1') } catch { /* ignore */ } setHidden(true) }
  return (
    <div className="ts-note tc-note">
      <Info size={15} />
      <span className="msg">
        Every SRS is treated as needing a test, because the {srsTypeName} type has no Verification Method field.
        A process admin can add a picklist field named Verification Method (Test, Inspection, Analysis, Demonstration) to the {srsTypeName} type.
      </span>
      <button type="button" className="icon-btn sm" title="Dismiss" onClick={dismiss}><X size={14} /></button>
    </div>
  )
}
