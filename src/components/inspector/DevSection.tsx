import { GitBranch, GitPullRequest, Plus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { PullRequest } from '@/lib/pr/types'
import { devLinks } from '@/lib/startWork'
import type { WorkItem } from '@/lib/types'
import { usePrStore } from '@/store/usePrStore'
import { useUiStore } from '@/store/useUiStore'

/** Branches and pull requests linked to the item, with Create PR for a branch that has none yet. */
export function DevSection({ item, org, canStart }: { item: WorkItem; org: string; canStart: boolean }) {
  const links = devLinks(item)
  const linkKey = links.map((l) => (l.kind === 'pr' ? `pr:${l.repoId}:${l.prId}` : `b:${l.repoId}:${l.name}`)).join('|')
  const repos = usePrStore((s) => s.repos)
  const loadRepos = usePrStore((s) => s.loadRepos)
  const openPr = usePrStore((s) => s.open)
  const openSheet = useUiStore((s) => s.openSheet)
  const setView = useUiStore((s) => s.setView)
  const [prs, setPrs] = useState<Record<number, PullRequest | null>>({})

  useEffect(() => {
    for (const pid of new Set(links.map((l) => l.projectId))) void loadRepos(pid)
    let live = true
    for (const l of links) {
      if (l.kind !== 'pr') continue
      api().prGet(org, l.repoId, l.prId)
        .then((pr) => live && setPrs((cur) => ({ ...cur, [l.prId]: pr })))
        .catch(() => live && setPrs((cur) => ({ ...cur, [l.prId]: null })))
    }
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkKey, org])

  const repoName = (id: string) => repos.find((r) => r.id === id)?.name ?? ''
  const branches = links.filter((l) => l.kind === 'branch')
  const prLinks = links.filter((l) => l.kind === 'pr')
  // A branch whose pull request is already linked (or still loading) gets no Create PR button.
  const hasPr = (repoId: string, name: string) => prLinks.some((l) => l.repoId === repoId && (prs[l.prId] === undefined || prs[l.prId]?.sourceRefName === `refs/heads/${name}`))

  if (links.length === 0 && !canStart) return null
  return (
    <>
      <div className="section-h">
        <span>Development{links.length ? ` · ${links.length}` : ''}</span>
        <span className="grow" />
        {canStart && <button type="button" className="icon-btn sm" title="Start work: create a branch" onClick={() => openSheet('start-work', { id: item.id })}><Plus size={14} /></button>}
      </div>
      {links.length === 0 && <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>No branches or pull requests yet.</div>}
      {prLinks.map((l) => {
        const pr = prs[l.prId]
        return (
          <button key={`pr${l.prId}`} type="button" className="dev-row" disabled={!pr} title={pr ? 'Show pull request' : undefined} onClick={() => { if (pr) { setView('prs'); void openPr(pr) } }}>
            <GitPullRequest size={14} className="dev-ic" />
            <span className="id">!{l.prId}</span>
            <span className="t">{pr === undefined ? '…' : pr === null ? 'Not available' : pr.title}</span>
            {pr && <span className={`dev-status ${pr.status}`}>{pr.isDraft && pr.status === 'active' ? 'draft' : pr.status}</span>}
          </button>
        )
      })}
      {branches.map((l) => (
        <div key={`b${l.repoId}${l.name}`} className="dev-row">
          <GitBranch size={14} className="dev-ic" />
          <span className="t mono" title={l.name}>{l.name}</span>
          <span className="faint">{repoName(l.repoId)}</span>
          {!hasPr(l.repoId, l.name) && (
            <button type="button" className="btn sm ghost" onClick={() => openSheet('new-pr', { projectId: l.projectId, repoId: l.repoId, source: `refs/heads/${l.name}`, workItem: item })}>Create PR</button>
          )}
        </div>
      ))}
    </>
  )
}
