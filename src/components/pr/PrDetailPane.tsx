import { Check, ChevronDown, ExternalLink, GitMerge, RefreshCw, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useRef, useState } from 'react'
import { api } from '@/lib/api'
import { Avatar } from '@/components/ui/Avatar'
import { Dropdown, type Option } from '@/components/ui/Dropdown'
import { VOTE_LABEL, branchName } from '@/lib/pr/types'
import { useAppStore } from '@/store/useAppStore'
import { usePrStore } from '@/store/usePrStore'
import { useUiStore } from '@/store/useUiStore'
import { DiscussionTab } from './DiscussionTab'
import { FilesTab } from './FilesTab'
import { OverviewTab } from './OverviewTab'
import { confirmAsync } from '@/lib/confirm'

export function PrDetailPane() {
  const s = usePrStore(useShallow((st) => ({ abandon: st.abandon, busy: st.busy, changes: st.changes, close: st.close, detail: st.detail, detailLoading: st.detailLoading, detailTab: st.detailTab, reactivate: st.reactivate, reload: st.reload, selected: st.selected, setAutoComplete: st.setAutoComplete, setDetailTab: st.setDetailTab, setDraft: st.setDraft, vote: st.vote })))
  const org = useAppStore((st) => st.activeOrg) ?? ''
  const me = useAppStore((st) => st.account())
  const openSheet = useUiStore((st) => st.openSheet)
  const [voteOpen, setVoteOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const voteBtn = useRef<HTMLButtonElement>(null)
  const moreBtn = useRef<HTMLButtonElement>(null)

  if (s.detailLoading || !s.detail) return <div className="empty-state"><span className="spinner lg" /><button type="button" className="btn sm" style={{ marginTop: 12 }} onClick={s.close}>Close</button></div>
  const pr = s.detail.pr
  const myReview = pr.reviewers.find((r) => r.id === me?.userId)
  const myVote = myReview?.vote ?? 0
  const active = pr.status === 'active'
  const isAuthor = pr.createdBy.id === me?.userId
  const webUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(s.selected?.projectName ?? pr.repository.project?.name ?? '')}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`
  const unresolved = s.detail.threads.filter((t) => !t.isDeleted && t.status === 'active' && t.comments.some((c) => c.commentType === 'text' && !c.isDeleted)).length

  const voteOptions: Option[] = [
    { value: '10', label: 'Approve' },
    { value: '5', label: 'Approve with suggestions' },
    { value: '-5', label: 'Wait for author' },
    { value: '-10', label: 'Reject' },
    { value: '0', label: 'Reset my vote' },
  ]
  const moreOptions: Option[] = [
    ...(active ? [{ value: 'autocomplete', label: pr.autoCompleteSetBy ? 'Cancel auto-complete' : 'Set auto-complete…' }] : []),
    ...(active ? [{ value: 'draft', label: pr.isDraft ? 'Publish (leave draft)' : 'Mark as draft' }] : []),
    ...(active ? [{ value: 'abandon', label: 'Abandon', danger: true }] : []),
    ...(pr.status === 'abandoned' ? [{ value: 'reactivate', label: 'Reactivate' }] : []),
    { value: 'web', label: 'Open in Azure DevOps' },
    { value: 'copy', label: 'Copy link' },
  ]
  const onMore = (v: string) => {
    if (v === 'autocomplete') { if (pr.autoCompleteSetBy) void s.setAutoComplete(null); else openSheet('complete-pr', { mode: 'auto' }) }
    if (v === 'draft') void s.setDraft(!pr.isDraft)
    if (v === 'abandon') void confirmAsync(`Abandon pull request !${pr.pullRequestId}?\n\nThe branch stays; the pull request can be reactivated later.`, { okLabel: 'Abandon', danger: true }).then((ok) => { if (ok) void s.abandon() })
    if (v === 'reactivate') void s.reactivate()
    if (v === 'web') void api().openUrl(webUrl)
    if (v === 'copy') { void navigator.clipboard.writeText(webUrl); useUiStore.getState().toast({ kind: 'success', title: 'Link copied' }) }
  }

  return (
    <div className="pr-pane">
      <header className="pr-head">
        <div className="pr-head-main">
          <div className="pr-title-row">
            <span className={`pr-dot ${pr.status} ${pr.isDraft ? 'draft' : ''}`} />
            <h2 className="pr-title">{pr.title}</h2>
          </div>
          <div className="pr-sub">
            <Avatar name={pr.createdBy.displayName} keyName={pr.createdBy.uniqueName} size="sm" />
            <span>{pr.createdBy.displayName}</span>
            <span className="faint">!{pr.pullRequestId} · {pr.repository.name}</span>
            <span className="pr-branch">{branchName(pr.sourceRefName)}</span>
            <span className="faint">into</span>
            <span className="pr-branch">{branchName(pr.targetRefName)}</span>
            {pr.isDraft && <span className="pr-chip">Draft</span>}
            {pr.status !== 'active' && <span className={`pr-chip ${pr.status === 'completed' ? 'ok' : ''}`}>{pr.status}</span>}
            {pr.mergeStatus === 'conflicts' && <span className="pr-chip bad">Merge conflicts</span>}
            {pr.autoCompleteSetBy && <span className="pr-chip ok">Auto-complete on</span>}
          </div>
        </div>
        <div className="pr-head-actions">
          <button type="button" className="icon-btn" title="Refresh" onClick={() => void s.reload()}><RefreshCw size={15} /></button>
          <button type="button" className="icon-btn" title="Open in Azure DevOps" onClick={() => void api().openUrl(webUrl)}><ExternalLink size={15} /></button>
          {active && (
            <>
              <button ref={voteBtn} type="button" className={`btn ${myVote >= 5 ? 'on' : myVote < 0 ? 'danger' : ''}`} onClick={() => setVoteOpen(true)} disabled={s.busy}>
                {myVote >= 5 ? <Check size={15} /> : myVote < 0 ? <X size={15} /> : null}
                {myVote === 0 ? 'Review' : VOTE_LABEL[myVote]} <ChevronDown size={14} className="faint" />
              </button>
              <Dropdown anchor={voteBtn.current} open={voteOpen} onClose={() => setVoteOpen(false)} options={voteOptions} value={String(myVote)} width={240} align="right" onSelect={(v) => void s.vote(Number(v))} />
              <button type="button" className="btn primary" onClick={() => openSheet('complete-pr', { mode: 'complete' })} disabled={s.busy || pr.isDraft || pr.mergeStatus === 'conflicts'} title={pr.mergeStatus === 'conflicts' ? 'Resolve the merge conflicts first' : pr.isDraft ? 'Publish the draft first' : 'Complete the pull request'}>
                <GitMerge size={15} /> Complete
              </button>
            </>
          )}
          <button ref={moreBtn} type="button" className="icon-btn" onClick={() => setMoreOpen(true)} title="More"><ChevronDown size={16} /></button>
          <Dropdown anchor={moreBtn.current} open={moreOpen} onClose={() => setMoreOpen(false)} options={moreOptions} width={240} align="right" onSelect={onMore} />
          <button type="button" className="icon-btn" onClick={s.close} title="Close"><X size={16} /></button>
        </div>
      </header>
      <div className="pr-tabs">
        <button type="button" className={s.detailTab === 'overview' ? 'on' : ''} onClick={() => s.setDetailTab('overview')}>Overview</button>
        <button type="button" className={s.detailTab === 'files' ? 'on' : ''} onClick={() => s.setDetailTab('files')}>Files{s.changes.length ? ` · ${s.changes.length}` : ''}</button>
        <button type="button" className={s.detailTab === 'discussion' ? 'on' : ''} onClick={() => s.setDetailTab('discussion')}>Discussion{unresolved ? ` · ${unresolved} open` : ''}</button>
        <span className="grow" />
        {isAuthor && active && <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>You are the author</span>}
      </div>
      <div className="pr-tab-body">
        {s.detailTab === 'overview' && <OverviewTab />}
        {s.detailTab === 'files' && <FilesTab />}
        {s.detailTab === 'discussion' && <DiscussionTab />}
      </div>
    </div>
  )
}
