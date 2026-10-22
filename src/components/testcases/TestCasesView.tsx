import { FileSpreadsheet, FileText, FlaskConical, ListTree, PlayCircle, RefreshCw } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useState } from 'react'
import { Empty } from '@/components/ui/Empty'
import { buildTree, type ReqTree } from '@/lib/requirements'
import { buildCoverage } from '@/lib/testcases/coverage'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { ensureReqLoaded, useReqStore } from '@/store/useReqStore'
import { ensureTcLoaded, useTcStore, type TcMode } from '@/store/useTcStore'
import { TcDocument } from './TcDocument'
import { TcImportSheet } from './TcImportSheet'
import { RunView } from './RunView'
import { TcOutline } from './TcOutline'

const MODES: { v: TcMode; l: string; icon: typeof ListTree }[] = [
  { v: 'outline', l: 'Outline', icon: ListTree },
  { v: 'document', l: 'Document', icon: FileText },
  { v: 'run', l: 'Run', icon: PlayCircle },
]

const EMPTY_TREE: ReqTree = { roots: [], orphanDis: [], orphanSrs: [], byId: new Map() }

/** The project's test cases, grouped under the SRS they verify. */
export function TestCasesView() {
  const project = useAppStore((s) => s.selectedProject)
  const ctx = useBoardStore((s) => s.ctx)
  const ctxLoading = useAppStore((s) => s.contextLoading)
  const req = useReqStore()
  const s = useTcStore(useShallow((st) => ({ cfg: st.cfg, error: st.error, load: st.load, loadedAt: st.loadedAt, loading: st.loading, mode: st.mode, setMode: st.setMode, tests: st.tests })))
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (!project || !ctx) return
    ensureReqLoaded(project.name, ctx)
    ensureTcLoaded(project.name, ctx)
  }, [project, ctx])

  const types = useMemo(() => ctx?.workItemTypes ?? [], [ctx])
  // Without a requirement hierarchy every test case is simply unlinked.
  const tree = useMemo(() => (req.cfg ? buildTree(req.cfg, types, req.items, req.bugs, req.tasks, req.changes) : EMPTY_TREE), [req.cfg, types, req.items, req.bugs, req.tasks, req.changes])
  // Look for SRS changes once both lists are in, and again when either changes.
  useEffect(() => {
    if (!s.loadedAt || !req.loadedAt) return
    const t = window.setTimeout(() => void useTcStore.getState().checkReviews(), 300)
    return () => window.clearTimeout(t)
  }, [s.tests, req.items, s.loadedAt, req.loadedAt])

  const coverage = useMemo(() => (s.cfg ? buildCoverage(s.cfg, types, tree, s.tests) : null), [s.cfg, types, tree, s.tests])

  if (!project) return <Empty title="Choose a project">Pick a project in the sidebar to see its test cases.</Empty>
  if (!ctx || (ctxLoading && !s.cfg)) return <div className="empty-state"><span className="spinner lg" /><p>Loading {project.name}…</p></div>
  if (!s.cfg) {
    return (
      <Empty icon={<FlaskConical size={28} />} title="This project's process has no Test Case type">
        Test cases need the Test Case work item type, which Azure DevOps processes include by default.
      </Empty>
    )
  }

  const srsLabel = req.cfg?.tiers[2].label ?? 'SRS'
  const labels = { di: req.cfg?.tiers[1].label ?? 'DI', srs: srsLabel }
  const loading = (s.loading && s.tests.length === 0) || (req.loading && req.items.length === 0)
  const reload = () => { void s.load(); void req.load() }

  return (
    <div className="req">
      <div className="req-head">
        <div className="req-title">
          <strong>Test Cases</strong>
          {coverage && !loading && <span className="faint">{s.tests.length} SDV · covering {coverage.stats.covered} of {coverage.stats.needingTest} {srsLabel}</span>}
        </div>
        <div className="segmented">
          {MODES.map(({ v, l, icon: Icon }) => (
            <button key={v} type="button" className={s.mode === v ? 'on' : ''} onClick={() => s.setMode(v)}><Icon size={14} /> {l}</button>
          ))}
        </div>
        <span className="grow" />
        {coverage && <button type="button" className="btn" onClick={() => setImporting(true)}><FileSpreadsheet size={14} /> Import</button>}
        <button type="button" className="icon-btn" title="Reload" onClick={reload} disabled={s.loading}><RefreshCw size={16} className={s.loading ? 'spin' : ''} /></button>
      </div>

      {s.error && (
        <div className="ts-note danger">
          <span className="msg">{s.error}</span>
          <button type="button" className="btn sm primary" onClick={() => void s.load()}>Try again</button>
        </div>
      )}

      {loading ? (
        <div className="empty-state"><span className="spinner lg" /><p>Loading test cases…</p></div>
      ) : coverage && s.mode === 'outline' ? (
        <TcOutline tree={tree} coverage={coverage} srsTypeName={req.cfg?.tiers[2].type.name ?? 'Requirement'} labels={labels} />
      ) : coverage && s.mode === 'document' && req.cfg ? (
        <TcDocument cfg={s.cfg} reqCfg={req.cfg} tree={tree} coverage={coverage} projectName={project.name} />
      ) : coverage && s.mode === 'run' && req.cfg ? (
        <RunView cfg={s.cfg} reqCfg={req.cfg} tree={tree} coverage={coverage} />
      ) : (
        <Empty title="Requirements needed">This view needs the project's requirement hierarchy.</Empty>
      )}
      {importing && coverage && <TcImportSheet coverage={coverage} onClose={() => setImporting(false)} />}
    </div>
  )
}
