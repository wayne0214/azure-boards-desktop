import { AlertTriangle, Check, ChevronDown, ChevronRight, CircleDashed, GitBranch, Info, Loader2, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Empty } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { confirmAsync } from '@/lib/confirm'
import type { Repo } from '@/lib/pr/types'
import { errorMessage } from '@/lib/types'
import { overall, versioningSteps, type Overall, type StepState, type VersioningFacts, type VersioningStep } from '@/lib/versioning/evaluate'
import { WORKFLOW_PATH, defaultNames } from '@/lib/versioning/template'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'

/** Repositories checked as soon as the page opens; the rest when expanded. */
const AUTO_CHECK = 6
/** How often an expanded repository with a running pipeline is checked again. */
const RUN_POLL_MS = 10000

type Check = { facts?: VersioningFacts; loading: boolean; error?: string }

const BADGE: Record<Overall, { label: string; cls: string }> = {
  ready: { label: 'Versioning ready', cls: 'ok' },
  partial: { label: 'Versioning half set up', cls: 'warn' },
  none: { label: 'No versioning', cls: '' },
  error: { label: 'Cannot check versioning', cls: 'danger' },
}

function StateIcon({ state }: { state: StepState }) {
  switch (state) {
    case 'done': return <Check size={14} />
    case 'running': return <Loader2 size={14} className="spin" />
    case 'failed': case 'error': return <X size={14} />
    case 'warn': return <AlertTriangle size={14} />
    case 'optional': return <Info size={14} />
    default: return <CircleDashed size={14} />
  }
}

