import { Sparkles, SquareTerminal } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useRef, useState } from 'react'
import { useGenerateStore } from '@/store/useGenerateStore'
import { api } from '@/lib/api'
import { Sheet } from '@/components/ui/Sheet'
import { branchName, type BranchWorkItem } from '@/lib/pr/types'
import type { WorkItem } from '@/lib/types'
import { ReviewerPicker, type ReviewerChoice } from './ReviewerPicker'
import { WorkItemPicker } from './WorkItemPicker'
import { useAppStore } from '@/store/useAppStore'
import { usePrStore } from '@/store/usePrStore'
import { useUiStore } from '@/store/useUiStore'
import { confirmAsync } from '@/lib/confirm'

const NO_MEMBERS: import('@/lib/types').Identity[] = []
const VIA_LABEL: Record<BranchWorkItem['linkedVia'][number], string> = { branch: 'branch', commit: 'commit', mention: 'commit message' }

export function NewPrSheet() {
  const closeSheet = useUiStore((s) => s.closeSheet)
  const org = useAppStore((s) => s.activeOrg) ?? ''
  const s = usePrStore(useShallow((st) => ({ create: st.create, loadMembers: st.loadMembers, loadRepos: st.loadRepos, repoFilter: st.repoFilter, repos: st.repos, scope: st.scope })))
  const projects = useAppStore((st) => st.projects)
  // Opened from a work item's branch: start from that project, repository and branch.
  const payload = useUiStore((st) => st.sheetPayload) as { projectId?: string; repoId?: string; source?: string; target?: string; workItem?: WorkItem } | null
  const [projectId, setProjectId] = useState(payload?.projectId ?? (s.scope !== 'all' ? s.scope : (s.repos[0]?.project?.id ?? projects[0]?.id ?? '')))
  const repos = s.repos.filter((r) => r.project?.id === projectId)
  const [repoId, setRepoId] = useState(payload?.repoId ?? s.repoFilter ?? repos[0]?.id ?? '')
  const wantedRepo = useRef(payload?.repoId)
  const members = usePrStore((st) => st.members[projectId]) ?? NO_MEMBERS
  const [reposLoading, setReposLoading] = useState(false)
  useEffect(() => {
    if (!projectId) return
    void s.loadMembers(projectId)
    setReposLoading(true)
    void s.loadRepos(projectId).finally(() => setReposLoading(false))
  }, [projectId, s.loadMembers, s.loadRepos])
  useEffect(() => {
    if (repos.some((r) => r.id === repoId)) { wantedRepo.current = undefined; return }
    // Keep the repository asked for until the project's list has loaded.
    if (wantedRepo.current && repos.length === 0) return
    setRepoId(repos[0]?.id ?? '')
  }, [repos, repoId])
  const [branches, setBranches] = useState<string[]>([])
  const [source, setSource] = useState(payload?.source ?? '')
  const [target, setTarget] = useState(payload?.target ?? '')
  const [title, setTitle] = useState(payload?.workItem ? String(payload.workItem.fields['System.Title'] ?? '') : '')
  const [desc, setDesc] = useState('')
  const [draft, setDraft] = useState(false)
  const [reviewers, setReviewers] = useState<ReviewerChoice[]>([])
  const [busy, setBusy] = useState(false)
  const toast = useUiStore((st) => st.toast)
  /** Work items found from the branch, those added by hand, and the ids the user unticked. */
  const [found, setFound] = useState<BranchWorkItem[]>([])
  const [added, setAdded] = useState<WorkItem[]>(payload?.workItem ? [payload.workItem] : [])
  const [unticked, setUnticked] = useState<number[]>([])
  const [itemsLoading, setItemsLoading] = useState(false)
  const projectName = projects.find((p) => p.id === projectId)?.name ?? ''
  const items: (WorkItem & { linkedVia?: BranchWorkItem['linkedVia'] })[] = [...found, ...added.filter((w) => !found.some((f) => f.id === w.id))]
  const linked = items.map((w) => w.id).filter((id) => !unticked.includes(id))

  useEffect(() => {
    setFound([])
    if (!repoId || !source || !target || source === target) return
    let live = true
    setItemsLoading(true)
    api().prBranchWorkItems(org, projectId, repoId, source, target)
      .then((r) => { if (live) setFound(r) })
      .catch(() => { /* the section just shows nothing found */ })
      .finally(() => { if (live) setItemsLoading(false) })
    return () => { live = false }
  }, [org, projectId, repoId, source, target])

  const genRun = useGenerateStore((st) => st.run)
  const gen = genRun?.status === 'running'
  const genFor = { kind: 'new' as const, projectId, repoId, source, target }
  const generate = () => {
    if (!repoId || !source || !target) return
    useGenerateStore.getState().start(genFor, (cur, want) => confirmAsync(`Your local checkout is on “${cur}” but this pull request is from “${want}”. git-tools uses the checked-out branch. Continue anyway?`, { okLabel: 'Continue' }))
  }
  // Take git-tools' text when it lands for these branches, even if the run started before this sheet was reopened.
  useEffect(() => {
    if (genRun?.status !== 'done' || !repoId || !source || !target) return
    const g = useGenerateStore.getState().take({ kind: 'new', projectId, repoId, source, target })
    if (!g) return
    if (g.title) setTitle(g.title)
    if (g.description) setDesc(g.description)
    toast({ kind: 'success', title: 'Generated with git-tools', detail: 'Review and edit before creating.' })
  }, [genRun?.status, projectId, repoId, source, target, toast])

  useEffect(() => {
    if (!repoId) { setBranches([]); return }
    const repo = s.repos.find((r) => r.id === repoId)
    api().prBranches(org, repoId).then((b) => {
      const names = b.map((x) => x.name)
      setBranches(names)
      setTarget((t) => t || repo?.defaultBranch || names.find((n) => /main|master/.test(n)) || names[0] || '')
    }).catch(() => setBranches([]))
  }, [repoId, org, s.repos])

  // Functional update: generated text may have filled the title in the same render.
  useEffect(() => { if (source && !title) setTitle((t) => t || branchName(source).replace(/^(feature|fix|bugfix|hotfix|chore)\//, '').replace(/^\d+-/, '').replace(/[-_]/g, ' ')) }, [source, title])

  const submit = async () => {
    if (!repoId || !source || !target || !title.trim()) return
    setBusy(true)
    const pr = await s.create(repoId, { title: title.trim(), description: desc, sourceRefName: source, targetRefName: target, isDraft: draft, reviewers, workItemIds: linked })
    setBusy(false)
    if (pr) closeSheet()
  }

  return (
    <Sheet title="New pull request" onClose={closeSheet}
      footer={<><label className="form-inline" style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-2)' }}><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} /> Create as draft</label><span className="grow" /><button type="button" className="btn" onClick={closeSheet}>Cancel</button><button type="button" className="btn primary" disabled={busy || !source || !target || !title.trim() || source === target} onClick={() => void submit()}>{busy ? 'Creating…' : 'Create'}</button></>}>
      <div className="form-row"><label>Project</label>
        <select className="input" style={{ width: 300 }} value={projectId} onChange={(e) => { setProjectId(e.target.value); setSource(''); setTarget('') }}>{projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      <div className="form-row"><label>Repository</label>
        <select className="input" style={{ width: 300 }} value={repoId} onChange={(e) => { setRepoId(e.target.value); setSource(''); setTarget('') }}>{repos.length === 0 && <option value="">{reposLoading ? 'Loading repositories…' : 'No repositories in this project'}</option>}{repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
      <div className="form-row"><label>From</label>
        <select className="input" style={{ width: 300 }} value={source} onChange={(e) => setSource(e.target.value)}><option value="">Choose a branch…</option>{branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select></div>
      <div className="form-row"><label>Into</label>
        <select className="input" style={{ width: 300 }} value={target} onChange={(e) => setTarget(e.target.value)}>{branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}</select></div>
      <div className="form-row"><label htmlFor="pr-title">Title</label>
        <div className="form-inline" style={{ flexWrap: 'nowrap' }}>
          <input id="pr-title" className="input lg" value={title} onChange={(e) => setTitle(e.target.value)} />
          <button type="button" className="btn" onClick={generate} disabled={gen || !source || !target} title="Generate title and description from the local checkout with git-tools">
            {gen ? <span className="spinner" /> : <Sparkles size={15} />} {gen ? 'Generating…' : 'Generate'}
          </button>
          {genRun && <button type="button" className="icon-btn" title="Show git-tools output" onClick={() => useGenerateStore.getState().setViewOpen(true)}><SquareTerminal size={16} /></button>}
        </div></div>
      <div className="form-row"><label htmlFor="pr-desc">Description</label><textarea id="pr-desc" className="textarea" rows={6} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Markdown is supported" /></div>
      <div className="form-row"><label>Work items</label>
        <div className="pr-new-items">
          {itemsLoading && <span className="faint"><span className="spinner" /> Looking for work items on this branch…</span>}
          {!itemsLoading && items.length === 0 && <span className="faint">{source ? 'Nothing linked to this branch or its commits.' : 'Choose a branch to see its work items.'}</span>}
          {items.map((w) => (
            <label key={w.id} className="pr-new-item">
              <input type="checkbox" checked={linked.includes(w.id)} onChange={(e) => setUnticked((cur) => (e.target.checked ? cur.filter((x) => x !== w.id) : [...cur, w.id]))} />
              <span className="id">#{w.id}</span>
              <span className="faint">{String(w.fields['System.WorkItemType'] ?? '')}</span>
              <span className="t">{String(w.fields['System.Title'] ?? '')}</span>
              <span className="faint via" title="Where this work item was found">{w.linkedVia ? `from ${w.linkedVia.map((v) => VIA_LABEL[v]).join(', ')}` : 'added'}</span>
            </label>
          ))}
          <div><WorkItemPicker project={projectName} exclude={items.map((w) => w.id)} onPick={(w) => { setAdded((cur) => [...cur, w]); setUnticked((cur) => cur.filter((x) => x !== w.id)) }} /></div>
        </div></div>
      <div className="form-row"><label>Reviewers</label>
        <ReviewerPicker members={members} value={reviewers} onChange={setReviewers} /></div>
    </Sheet>
  )
}
