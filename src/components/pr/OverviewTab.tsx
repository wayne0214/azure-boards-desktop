import { Check, Circle, Clock, Pencil, Plus, Sparkles, SquareTerminal, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useGenerateStore, type GenerateFor } from '@/store/useGenerateStore'
import { useUiStore } from '@/store/useUiStore'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { Avatar } from '@/components/ui/Avatar'
import { itemUrl, relativeTime, shortDate } from '@/lib/format'
import { renderMarkdown } from '@/lib/pr/markdown'
import { renderPrMentions } from '@/lib/mentions'
import { VOTE_LABEL } from '@/lib/pr/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { usePrStore } from '@/store/usePrStore'
import { ThreadCard } from './ThreadCard'
import { ReviewerSearch } from './ReviewerPicker'
import { WorkItemPicker } from './WorkItemPicker'
import type { WorkItem } from '@/lib/types'
import { confirmAsync } from '@/lib/confirm'

const NO_MEMBERS: import('@/lib/types').Identity[] = []

export function OverviewTab() {
  const s = usePrStore(useShallow((st) => ({ addReviewer: st.addReviewer, detail: st.detail, linkWorkItem: st.linkWorkItem, members: st.members, removeReviewer: st.removeReviewer, selected: st.selected, setDetailTab: st.setDetailTab, updateTitleDescription: st.updateTitleDescription })))
  const me = useAppStore((st) => st.account())
  const projectName = s.selected?.projectName ?? ''
  const members = usePrStore((st) => (st.selected ? st.members[st.selected.projectId] : undefined)) ?? NO_MEMBERS
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [addRequired, setAddRequired] = useState(false)
  const toast = useUiStore((st) => st.toast)
  const addBtn = useRef<HTMLButtonElement>(null)
  const d = s.detail!
  const pr = d.pr
  const isAuthor = pr.createdBy.id === me?.userId
  const generalThreads = d.threads.filter((t) => !t.threadContext && !t.isDeleted && t.comments.some((c) => c.commentType === 'text' && !c.isDeleted)).slice(-3)

  const startEdit = () => { setTitle(pr.title); setDesc(pr.description ?? ''); setEditing(true) }
  const save = async () => { await s.updateTitleDescription(title.trim() || pr.title, desc); setEditing(false) }
  const genRun = useGenerateStore((st) => st.run)
  const gen = genRun?.status === 'running'
  const genFor: GenerateFor = { kind: 'pr', repoId: pr.repository.id, prId: pr.pullRequestId, source: pr.sourceRefName, target: pr.targetRefName }
  const generate = () => useGenerateStore.getState().start(genFor, (cur, want) => confirmAsync(`Your local checkout is on “${cur}” but this pull request is from “${want}”. Continue anyway?`, { okLabel: 'Continue' }))
  // Fill the editor when git-tools' text for this pull request lands, as long as the editor is open.
  useEffect(() => {
    if (genRun?.status !== 'done' || !editing) return
    const g = useGenerateStore.getState().take({ kind: 'pr', repoId: pr.repository.id, prId: pr.pullRequestId, source: pr.sourceRefName, target: pr.targetRefName })
    if (!g) return
    if (g.title) setTitle(g.title)
    if (g.description) setDesc(g.description)
    toast({ kind: 'success', title: 'Generated with git-tools', detail: 'Review and save.' })
  }, [genRun?.status, editing, pr.repository.id, pr.pullRequestId, pr.sourceRefName, pr.targetRefName, toast])

  return (
    <div className="pr-overview">
      <div className="pr-main-col">
        <div className="section-h" style={{ marginTop: 0 }}>Description<span className="grow" />{isAuthor && pr.status === 'active' && !editing && <button type="button" className="icon-btn sm" title="Edit" onClick={startEdit}><Pencil size={13} /></button>}</div>
        {editing ? (
          <div>
            <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} style={{ marginBottom: 8 }} />
            <textarea className="textarea" rows={8} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Markdown is supported" />
            <div className="form-inline" style={{ marginTop: 8 }}>
              <button type="button" className="btn primary sm" onClick={() => void save()}>Save</button>
              <button type="button" className="btn sm" onClick={() => setEditing(false)}>Cancel</button>
              <span className="grow" style={{ flex: 1 }} />
              <button type="button" className="btn sm" onClick={generate} disabled={gen}>{gen ? <span className="spinner" /> : <Sparkles size={13} />} {gen ? 'Generating…' : 'Generate with git-tools'}</button>
              {genRun && <button type="button" className="icon-btn sm" title="Show git-tools output" onClick={() => useGenerateStore.getState().setViewOpen(true)}><SquareTerminal size={14} /></button>}
            </div>
          </div>
        ) : pr.description ? (
          <div className="md selectable" dangerouslySetInnerHTML={{ __html: renderMarkdown(renderPrMentions(pr.description, s.members[s.selected?.projectId ?? ''] ?? [])) }} />
        ) : (
          <div className="faint">No description.</div>
        )}

        <div className="section-h">Checks</div>
        {d.policies.length === 0 && d.statuses.length === 0 && <div className="faint">No policies or build checks on this branch.</div>}
        {d.policies.map((p) => (
          <div key={p.evaluationId} className="pr-check">
            <StatusIcon status={p.status} />
            <span>{p.configuration?.type?.displayName ?? 'Policy'}</span>
            <span className="faint">{p.status}{p.configuration?.isBlocking ? ' · required' : ''}</span>
          </div>
        ))}
        {d.statuses.map((st) => (
          <div key={st.id} className="pr-check">
            <StatusIcon status={st.state} />
            <span>{st.context.name}</span>
            <span className="faint">{st.description}</span>
            {st.targetUrl && <button type="button" className="btn sm ghost" onClick={() => void api().openUrl(st.targetUrl!)}>Open</button>}
          </div>
        ))}
        {pr.mergeStatus && pr.mergeStatus !== 'succeeded' && pr.status === 'active' && (
          <div className="pr-check"><StatusIcon status={pr.mergeStatus === 'conflicts' ? 'rejected' : 'queued'} /><span>Merge</span><span className="faint">{pr.mergeStatus}</span></div>
        )}

        <div className="section-h">Commits · {d.commits.length}</div>
        {d.commits.slice(0, 20).map((c) => (
          <div key={c.commitId} className="pr-commit">
            <code className="mono faint">{c.commitId.slice(0, 8)}</code>
            <span className="t">{c.comment.split('\n')[0]}</span>
            <span className="faint">{c.author?.name} · {relativeTime(c.author?.date)}</span>
          </div>
        ))}
        {d.commits.length > 20 && <div className="faint">and {d.commits.length - 20} more</div>}

        {generalThreads.length > 0 && (
          <>
            <div className="section-h">Latest discussion<span className="grow" /><button type="button" className="btn sm ghost" onClick={() => s.setDetailTab('discussion')}>See all</button></div>
            {generalThreads.map((t) => <ThreadCard key={t.id} thread={t} compact />)}
          </>
        )}
      </div>

      <div className="pr-side-col">
        <div className="section-h" style={{ marginTop: 0 }}>Reviewers<span className="grow" />{pr.status === 'active' && <button ref={addBtn} type="button" className="icon-btn sm" title="Add reviewer" onClick={() => setAddOpen((o) => !o)}><Plus size={13} /></button>}</div>
        {addOpen && pr.status === 'active' && (
          <div className="pr-rev-add">
            <ReviewerSearch members={members} exclude={pr.reviewers.map((r) => r.id)} autoFocus onPick={(m) => { void s.addReviewer(m.id, addRequired); setAddOpen(false) }} />
            <label className="form-inline" title="Required reviewers must approve before the pull request can complete"><input type="checkbox" checked={addRequired} onChange={(e) => setAddRequired(e.target.checked)} /> Required</label>
            <button type="button" className="icon-btn sm" title="Cancel" onClick={() => setAddOpen(false)}><X size={12} /></button>
          </div>
        )}
        {pr.reviewers.length === 0 && <div className="faint">No reviewers yet.</div>}
        {pr.reviewers.map((r) => (
          <div key={r.id} className="pr-reviewer">
            <Avatar name={r.displayName} keyName={r.uniqueName} size="sm" />
            <span className="nm">{r.displayName}</span>
            <span className={`pr-rev-tag ${r.isRequired ? 'required' : ''}`} title={r.isRequired ? 'Must approve before the pull request can complete' : 'Optional reviewer'}>{r.isRequired ? 'Required' : 'Optional'}</span>
            <span className={`vote v${r.vote}`}>{VOTE_LABEL[r.vote] ?? ''}</span>
            {pr.status === 'active' && !r.isRequired && <button type="button" className="icon-btn sm" title="Remove" onClick={() => void s.removeReviewer(r.id)}><X size={12} /></button>}
          </div>
        ))}

        <div className="section-h">Work items · {d.workItems.length}<span className="grow" />{pr.status === 'active' && <WorkItemPicker project={projectName} exclude={d.workItems.map((w) => Number(w.id))} onPick={(w) => void s.linkWorkItem(w.id, true)} />}</div>
        {d.workItems.length === 0 && <div className="faint">None linked.</div>}
        {d.workItems.map((w) => (
          <LinkedItem key={w.id} id={Number(w.id)} project={projectName} onUnlink={pr.status === 'active' ? () => void confirmAsync(`Unlink #${w.id} from this pull request?`, { okLabel: 'Unlink' }).then((ok) => { if (ok) void s.linkWorkItem(Number(w.id), false) }) : undefined} />
        ))}

        <div className="section-h">Details</div>
        <div className="pr-kv"><span>Created</span><span>{shortDate(pr.creationDate)}</span></div>
        {pr.closedDate && <div className="pr-kv"><span>Closed</span><span>{shortDate(pr.closedDate)}</span></div>}
        <div className="pr-kv"><span>Iterations</span><span>{d.iterations.length}</span></div>
        {pr.completionOptions?.mergeStrategy && <div className="pr-kv"><span>Merge</span><span>{pr.completionOptions.mergeStrategy}</span></div>}
        {pr.labels && pr.labels.length > 0 && <div className="pr-kv"><span>Labels</span><span>{pr.labels.map((l) => l.name).join(', ')}</span></div>}
      </div>
    </div>
  )
}

