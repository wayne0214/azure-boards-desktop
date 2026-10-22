import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Sheet } from '@/components/ui/Sheet'
import { branchName, type CompletionOptions } from '@/lib/pr/types'
import { usePrStore } from '@/store/usePrStore'
import { useUiStore } from '@/store/useUiStore'

/** Complete now, or set auto-complete. */
export function CompletePrSheet() {
  const closeSheet = useUiStore((s) => s.closeSheet)
  const payload = useUiStore((s) => s.sheetPayload) as { mode: 'complete' | 'auto' } | null
  const s = usePrStore(useShallow((st) => ({ complete: st.complete, detail: st.detail, setAutoComplete: st.setAutoComplete })))
  const pr = s.detail!.pr
  const auto = payload?.mode === 'auto'
  const [strategy, setStrategy] = useState<NonNullable<CompletionOptions['mergeStrategy']>>(pr.completionOptions?.mergeStrategy ?? 'squash')
  const [deleteBranch, setDeleteBranch] = useState(pr.completionOptions?.deleteSourceBranch ?? true)
  const [transition, setTransition] = useState(pr.completionOptions?.transitionWorkItems ?? true)
  const [message, setMessage] = useState(pr.completionOptions?.mergeCommitMessage ?? `Merged PR ${pr.pullRequestId}: ${pr.title}`)
  const [busy, setBusy] = useState(false)
  const unresolved = s.detail!.threads.filter((t) => !t.isDeleted && t.status === 'active' && t.comments.some((c) => c.commentType === 'text' && !c.isDeleted)).length

  const go = async () => {
    setBusy(true)
    const opts: CompletionOptions = { mergeStrategy: strategy, deleteSourceBranch: deleteBranch, transitionWorkItems: transition, mergeCommitMessage: message }
    if (auto) { await s.setAutoComplete(opts); closeSheet() }
    else { const ok = await s.complete(opts); if (ok) closeSheet() }
    setBusy(false)
  }

  return (
    <Sheet title={auto ? 'Set auto-complete' : `Complete pull request !${pr.pullRequestId}`} onClose={closeSheet} size="narrow"
      footer={<><span className="grow" /><button type="button" className="btn" onClick={closeSheet}>Cancel</button><button type="button" className="btn primary" disabled={busy} onClick={() => void go()}>{busy ? 'Working…' : auto ? 'Set auto-complete' : 'Complete merge'}</button></>}>
      <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}>
        Merge <strong>{branchName(pr.sourceRefName)}</strong> into <strong>{branchName(pr.targetRefName)}</strong>{auto ? ' automatically once every policy passes.' : '.'}
      </p>
      {unresolved > 0 && !auto && <div className="ts-note warn" style={{ margin: '0 0 12px' }}><span className="msg">{unresolved} comment thread{unresolved > 1 ? 's are' : ' is'} still active.</span></div>}
      <div className="form-row stack">
        <label>Merge type</label>
        <div className="choice-row">
          {([['squash', 'Squash commit'], ['noFastForward', 'Merge (no fast-forward)'], ['rebase', 'Rebase and fast-forward'], ['rebaseMerge', 'Semi-linear merge']] as const).map(([v, l]) => (
            <button key={v} type="button" className={`choice ${strategy === v ? 'on' : ''}`} onClick={() => setStrategy(v)}>{l}</button>
          ))}
        </div>
      </div>
      {(strategy === 'squash' || strategy === 'noFastForward' || strategy === 'rebaseMerge') && (
        <div className="form-row stack">
          <label>Merge commit message</label>
          <textarea className="textarea" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>
      )}
      <label className="form-inline" style={{ fontSize: 'var(--fs-sm)', marginBottom: 8 }}><input type="checkbox" checked={deleteBranch} onChange={(e) => setDeleteBranch(e.target.checked)} /> Delete {branchName(pr.sourceRefName)} after merging</label>
      <label className="form-inline" style={{ fontSize: 'var(--fs-sm)' }}><input type="checkbox" checked={transition} onChange={(e) => setTransition(e.target.checked)} /> Complete linked work items</label>
    </Sheet>
  )
}