/** Each repository's git-tools versioning setup on Azure Pipelines, as a checklist with fixes. */
export function VersioningView() {
  const org = useAppStore((s) => s.activeOrg)
  const project = useAppStore((s) => s.selectedProject)
  const toast = useUiStore((s) => s.toast)
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [reposError, setReposError] = useState<string | null>(null)
  const [prCounts, setPrCounts] = useState<Map<string, number>>(new Map())
  const [checks, setChecks] = useState<Record<string, Check>>({})
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  // Ignore answers that arrive after the user moved to another project.
  const gen = useRef(0)

  const check = useCallback(async (repo: Repo) => {
    if (!org || !project) return
    const g = gen.current
    setChecks((c) => ({ ...c, [repo.id]: { ...c[repo.id], loading: true } }))
    try {
      const facts = await api().versioningFacts(org, project.id, project.name, repo.id, WORKFLOW_PATH, defaultNames(project.name).secureFile)
      if (g === gen.current) setChecks((c) => ({ ...c, [repo.id]: { facts, loading: false } }))
    } catch (e) {
      if (g === gen.current) setChecks((c) => ({ ...c, [repo.id]: { ...c[repo.id], loading: false, error: errorMessage(e) } }))
    }
  }, [org, project])

  const load = useCallback(async () => {
    if (!org || !project) return
    const g = ++gen.current
    setRepos(null)
    setReposError(null)
    setChecks({})
    setOpen(new Set())
    try {
      const list = (await api().prListRepos(org, project.name)).filter((r) => !r.isDisabled).sort((a, b) => a.name.localeCompare(b.name))
      if (g !== gen.current) return
      setRepos(list)
      void api().prList(org, project.name, 'active', { top: 500 }).then((prs) => {
        if (g !== gen.current) return
        const counts = new Map<string, number>()
        for (const pr of prs) counts.set(pr.repository.id, (counts.get(pr.repository.id) ?? 0) + 1)
        setPrCounts(counts)
      }).catch(() => { /* counts are a nicety */ })
      // Two at a time: each check makes a dozen requests.
      const first = list.slice(0, AUTO_CHECK)
      const next = async (): Promise<void> => {
        const r = first.shift()
        if (!r || g !== gen.current) return
        await check(r)
        return next()
      }
      await Promise.all([next(), next()])
    } catch (e) {
      if (g === gen.current) setReposError(errorMessage(e))
    }
  }, [org, project, check])

  useEffect(() => { void load() }, [load])

  // Watch a pipeline run started from here until it finishes.
  const running = useMemo(() => (repos ?? []).filter((r) => open.has(r.id) && checks[r.id]?.facts?.lastRun && checks[r.id]?.facts?.lastRun?.state !== 'completed'), [repos, open, checks])
  useEffect(() => {
    if (!running.length) return
    const t = window.setInterval(() => { for (const r of running) if (!checks[r.id]?.loading) void check(r) }, RUN_POLL_MS)
    return () => window.clearInterval(t)
  }, [running, checks, check])

  if (!project || !org) return <Empty title="Choose a project">Pick a project in the sidebar to set up versioning for its repositories.</Empty>

  const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project.name)}`
  const toggle = (r: Repo) => {
    const n = new Set(open)
    if (n.has(r.id)) n.delete(r.id)
    else {
      n.add(r.id)
      if (!checks[r.id]?.facts && !checks[r.id]?.loading) void check(r)
    }
    setOpen(n)
  }

  const fix = async (repo: Repo, step: VersioningStep) => {
    if (!step.fix) return
    if (step.confirm && !(await confirmAsync(step.confirm, { title: `${step.fixLabel ?? 'Fix'} · ${repo.name}`, okLabel: step.fixLabel ?? 'Fix' }))) return
    const key = `${repo.id}:${step.id}`
    setBusy(key)
    try {
      const res = await api().versioningFix(org, project.id, project.name, repo.id, step.fix)
      if (step.fix.step === 'files') {
        const id = res.pullRequestId
        const link = typeof id === 'number' ? `${url}/_git/${encodeURIComponent(repo.name)}/pullrequest/${id}` : null
        toast({
          kind: 'success',
          title: link ? `Opened pull request ${id}` : 'Updated the setup pull request',
          detail: 'Complete it, then check again.',
          action: link ? { label: 'Open', onClick: () => void api().openUrl(link) } : undefined,
        })
      } else toast({ kind: 'success', title: `${step.title}: done` })
    } catch (e) {
      toast({ kind: 'error', title: `${step.title} failed`, detail: errorMessage(e), sticky: true })
    } finally {
      setBusy(null)
      void check(repo)
    }
  }

  return (
    <div className="req versioning">
      <div className="req-head">
        <div className="req-title">
          <strong>Versioning</strong>
          <span className="faint">git-tools on Azure Pipelines: conventional commits on Git Flow branches bump .cz.toml and tag each release.</span>
        </div>
        <span className="grow" />
        <button type="button" className="icon-btn" title="Reload" onClick={() => void load()} disabled={repos === null && !reposError}><RefreshCw size={16} className={repos === null && !reposError ? 'spin' : ''} /></button>
      </div>

      <div className="req-body">
        {reposError ? (
          <div className="ts-note danger"><span className="msg">{reposError}</span><button type="button" className="btn sm primary" onClick={() => void load()}>Try again</button></div>
        ) : repos === null ? (
          <div className="empty-state"><span className="spinner lg" /><p>Loading repositories…</p></div>
        ) : repos.length === 0 ? (
          <Empty icon={<GitBranch size={28} />} title="No repositories">This project has no Git repositories.</Empty>
        ) : (
          <div className="ov-repos">
            {repos.map((r) => {
              const c = checks[r.id]
              const result = c?.facts ? versioningSteps(c.facts, r, project.name) : null
              const o = result ? overall(result.steps) : null
              const isOpen = open.has(r.id)
              const prs = prCounts.get(r.id) ?? 0
              return (
                <section key={r.id} className="ov-repo">
                  <button type="button" className="ov-repo-head" onClick={() => toggle(r)}>
                    {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    <GitBranch size={15} className="faint" />
                    <span className="nm">{r.name}</span>
                    {r.defaultBranch && <span className="faint ov-branch">{r.defaultBranch.replace('refs/heads/', '')}</span>}
                    <span className="grow" />
                    {prs > 0 && <span className="team-chip">{prs} open PR{prs === 1 ? '' : 's'}</span>}
                    {c?.loading && !c.facts ? <span className="team-chip"><Loader2 size={11} className="spin" /> Checking</span>
                      : c?.error ? <span className="team-chip danger">Cannot check versioning</span>
                      : o ? <span className={`team-chip ${BADGE[o].cls}`}>{BADGE[o].label}</span>
                      : null}
                  </button>
                  {isOpen && (
                    <div className="ov-steps">
                      {c?.error && <div className="ts-note danger"><span className="msg">{c.error}</span><button type="button" className="btn sm primary" onClick={() => void check(r)}>Try again</button></div>}
                      {!result && !c?.error && <div className="ov-step"><span className="spinner" /> <span className="faint">Checking {r.name}…</span></div>}
                      {result?.steps.map((s) => (
                        <div key={s.id} className={`ov-step ${s.state}`}>
                          <span className="ov-state"><StateIcon state={s.state} /></span>
                          <div className="ov-step-text">
                            <div className="ov-step-title">{s.title}</div>
                            <div className="ov-step-detail">{s.detail}</div>
                          </div>
                          {s.fix && (
                            <button type="button" className="btn sm primary" disabled={busy !== null} onClick={() => void fix(r, s)}>
                              {busy === `${r.id}:${s.id}` ? <Loader2 size={13} className="spin" /> : null}{s.fixLabel ?? 'Fix'}
                            </button>
                          )}
                        </div>
                      ))}
                      {result && (
                        <div className="ov-steps-foot">
                          <span className="faint">Steps follow git-tools' Azure DevOps setup guide. Each fix asks first.</span>
                          <span className="grow" />
                          <button type="button" className="btn sm ghost" disabled={c?.loading} onClick={() => void check(r)}><RefreshCw size={13} className={c?.loading ? 'spin' : ''} /> Check again</button>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