/** A linked work item: its title once known, opens in the inspector, right-click opens it in Azure DevOps. */
function LinkedItem({ id, project, onUnlink }: { id: number; project: string; onUnlink?: () => void }) {
  const org = useAppStore((st) => st.activeOrg) ?? ''
  const openItem = useBoardStore((st) => st.openItem)
  const cached = useBoardStore((st) => st.items.find((i) => i.id === id))
  const [item, setItem] = useState<WorkItem | null>(cached ?? null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    if (cached) { setItem(cached); return }
    let live = true
    setFailed(false)
    api().searchWorkItems(org, null, String(id)).then((r) => { if (live) setItem(r.find((w) => w.id === id) ?? null) }).catch(() => { if (live) setFailed(true) })
    return () => { live = false }
  }, [org, id, cached])
  return (
    <div className="child-row pr-linked">
      <button type="button" className="pr-linked-open" onClick={() => void openItem(id, { project })} onContextMenu={(e) => { e.preventDefault(); void api().openUrl(itemUrl(org, project, id)) }}>
        <span className="id">#{id}</span>
        <span className="t">{item ? String(item.fields['System.Title'] ?? '') : failed ? 'Title could not be loaded' : 'Open details'}</span>
        {item && <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{String(item.fields['System.State'] ?? '')}</span>}
      </button>
      {onUnlink && <button type="button" className="icon-btn sm" title="Unlink" onClick={onUnlink}><X size={12} /></button>}
    </div>
  )
}

function StatusIcon({ status }: { status: string }) {
  const s = status.toLowerCase()
  if (/approved|succeeded|success/.test(s)) return <Check size={15} style={{ color: 'var(--success)' }} />
  if (/rejected|failed|error|broken/.test(s)) return <X size={15} style={{ color: 'var(--danger)' }} />
  if (/queued|running|pending|notapplicable/.test(s)) return <Clock size={15} style={{ color: 'var(--warn)' }} />
  return <Circle size={15} className="faint" />
}
