import { Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Sheet } from '@/components/ui/Sheet'
import { tagsOf } from '@/lib/format'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { usePlanStore } from '@/store/usePlanStore'
import { useUiStore } from '@/store/useUiStore'
import type { PlanLookups } from './lookups'

const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')

/** Requirements that have at least one test case, in ID order. */
function testedRequirements(lookups: PlanLookups): { id: number; label: string; title: string; tests: number }[] {
  const n = new Map<number, number>()
  for (const c of lookups.cases.values()) for (const id of c.srsIds) n.set(id, (n.get(id) ?? 0) + 1)
  return [...n.entries()]
    .map(([id, tests]) => ({ id, tests, label: lookups.reqs.get(id)?.label ?? `#${id}`, title: lookups.reqs.get(id)?.title ?? '' }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}

const suiteName = (r: { label: string; title: string }) => (r.title ? `${r.label} : ${r.title}` : r.label).slice(0, 256)

function ConfigPicker({ value, onChange, note }: { value: number[]; onChange: (ids: number[]) => void; note: string }) {
  const configs = usePlanStore((s) => s.configurations)
  if (!configs.length) return null
  return (
    <div className="form-row">
      <label>Configurations</label>
      <div>
        <div className="check-list tp-checks">
          {configs.map((c) => (
            <label key={c.id}><input type="checkbox" checked={value.includes(c.id)} onChange={(e) => onChange(e.target.checked ? [...value, c.id] : value.filter((x) => x !== c.id))} /> {c.name}{c.isDefault ? <span className="faint"> (default)</span> : null}</label>
          ))}
        </div>
        <p className="faint tp-note">{note}</p>
      </div>
    </div>
  )
}

type Fill = 'vv' | 'requirements' | 'all' | 'none'

export function NewPlanSheet({ lookups, onClose }: { lookups: PlanLookups; onClose: () => void }) {
  const project = useAppStore((s) => s.selectedProject?.name ?? '')
  const ctx = useBoardStore((s) => s.ctx)
  const configs = usePlanStore((s) => s.configurations)
  const plans = usePlanStore((s) => s.plans)
  const toast = useUiStore((u) => u.toast)
  const iterations = ctx?.iterations ?? []
  // One plan for the whole project: it spans every version, so it sits on the project's root iteration.
  const [name, setName] = useState(`${project} – V&V`)
  const [iteration, setIteration] = useState(project)
  const [area, setArea] = useState(project)
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [configIds, setConfigIds] = useState<number[]>(() => configs.filter((c) => c.isDefault).map((c) => c.id))
  const reqs = useMemo(() => testedRequirements(lookups), [lookups])
  const [fill, setFill] = useState<Fill>('vv')
  const [busy, setBusy] = useState<string | null>(null)

  const pickIteration = (path: string) => {
    setIteration(path)
    const it = iterations.find((i) => i.path === path)
    if (it?.attributes?.startDate) setStart(day(it.attributes.startDate))
    if (it?.attributes?.finishDate) setEnd(day(it.attributes.finishDate))
  }

  const create = async () => {
    const st = usePlanStore.getState()
    setBusy('Creating the plan…')
    const plan = await st.createPlan({ name: name.trim(), iteration, areaPath: area.trim() || project, startDate: start ? `${start}T00:00:00Z` : undefined, endDate: end ? `${end}T00:00:00Z` : undefined, configurationIds: configIds })
    if (!plan) { setBusy(null); return }
    let failed = 0
    if (fill === 'vv') {
      // Verification: the product meets its requirements. Validation: it meets the users' needs.
      setBusy('Adding Verification and Validation…')
      const verification = await st.createSuite(plan.rootSuiteId, 'Verification')
      if (!(await st.createSuite(plan.rootSuiteId, 'Validation'))) failed++
      if (!verification) failed++
      else {
        for (const [i, r] of reqs.entries()) {
          setBusy(`Adding requirement suites: ${i + 1} of ${reqs.length}…`)
          if (!(await st.createSuite(verification.id, suiteName(r), { requirementId: r.id }))) failed++
        }
      }
    } else if (fill === 'requirements') {
      for (const [i, r] of reqs.entries()) {
        setBusy(`Adding suites: ${i + 1} of ${reqs.length}…`)
        if (!(await st.createSuite(plan.rootSuiteId, suiteName(r), { requirementId: r.id }))) failed++
      }
    } else if (fill === 'all') {
      setBusy('Adding the test cases…')
      if (!(await st.addCases(plan.rootSuiteId, [...lookups.tests.keys()]))) failed++
    }
    // Suites and points made above were created after the plan was opened.
    await st.openPlan(plan.id)
    toast({ kind: failed ? 'error' : 'success', title: `Created ${plan.name}`, detail: failed ? `${failed} suite${failed === 1 ? '' : 's'} could not be added.` : undefined })
    onClose()
  }

  return (
    <Sheet
      title="New test plan"
      onClose={onClose}
      footer={<>{busy && <span className="faint grow">{busy}</span>}<button type="button" className="btn" onClick={onClose} disabled={!!busy}>Cancel</button><button type="button" className="btn primary" onClick={() => void create()} disabled={!!busy || !name.trim()}>Create plan</button></>}
    >
      <div className="form-row"><label htmlFor="tp-name">Name</label><input id="tp-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${project} – V&V`} autoFocus /></div>
      {plans.some((p) => p.name.trim().toLowerCase() === name.trim().toLowerCase())
        ? <p className="tp-note tp-indent tp-warn">A plan with this name already exists; give this one another name.</p>
        : <p className="faint tp-note tp-indent">One plan for the project. Each build you test (0.3.0, 0.4.0, 1.0.0…) is a version in it, tagged on every run.</p>}
      <div className="form-row">
        <label htmlFor="tp-iter">Iteration</label>
        {iterations.length ? (
          <select id="tp-iter" className="input" value={iteration} onChange={(e) => pickIteration(e.target.value)}>
            <option value={project}>{project}</option>
            {iterations.map((i) => <option key={i.id} value={i.path}>{i.path}{i.attributes?.timeFrame === 'current' ? ' (current)' : ''}</option>)}
          </select>
        ) : <input id="tp-iter" className="input" value={iteration} onChange={(e) => setIteration(e.target.value)} />}
      </div>
      <div className="form-row"><label htmlFor="tp-area">Area</label><input id="tp-area" className="input" value={area} onChange={(e) => setArea(e.target.value)} /></div>
      <div className="form-row">
        <label>Dates</label>
        <div className="form-inline"><input className="input tp-date" type="date" value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start" /> to <input className="input tp-date" type="date" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="End" /></div>
      </div>
      <ConfigPicker value={configIds} onChange={setConfigIds} note="Each test case gets a point per configuration, such as one per operating system or browser. None ticked uses the project default." />
      <div className="form-row">
        <label>Suites</label>
        <div className="check-list tp-checks">
          <label><input type="radio" checked={fill === 'vv'} onChange={() => setFill('vv')} /> V&amp;V: <b>Verification</b> with a suite per requirement ({reqs.length}), and <b>Validation</b> <span className="faint">recommended</span></label>
          <label><input type="radio" checked={fill === 'requirements'} disabled={!reqs.length} onChange={() => setFill('requirements')} /> One suite per requirement with test cases ({reqs.length})</label>
          <label><input type="radio" checked={fill === 'all'} onChange={() => setFill('all')} /> All {lookups.tests.size} test cases in one suite</label>
          <label><input type="radio" checked={fill === 'none'} onChange={() => setFill('none')} /> Empty; I'll add suites myself</label>
        </div>
      </div>
    </Sheet>
  )
}

export type NewSuiteKind = 'static' | 'requirement' | 'tag'

export function NewSuiteSheet({ kind, parentId, lookups, onClose }: { kind: NewSuiteKind; parentId: number; lookups: PlanLookups; onClose: () => void }) {
  const suites = usePlanStore((s) => s.suites)
  const toast = useUiStore((u) => u.toast)
  const [name, setName] = useState('')
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const inPlan = useMemo(() => new Set(suites.map((x) => x.requirementId).filter((x): x is number => x != null)), [suites])
  const reqs = useMemo(() => testedRequirements(lookups), [lookups])
  const shown = reqs.filter((r) => !q.trim() || `${r.label} ${r.title}`.toLowerCase().includes(q.trim().toLowerCase()))
  const [tag, setTag] = useState('')
  // Tags on the project's test cases, with how many carry each.
  const tags = useMemo(() => {
    const n = new Map<string, number>()
    for (const t of lookups.tests.values()) for (const x of tagsOf(t)) n.set(x, (n.get(x) ?? 0) + 1)
    return [...n.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [lookups.tests])
  const tagged = tags.find(([t]) => t.toLowerCase() === tag.trim().toLowerCase())?.[1] ?? 0

  const create = async () => {
    const st = usePlanStore.getState()
    if (kind === 'static' || kind === 'tag') {
      setBusy('Creating…')
      const ok = await st.createSuite(parentId, name.trim() || tag.trim(), kind === 'tag' ? { tag: tag.trim() } : undefined)
      if (ok) { st.selectSuite(ok.id); onClose() } else setBusy(null)
      return
    }
    const list = reqs.filter((r) => picked.has(r.id))
    let made = 0
    for (const [i, r] of list.entries()) {
      setBusy(`Adding ${i + 1} of ${list.length}…`)
      if (await st.createSuite(parentId, suiteName(r), { requirementId: r.id })) made++
    }
    await st.loadAllPoints({ force: true })
    toast({ kind: made === list.length ? 'success' : 'error', title: `Added ${made} requirement suite${made === 1 ? '' : 's'}` })
    onClose()
  }

  return (
    <Sheet
      title={kind === 'static' ? 'New suite' : kind === 'tag' ? 'New tag-based suite' : 'Add requirement suites'}
      onClose={onClose}
      footer={<>{busy && <span className="faint grow">{busy}</span>}<button type="button" className="btn" onClick={onClose} disabled={!!busy}>Cancel</button><button type="button" className="btn primary" disabled={!!busy || (kind === 'static' ? !name.trim() : kind === 'tag' ? !tag.trim() : !picked.size)} onClick={() => void create()}>{kind !== 'requirement' ? 'Create suite' : `Add ${picked.size || ''} suite${picked.size === 1 ? '' : 's'}`}</button></>}
    >
      {kind === 'tag' ? (
        <>
          <p className="faint tp-note">A tag-based suite holds every test case with the tag, and keeps up as tags change: tag a test case "Smoke" in Test Cases and it joins the Smoke suite.</p>
          <div className="form-row">
            <label htmlFor="tp-tag">Tag</label>
            <div>
              <input id="tp-tag" className="input" list="tp-tags" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Smoke" autoFocus />
              <datalist id="tp-tags">{tags.map(([t, n]) => <option key={t} value={t}>{`${n} test case${n === 1 ? '' : 's'}`}</option>)}</datalist>
              <p className="faint tp-note">{tag.trim() ? `${tagged} test case${tagged === 1 ? '' : 's'} have this tag now.` : 'Pick a tag your test cases use, or a new one.'}</p>
            </div>
          </div>
          <div className="form-row"><label htmlFor="tp-suite">Name</label><input id="tp-suite" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={tag.trim() || 'Same as the tag'} onKeyDown={(e) => e.key === 'Enter' && tag.trim() && void create()} /></div>
        </>
      ) : kind === 'static' ? (
        <div className="form-row"><label htmlFor="tp-suite">Name</label><input id="tp-suite" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Smoke, Regression, Windows only…" autoFocus onKeyDown={(e) => e.key === 'Enter' && name.trim() && void create()} /></div>
      ) : (
        <>
          <p className="faint tp-note">A requirement suite holds the test cases linked to the requirement by Tested By, and keeps up as links change.</p>
          <div className="search-box tp-search"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a requirement" autoFocus />{q && <button type="button" className="clear" onClick={() => setQ('')}><X size={13} /></button>}</div>
          <div className="tp-pick-list">
            {shown.map((r) => (
              <label key={r.id} className={`tp-pick ${inPlan.has(r.id) ? 'off' : ''}`}>
                <input type="checkbox" disabled={inPlan.has(r.id)} checked={picked.has(r.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n })} />
                <span className="tp-id">{r.label}</span><span className="tp-pick-title">{r.title}</span>
                <span className="faint">{inPlan.has(r.id) ? 'in this plan' : `${r.tests} test case${r.tests === 1 ? '' : 's'}`}</span>
              </label>
            ))}
            {!shown.length && <div className="faint tc-run-empty">No requirement with test cases matches.</div>}
          </div>
        </>
      )}
    </Sheet>
  )
}

export function AddCasesSheet({ suiteId, lookups, onClose }: { suiteId: number; lookups: PlanLookups; onClose: () => void }) {
  const st = usePlanStore()
  const suite = st.suites.find((x) => x.id === suiteId)
  const inSuite = useMemo(() => new Set((st.points[suiteId] ?? []).map((p) => p.testCaseId)), [st.points, suiteId])
  const [q, setQ] = useState('')
  const [req, setReq] = useState<number | ''>('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [configIds, setConfigIds] = useState<number[]>([])
  const [busy, setBusy] = useState(false)
  const reqs = useMemo(() => testedRequirements(lookups), [lookups])
  const all = useMemo(() => [...lookups.tests.values()].sort((a, b) => lookups.label(a.id).localeCompare(lookups.label(b.id), undefined, { numeric: true })), [lookups])
  const shown = all.filter((t) => {
    const text = `${lookups.label(t.id)} ${t.id} ${String(t.fields['System.Title'] ?? '')}`.toLowerCase()
    return (!q.trim() || text.includes(q.trim().toLowerCase())) && (req === '' || (lookups.cases.get(t.id)?.srsIds ?? []).includes(req))
  })
  const free = shown.filter((t) => !inSuite.has(t.id))

  const add = async () => {
    setBusy(true)
    const ok = await st.addCases(suiteId, [...picked], configIds.length ? configIds : undefined)
    setBusy(false)
    if (ok) { useUiStore.getState().toast({ kind: 'success', title: `Added ${picked.size} test case${picked.size === 1 ? '' : 's'} to ${suite?.name ?? 'the suite'}` }); onClose() }
  }

  return (
    <Sheet
      title={`Add test cases to ${suite?.name ?? 'suite'}`}
      size="wide"
      onClose={onClose}
      footer={<><span className="faint grow">{picked.size} chosen</span><button type="button" className="btn" onClick={onClose}>Cancel</button><button type="button" className="btn primary" disabled={busy || !picked.size} onClick={() => void add()}>{busy ? 'Adding…' : 'Add'}</button></>}
    >
      <div className="form-inline tp-search-row">
        <div className="search-box"><Search size={14} /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by ID or title" autoFocus />{q && <button type="button" className="clear" onClick={() => setQ('')}><X size={13} /></button>}</div>
        <select className="input tp-filter" value={req} onChange={(e) => setReq(e.target.value ? Number(e.target.value) : '')} aria-label="Requirement">
          <option value="">Any requirement</option>
          {reqs.map((r) => <option key={r.id} value={r.id}>{r.label} · {r.title}</option>)}
        </select>
        <span className="grow" />
        <button type="button" className="btn sm" disabled={!free.length} onClick={() => setPicked((s) => new Set([...s, ...free.map((t) => t.id)]))}>Choose all {free.length}</button>
      </div>
      <div className="tp-pick-list tall">
        {shown.map((t) => (
          <label key={t.id} className={`tp-pick ${inSuite.has(t.id) ? 'off' : ''}`}>
            <input type="checkbox" disabled={inSuite.has(t.id)} checked={picked.has(t.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n })} />
            <span className="tp-id">{lookups.label(t.id)}</span><span className="tp-pick-title">{String(t.fields['System.Title'] ?? '')}</span>
            {inSuite.has(t.id) && <span className="faint">in this suite</span>}
          </label>
        ))}
        {!shown.length && <div className="faint tc-run-empty">{lookups.tests.size ? 'No test case matches.' : 'No test cases loaded for this project.'}</div>}
      </div>
      <ConfigPicker value={configIds} onChange={setConfigIds} note="None ticked uses the suite's configurations." />
    </Sheet>
  )
}
