import DOMPurify from 'dompurify'
import { Copy, Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { hydrateImages } from '@/lib/attachments'
import { copyRichText, wordDocument, wordTables } from '@/lib/docExport'
import { idOf, type ReqConfig, type ReqTree } from '@/lib/requirements'
import type { TcConfig } from '@/lib/testcases/config'
import type { Coverage } from '@/lib/testcases/coverage'
import { buildMatrix, buildTestCsv, buildTestDocument } from '@/lib/testcases/document'
import type { RunRecord } from '@/lib/testcases/run'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useTcStore } from '@/store/useTcStore'
import { useUiStore } from '@/store/useUiStore'

type Kind = 'spec' | 'matrix'

/** Document mode: the test specification or the traceability matrix, generated live from Azure DevOps. */
export function TcDocument({ cfg, reqCfg, tree, coverage, projectName }: { cfg: TcConfig; reqCfg: ReqConfig; tree: ReqTree; coverage: Coverage; projectName: string }) {
  const shared = useTcStore((s) => s.shared)
  const tests = useTcStore((s) => s.tests)
  const org = useAppStore((a) => a.activeOrg)
  const toast = useUiStore((u) => u.toast)
  const [kind, setKind] = useState<Kind>('spec')
  const [rootDiId, setRootDiId] = useState<number | null>(null)
  const releases = useTcStore((s) => s.releases)
  const runsFor = useTcStore((s) => s.runsFor)
  const [release, setRelease] = useState('')
  const [runs, setRuns] = useState<Map<number, RunRecord>>(new Map())
  useEffect(() => {
    const r = release.trim()
    if (!r) { setRuns(new Map()); return }
    let live = true
    void runsFor(tests.map((t) => t.id), r).then((m) => { if (live) setRuns(m) })
    return () => { live = false }
  }, [release, tests, runsFor])
  const docRef = useRef<HTMLDivElement>(null)
  const sharedById = useMemo(() => new Map(shared.map((w) => [w.id, w])), [shared])

  const html = useMemo(
    () => (kind === 'spec' ? buildTestDocument(cfg, reqCfg, tree, coverage, sharedById, { projectName, rootDiId, release: release.trim() || null, runs }) : buildMatrix(reqCfg, tree, coverage, cfg, { rootDiId })),
    [kind, cfg, reqCfg, tree, coverage, sharedById, projectName, rootDiId, release, runs],
  )

  useEffect(() => {
    if (!docRef.current) return
    docRef.current.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, ADD_ATTR: ['data-id'] })
    if (org) hydrateImages(docRef.current, org)
  }, [html, org])

  const allDis = [...tree.roots.flatMap((u) => u.children), ...tree.orphanDis]
  const root = rootDiId ? tree.byId.get(rootDiId) : undefined
  const title = `${projectName} – ${kind === 'spec' ? 'Software Design Verification' : 'Traceability Matrix'}${root ? ` – ${idOf(root)}` : ''}`

  const copy = () => {
    const ok = docRef.current ? copyRichText(docRef.current) : false
    toast(ok ? { kind: 'success', title: 'Copied', detail: 'Paste into Word or your verification template.' } : { kind: 'error', title: 'Could not copy' })
  }
  const saveWord = async () => {
    const path = await api().pickSavePath(`${title}.doc`, { name: 'Word document', extensions: ['doc'] })
    if (!path) return
    // The on-screen copy has its images inlined, so the file carries the screenshots too.
    const body = docRef.current?.cloneNode(true) as HTMLElement | undefined
    if (body) wordTables(body)
    await api().writeTextFile(path, wordDocument(title, body?.innerHTML ?? ''))
    toast({ kind: 'success', title: 'Saved', detail: path })
  }
  const exportCsv = async () => {
    const path = await api().pickSavePath(`${projectName} – Test Cases.csv`)
    if (!path) return
    await api().writeTextFile(path, buildTestCsv(cfg, reqCfg, tree, coverage, sharedById, release.trim() ? runs : undefined))
    toast({ kind: 'success', title: 'Exported', detail: path })
  }

  const open = (id: number) => {
    const item = tests.find((t) => t.id === id) ?? tree.byId.get(id)?.item
    if (item) void useBoardStore.getState().openItem(item)
  }

  return (
    <>
      <div className="req-bar">
        <div className="segmented small">
          <button type="button" className={kind === 'spec' ? 'on' : ''} onClick={() => setKind('spec')}>Test specification</button>
          <button type="button" className={kind === 'matrix' ? 'on' : ''} onClick={() => setKind('matrix')}>Traceability matrix</button>
        </div>
        <select className="input" style={{ width: 260 }} value={rootDiId ?? ''} onChange={(e) => setRootDiId(e.target.value ? Number(e.target.value) : null)}>
          <option value="">Whole project</option>
          {allDis.map((d) => <option key={d.item.id} value={d.item.id}>{idOf(d) || `#${d.item.id}`} · {String(d.item.fields['System.Title'] ?? '')}</option>)}
        </select>
        {kind === 'spec' && (
          <>
            <input className="input" style={{ width: 170 }} list="tc-doc-releases" value={release} placeholder="Results for release…" onChange={(e) => setRelease(e.target.value)} />
            <datalist id="tc-doc-releases">{releases.map((r) => <option key={r} value={r} />)}</datalist>
          </>
        )}
        <span className="grow" />
        <button type="button" className="btn primary" onClick={copy}><Copy size={14} /> Copy for Word</button>
        <button type="button" className="btn" onClick={() => void saveWord()}><Download size={14} /> Word</button>
        <button type="button" className="btn" onClick={() => void exportCsv()}><Download size={14} /> CSV</button>
      </div>
      <div className="req-body doc">
        <article className="req-doc tc-doc" onDoubleClick={(e) => { const id = (e.target as HTMLElement).closest('[data-id]')?.getAttribute('data-id'); if (id) open(Number(id)) }}>
          <h1>{title}</h1>
          <div ref={docRef} />
        </article>
        <div className="req-hint">Double-click a heading to open it · Copy for Word keeps headings, tables and images</div>
      </div>
    </>
  )
}
