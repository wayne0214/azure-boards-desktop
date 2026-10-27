import DOMPurify from 'dompurify'
import { RefreshCw, Zap } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { PullRequest } from '@/lib/pr/types'
import { errorMessage, type WorkItem } from '@/lib/types'
import { describe, parseBlock, type LiveBlock as Block } from '@/lib/wiki/blocks'
import { childPages, mentionedIds, pageMeta, pageTitle, wikiVersion } from '@/lib/wiki/pages'
import { DECISIONS, FEEDBACK } from '@/lib/wiki/templates'
import type { FoundItem } from '@/lib/wiki/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { usePrStore } from '@/store/usePrStore'
import { useUiStore } from '@/store/useUiStore'
import { useWikiStore } from '@/store/useWikiStore'

// A page re-renders often (typing in preview, work item titles arriving); results are kept a minute.
const FRESH = 60_000
const cache = new Map<string, { at: number; value: Promise<unknown> }>()
function cached<T>(key: string, load: () => Promise<T>, force = false): Promise<T> {
  const hit = cache.get(key)
  if (!force && hit && Date.now() - hit.at < FRESH) return hit.value as Promise<T>
  const value = load()
  cache.set(key, { at: Date.now(), value })
  value.catch(() => cache.delete(key))
  return value
}

/** A ```boards block on a page, filled in with what is true now. */
export function LiveBlock({ text }: { text: string }) {
  const block = useMemo(() => parseBlock(text), [text])
  const [tick, setTick] = useState(0)
  const refresh = () => setTick((t) => t + 1)
  return (
    <div className="wiki-live-box" contentEditable={false}>
      <div className="wiki-live-h">
        <Zap size={12} />
        <span>{describe(block)}</span>
        <span className="grow" />
        {block.kind !== 'error' && <button type="button" className="icon-btn sm" title="Refresh" onClick={refresh}><RefreshCw size={12} /></button>}
      </div>
      {block.kind === 'error' ? <div className="wiki-live-msg">{block.message}</div> : <Body block={block} tick={tick} />}
    </div>
  )
}

function Body({ block, tick }: { block: Exclude<Block, { kind: 'error' }>; tick: number }) {
  switch (block.kind) {
    case 'items': return <Items block={block} tick={tick} />
    case 'item': return <OneItem id={block.id} tick={tick} />
    case 'prs': return <Prs block={block} tick={tick} />
    case 'pages': return <Pages block={block} tick={tick} />
  }
}

/** Loads with the page's org and project; a Refresh (a new `tick`) skips the cache. */
function useLive<T>(key: string | null, load: (org: string, project: string) => Promise<T>, tick: number) {
  const org = useAppStore((s) => s.activeOrg)
  const project = useWikiStore((s) => s.project)
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true })
  const loader = useRef(load)
  const lastTick = useRef(tick)
  useLayoutEffect(() => { loader.current = load })
  useEffect(() => {
    if (!org || !project || !key) return
    let live = true
    const force = tick !== lastTick.current
    lastTick.current = tick
    setState((s) => ({ ...s, loading: true }))
    cached(`${org}/${project.name}/${key}`, () => loader.current(org, project.name), force)
      .then((data) => { if (live) setState({ data, error: null, loading: false }) })
      .catch((e) => { if (live) setState({ data: null, error: errorMessage(e), loading: false }) })
    return () => { live = false }
  }, [org, project, key, tick])
  return state
}

function Status({ loading, error, empty }: { loading: boolean; error: string | null; empty: boolean }) {
  if (error) return <div className="wiki-live-msg error">{error}</div>
  if (loading && empty) return <div className="wiki-live-msg"><span className="spinner" /></div>
  return null
}

/** Links in a work item's text open in the browser (the page's own link handling does not reach into live blocks). */
const openLink = (e: React.MouseEvent) => {
  const href = (e.target as HTMLElement).closest('a')?.getAttribute('href') ?? ''
  if (/^(https?|mailto):/i.test(href)) void api().openUrl(href)
}
const openItem = (id: number) => void useBoardStore.getState().openItem(id, { project: useWikiStore.getState().project?.name })
const who = (v: FoundItem['assignedTo']) => (typeof v === 'string' ? v : v?.displayName ?? '')

