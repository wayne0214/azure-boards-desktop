import { FolderOpen } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { getRepoPath, setRepoPath } from '@/lib/pr/gitTools'
import { branchName } from '@/lib/pr/types'
import { branchNameProblem, startState, suggestBranchName } from '@/lib/startWork'
import { Sheet } from '@/components/ui/Sheet'
import { useAppStore } from '@/store/useAppStore'
import { projectOf, useBoardStore } from '@/store/useBoardStore'
import { useMyWorkStore } from '@/store/useMyWorkStore'
import { usePrStore } from '@/store/usePrStore'
import { useUiStore } from '@/store/useUiStore'

const lastRepoKey = (projectId: string) => `sw.repo.${projectId}`
const readLastRepo = (projectId: string) => { try { return localStorage.getItem(lastRepoKey(projectId)) } catch { return null } }
const writeLastRepo = (projectId: string, repoId: string) => { try { localStorage.setItem(lastRepoKey(projectId), repoId) } catch { /* ignore */ } }

/** Create a branch for a work item, link it, mark the item started, and check the branch out locally. */
export function StartWorkSheet() {
  const closeSheet = useUiStore((s) => s.closeSheet)
  const toast = useUiStore((s) => s.toast)
  const payload = useUiStore((s) => s.sheetPayload) as { id: number } | null
  const item = useBoardStore((s) => (payload ? s.getItem(payload.id) : null))
  const org = useAppStore((s) => s.activeOrg) ?? ''
  const me = useAppStore((s) => s.account())
  const project = item ? projectOf(item) : ''
  const projectId = useAppStore((s) => s.projects.find((p) => p.name === project)?.id ?? '')
  const sameProject = useAppStore((s) => s.selectedProject?.name === project)
  const ctxTypes = useBoardStore((s) => s.ctx?.workItemTypes)
  const otherTypes = useMyWorkStore((s) => s.types[project])
  const loadRepos = usePrStore((s) => s.loadRepos)
  const allRepos = usePrStore((s) => s.repos)
  const repos = allRepos.filter((r) => r.project?.id === projectId)

  const type = String(item?.fields['System.WorkItemType'] ?? '')
  const state = String(item?.fields['System.State'] ?? '')
  const wit = ((sameProject ? ctxTypes : otherTypes) ?? []).find((t) => t.name === type)
  const nextState = startState(wit, state)
  const assignee = item?.fields['System.AssignedTo'] as { id?: string; displayName?: string; uniqueName?: string } | undefined
  // The account keeps the user's id and display name; match on either.
  const assignedToMe = !!me && !!assignee && (assignee.id === me.userId || [assignee.displayName, assignee.uniqueName].some((n) => n?.toLowerCase() === me.userName.toLowerCase()))

  const [reposLoading, setReposLoading] = useState(true)
  const [repoId, setRepoId] = useState('')
  const [branches, setBranches] = useState<string[]>([])
  const [base, setBase] = useState('')
  const [name, setName] = useState(() => (item ? suggestBranchName(item.id, type, String(item.fields['System.Title'] ?? '')) : ''))
  const [setActive, setSetActive] = useState(true)
  const [assignMe, setAssignMe] = useState(true)
  const [checkout, setCheckout] = useState(true)
  const [localPath, setLocalPath] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!projectId) { setReposLoading(false); return }
    setReposLoading(true)
    void loadRepos(projectId).finally(() => setReposLoading(false))
  }, [projectId, loadRepos])

  // Pick the repository used last time in this project, else the only or first one.
  useEffect(() => {
    if (repoId && repos.some((r) => r.id === repoId)) return
    const last = readLastRepo(projectId)
    setRepoId(repos.find((r) => r.id === last)?.id ?? repos[0]?.id ?? '')
  }, [repos, repoId, projectId])

  useEffect(() => {
    setBranches([])
    setBase('')
    setLocalPath(repoId ? getRepoPath(repoId) : null)
    if (!repoId) return
    let live = true
    const repo = repos.find((r) => r.id === repoId)
    api().prBranches(org, repoId).then((b) => {
      if (!live) return
      const names = b.map((x) => x.name)
      setBranches(names)
      setBase(repo?.defaultBranch && names.includes(repo.defaultBranch) ? repo.defaultBranch : names.find((n) => /\/(main|master)$/.test(n)) ?? names[0] ?? '')
    }).catch(() => live && setBranches([]))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, org])

  if (!item) return null

  const problem = branchNameProblem(name.trim())
  const taken = branches.includes(`refs/heads/${name.trim()}`)
  const error = name.trim() ? (problem ?? (taken ? 'A branch with this name already exists.' : null)) : null

  const chooseFolder = async () => {
    const path = await api().pickFolder()
    if (!path || !repoId) return
    setRepoPath(repoId, path)
    setLocalPath(path)
    setCheckout(true)
  }

  const submit = async () => {
    const branch = name.trim()
    if (busy || !repoId || !base || problem || taken) return
    setBusy(true)
    writeLastRepo(projectId, repoId)
    const b = useBoardStore.getState()
    const fail = (title: string, e: unknown) => toast({ kind: 'error', title, detail: String((e as { message?: string }).message ?? e) })
    let res: Awaited<ReturnType<ReturnType<typeof api>['prStartBranch']>>
    try {
      res = await api().prStartBranch(org, projectId, repoId, branch, base, item.id)
    } catch (e) {
      fail('Could not create the branch', e)
      setBusy(false)
      return
    }
    // From here the branch exists; failures are reported as what they are, and the sheet still closes.
    closeSheet()
    if (!res.linked) toast({ kind: 'error', title: 'Branch created, but not linked', detail: res.linkError ?? 'Link it from Azure DevOps.' })
    // The link is a new revision; edit on top of it, not the one the panel had. The store reports its own save errors.
    const fresh = await b.reloadItem(item.id)
    let updated = true
    if (!fresh && res.linked) {
      updated = false
      toast({ kind: 'error', title: `Branch created, but #${item.id} was not updated`, detail: 'Could not reload it after linking; set its state and assignee by hand.' })
    } else {
      if (assignMe && me && !assignedToMe) await b.assign(item.id, me.userName)
      if (setActive && nextState) {
        const col = b.items.some((i) => i.id === item.id) ? b.board?.columns.find((c) => c.stateMappings?.[type] === nextState) : undefined
        if (col) await b.moveToColumn(item.id, col.name, false)
        else updated = (await b.updateFields(item.id, { 'System.State': nextState })) !== null
      }
    }
    if (checkout && localPath) {
      try {
        await api().gitCheckoutBranch(localPath, branch)
      } catch (e) {
        fail('Branch created, but not checked out', e)
        return
      }
    }
    toast({
      kind: 'success',
      title: updated ? `Started work on #${item.id}` : `Branch ${branch} created`,
      detail: checkout && localPath ? `${branch} is checked out in ${localPath}` : `Branch ${branch} created`,
    })
  }

  return (
    <Sheet title={`Start work on #${item.id}`} onClose={closeSheet}
      footer={<><span className="grow" /><button type="button" className="btn" onClick={closeSheet}>Cancel</button><button type="button" className="btn primary" disabled={busy || !repoId || !base || !name.trim() || !!error} onClick={() => void submit()}>{busy ? 'Starting…' : 'Start work'}</button></>}>
      <div className="form-row"><label>Repository</label>
        <select className="input" style={{ width: 320 }} value={repoId} onChange={(e) => setRepoId(e.target.value)}>
          {repos.length === 0 && <option value="">{reposLoading ? 'Loading repositories…' : 'No repositories in this project'}</option>}
          {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select></div>
      <div className="form-row"><label>Based on</label>
        <select className="input" style={{ width: 320 }} value={base} onChange={(e) => setBase(e.target.value)} disabled={branches.length === 0}>
          {branches.length === 0 && <option value="">{repoId ? 'Loading branches…' : '—'}</option>}
          {branches.map((b) => <option key={b} value={b}>{branchName(b)}</option>)}
        </select></div>
      <div className="form-row"><label htmlFor="sw-name">Branch name</label>
        <div>
          <input id="sw-name" className="input lg" value={name} spellCheck={false} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit() }} />
          {error && <div className="start-work-error">{error}</div>}
        </div></div>
      <div className="form-row"><label>Also</label>
        <div className="check-list">
          <label className="form-inline"><input type="checkbox" checked disabled /> Link the branch to #{item.id}</label>
          {nextState && <label className="form-inline"><input type="checkbox" checked={setActive} onChange={(e) => setSetActive(e.target.checked)} /> Set state to {nextState}</label>}
          {me && !assignedToMe && <label className="form-inline"><input type="checkbox" checked={assignMe} onChange={(e) => setAssignMe(e.target.checked)} /> Assign to me</label>}
          {localPath
            ? <label className="form-inline" title={localPath}><input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} /> Check out in <span className="mono faint start-work-path">{localPath}</span></label>
            : <button type="button" className="btn sm ghost" disabled={!repoId} onClick={() => void chooseFolder()}><FolderOpen size={14} /> Check out locally… choose this repository's folder</button>}
        </div></div>
    </Sheet>
  )
}
