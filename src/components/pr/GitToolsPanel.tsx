import { Copy, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { branchName } from '@/lib/pr/types'
import { useGenerateStore } from '@/store/useGenerateStore'
import { useUiStore } from '@/store/useUiStore'

const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** What git-tools is doing, live. Closing it leaves the run going; the Generate buttons reopen it. */
export function GitToolsPanel() {
  const run = useGenerateStore((s) => s.run)
  const open = useGenerateStore((s) => s.viewOpen)
  const setOpen = useGenerateStore((s) => s.setViewOpen)
  const cancel = useGenerateStore((s) => s.cancel)
  const openSheet = useUiStore((s) => s.openSheet)
  const toast = useUiStore((s) => s.toast)
  const logRef = useRef<HTMLDivElement>(null)
  const follow = useRef(true)
  const [, tick] = useState(0)

  useEffect(() => {
    if (run?.status !== 'running') return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [run?.status])

  // Stay at the bottom while new lines arrive, unless the user scrolled up to read.
  useEffect(() => {
    const el = logRef.current
    if (el && follow.current) el.scrollTop = el.scrollHeight
  }, [run?.lines.length, open])

  if (!open || !run) return null
  const elapsed = clock((run.endedAt ?? Date.now()) - run.startedAt)
  const copy = (text: string, what: string) => { void navigator.clipboard.writeText(text); toast({ kind: 'success', title: `${what} copied` }) }

  return (
    <div className="gt-panel" role="dialog" aria-label="git-tools output">
      <div className="gt-head">
        <Sparkles size={14} />
        <span className="gt-title">git-tools</span>
        <span className="faint gt-branches">{branchName(run.for.source)} → {branchName(run.for.target)}</span>
        <span className="grow" />
        <span className={`gt-status ${run.status}`}>
          {run.status === 'running' && <span className="spinner" style={{ width: 11, height: 11 }} />}
          {run.status === 'running' ? `Running ${elapsed}` : run.status === 'done' ? `Done in ${elapsed}` : `Failed after ${elapsed}`}
        </span>
        {run.status === 'running' && <button type="button" className="btn sm" onClick={cancel}>Cancel</button>}
        <button type="button" className="icon-btn sm" title={run.status === 'running' ? 'Hide (keeps running)' : 'Close'} onClick={() => setOpen(false)}><X size={14} /></button>
      </div>
      <div ref={logRef} className="gt-log selectable" onScroll={(e) => { const el = e.currentTarget; follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24 }}>
        {run.lines.length === 0 && <div className="faint">{run.status === 'running' ? 'Starting…' : 'No output.'}</div>}
        {run.lines.map((l, i) => <div key={i} className={l.stream === 'stderr' ? 'err' : undefined}>{l.text}</div>)}
      </div>
      {run.status === 'failed' && <div className="gt-foot gt-error">{run.error}</div>}
      {run.status === 'done' && run.result && (
        <div className="gt-foot">
          <div className="gt-result" title={run.result.title}>{run.result.title || <span className="faint">No title</span>}</div>
          {run.applied ? <span className="faint">Filled in</span> : (
            <>
              {run.for.kind === 'new' && (
                <button type="button" className="btn sm primary" onClick={() => {
                  const f = run.for
                  openSheet('new-pr', f.kind === 'new' ? { projectId: f.projectId, repoId: f.repoId, source: f.source, target: f.target } : undefined)
                }}>Use in new pull request</button>
              )}
              <button type="button" className="btn sm" onClick={() => copy(run.result!.title, 'Title')}><Copy size={13} /> Title</button>
              <button type="button" className="btn sm" onClick={() => copy(run.result!.description, 'Description')}><Copy size={13} /> Description</button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