function Items({ block, tick }: { block: Extract<Block, { kind: 'items' }>; tick: number }) {
  const team = useAppStore((s) => s.selectedTeam?.name ?? null)
  const key = `items:${team}:${JSON.stringify(block.filter)}`
  const { data, error, loading } = useLive(key, (org, project) => api().wikiFindItems(org, project, team, block.filter), tick)
  return (
    <>
      <Status loading={loading} error={error} empty={!data} />
      {data && data.items.length === 0 && <div className="wiki-live-msg">Nothing matches right now.</div>}
      {data && data.items.length > 0 && (
        <table className="wiki-live-table">
          <tbody>
            {data.items.map((it) => (
              <tr key={it.id} onClick={() => openItem(it.id)}>
                <td className="num">#{it.id}</td>
                <td className="t">{it.title}<span className="faint"> · {it.type}</span></td>
                <td>{it.state}</td>
                <td className="faint">{who(it.assignedTo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data?.truncated && <div className="wiki-live-msg">Showing the first {data.items.length}. Add a limit: or narrow the query.</div>}
    </>
  )
}

/** A work item as it is now: a requirement's current text on the page that cites it. */
function OneItem({ id, tick }: { id: number; tick: number }) {
  const { data, error, loading } = useLive<WorkItem>(`item:${id}`, (org, project) => api().getWorkItem(org, project, id), tick)
  const f = data?.fields ?? {}
  const rich = Object.entries(f).filter(([k, v]) => typeof v === 'string' && /<\w/.test(v) && (k === 'System.Description' || /AcceptanceCriteria|Spec|ReproSteps/i.test(k)))
  return (
    <>
      <Status loading={loading} error={error} empty={!data} />
      {data && (
        <div className="wiki-live-item">
          <button type="button" className="wiki-live-title" onClick={() => openItem(id)}>#{id} {String(f['System.Title'] ?? '')}</button>
          <div className="faint">{String(f['System.WorkItemType'] ?? '')} · {String(f['System.State'] ?? '')}{f['System.AssignedTo'] ? ` · ${(f['System.AssignedTo'] as { displayName?: string }).displayName ?? ''}` : ''}</div>
          {rich.slice(0, 3).map(([k, v]) => <div key={k} className="wiki-live-rich md" onClick={openLink} dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(String(v)) }} />)}
        </div>
      )}
    </>
  )
}

function Prs({ block, tick }: { block: Extract<Block, { kind: 'prs' }>; tick: number }) {
  const key = `prs:${block.status}:${block.repo ?? ''}:${block.limit}`
  const { data, error, loading } = useLive<PullRequest[]>(key, async (org, project) => {
    let repoId: string | undefined
    if (block.repo) {
      const repo = (await api().prListRepos(org, project)).find((r) => r.name.toLowerCase() === block.repo!.toLowerCase())
      if (!repo) throw new Error(`No repository "${block.repo}" in ${project}.`)
      repoId = repo.id
    }
    return api().prList(org, project, block.status, { top: block.limit, repoId })
  }, tick)
  const open = (pr: PullRequest) => { useUiStore.getState().setView('prs'); void usePrStore.getState().open(pr) }
  return (
    <>
      <Status loading={loading} error={error} empty={!data} />
      {data && data.length === 0 && <div className="wiki-live-msg">No pull requests.</div>}
      {data && data.length > 0 && (
        <table className="wiki-live-table">
          <tbody>
            {data.slice(0, block.limit).map((pr) => (
              <tr key={pr.pullRequestId} onClick={() => open(pr)}>
                <td className="num">!{pr.pullRequestId}</td>
                <td className="t">{pr.title}<span className="faint"> · {pr.repository.name}</span></td>
                <td>{pr.isDraft ? 'Draft' : pr.status === 'completed' ? `Merged ${pr.closedDate?.slice(0, 10) ?? ''}` : pr.status === 'active' ? 'Open' : pr.status}</td>
                <td className="faint">{pr.createdBy.displayName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

interface PageRow { path: string; content: string }

/** The pages under the decision log or the feedback page, with what each says at its top. */
function Pages({ block, tick }: { block: Extract<Block, { kind: 'pages' }>; tick: number }) {
  const tree = useWikiStore((s) => s.tree)
  const wikis = useWikiStore((s) => s.wikis)
  const wikiId = useWikiStore((s) => s.wikiId)
  const mentions = useWikiStore((s) => s.mentions)
  const loadMentions = useWikiStore((s) => s.loadMentions)
  const w = wikis.find((x) => x.id === wikiId) ?? null
  const under = block.under ?? (block.list === 'decisions' ? DECISIONS : FEEDBACK)
  const paths = useMemo(() => childPages(tree, under).slice(0, 60), [tree, under])
  const key = w ? `pages:${w.id}:${paths.join('|')}` : null
  const { data, error, loading } = useLive<PageRow[]>(key, (org, project) =>
    Promise.all(paths.map((p) => api().wikiPage(org, project, w!.id, p, wikiVersion(w)).then((pg) => ({ path: p, content: pg.content })).catch(() => ({ path: p, content: '' })))), tick)
  useEffect(() => { if (block.list === 'feedback' && data) loadMentions(data.flatMap((r) => mentionedIds(r.content))) }, [block.list, data, loadMentions])
  const open = (p: string) => void useWikiStore.getState().open(p)

  if (!tree) return null
  if (paths.length === 0) return <div className="wiki-live-msg">No pages under {under} yet.</div>
  return (
    <>
      <Status loading={loading} error={error} empty={!data} />
      {data && block.list === 'decisions' && (
        <table className="wiki-live-table">
          <thead><tr><th>Decision</th><th>Status</th><th>Date</th><th>Decided by</th></tr></thead>
          <tbody>
            {data.map((r) => {
              const m = pageMeta(r.content)
              return (
                <tr key={r.path} onClick={() => open(r.path)}>
                  <td className="t">{pageTitle(r.path)}</td>
                  <td><span className={`wiki-status ${statusTone(m.status)}`}>{m.status ?? '—'}</span></td>
                  <td className="faint">{m.date ?? ''}</td>
                  <td className="faint">{m.by ?? ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      {data && block.list === 'feedback' && (
        <table className="wiki-live-table">
          <thead><tr><th>Feedback</th><th>From</th><th>Became</th><th>Trace</th></tr></thead>
          <tbody>
            {data.map((r) => {
              const m = pageMeta(r.content)
              const ids = mentionedIds(r.content)
              const known = ids.map((id) => mentions[id]).filter(Boolean)
              const trace = ids.length === 0 ? 'Waiting' : known.length === ids.length && known.every((k) => k!.done) ? 'Shipped' : 'In progress'
              return (
                <tr key={r.path} onClick={() => open(r.path)}>
                  <td className="t">{pageTitle(r.path)}<span className="faint">{m.date ? ` · ${m.date}` : ''}</span></td>
                  <td className="faint">{m.from ?? ''}</td>
                  <td>
                    {ids.length === 0 ? <span className="faint">—</span> : ids.map((id) => (
                      <button key={id} type="button" className={`wiki-wi ${mentions[id]?.done ? 'done' : ''}`} title={mentions[id] ? `${mentions[id]!.type} · ${mentions[id]!.state}` : undefined} onClick={(e) => { e.stopPropagation(); openItem(id) }}>
                        #{id}{mentions[id] ? ` ${mentions[id]!.state}` : ''}
                      </button>
                    ))}
                  </td>
                  <td><span className={`wiki-status ${trace === 'Shipped' ? 'good' : trace === 'Waiting' ? 'wait' : 'busy'}`}>{trace}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}

const statusTone = (s: string | null) => {
  const v = (s ?? '').toLowerCase()
  if (/accept|approved|done/.test(v)) return 'good'
  if (/propos|draft|review|open/.test(v)) return 'busy'
  if (/reject/.test(v)) return 'bad'
  return 'wait'
}
