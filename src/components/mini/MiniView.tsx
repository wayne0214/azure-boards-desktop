import { AtSign, BookOpen, CalendarClock, GitPullRequest, Hammer, ImagePlus, Maximize2, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '@/lib/api'
import { typeColor } from '@/lib/format'
import { activeWork, nextBooking, prStanding, prsForMe, startsIn } from '@/lib/mini'
import type { PullRequest } from '@/lib/pr/types'
import type { WorkItem } from '@/lib/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useMyWorkStore } from '@/store/useMyWorkStore'
import { usePrStore } from '@/store/usePrStore'
import { useRoomStore } from '@/store/useRoomStore'
import { useUiStore } from '@/store/useUiStore'
import { useWikiStore } from '@/store/useWikiStore'
import { useWikiUpdates } from '@/components/wiki/WikiUpdates'
import { pageTitle } from '@/lib/wiki/pages'

// The panel sits beside other apps, unfocused most of the time, so it refreshes on its own clock.
const EVERY = 2 * 60 * 1000
const STANDING: Record<ReturnType<typeof prStanding>, string> = { draft: 'Draft', conflicts: 'Conflicts', rejected: 'Rejected', waiting: 'Waiting for author', approved: 'Approved', pending: 'In review' }

const project = (it: WorkItem) => String(it.fields['System.TeamProject'] ?? '')
const title = (it: WorkItem) => String(it.fields['System.Title'] ?? '')

/** Mini mode: only what needs me, in a small window that stays on top. Anything clicked opens the full app there. */
export function MiniView() {
  const org = useAppStore((s) => s.activeOrg)
  const me = useAppStore((s) => s.account())
  const items = useMyWorkStore((s) => s.items)
  const types = useMyWorkStore((s) => s.types)
  const involved = usePrStore((s) => s.involved)
  const bookings = useRoomStore((s) => s.mine)
  const setMini = useUiStore((s) => s.setMini)
  const selectedProject = useAppStore((s) => s.selectedProject)
  const wikiNews = useWikiUpdates().slice(0, 3)
  const [mentions, setMentions] = useState<WorkItem[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async () => {
    setRefreshing(true)
    await Promise.allSettled([
      useMyWorkStore.getState().load({ silent: true }),
      usePrStore.getState().loadInvolved(),
      useRoomStore.getState().loadMine(),
      org ? api().mentionedItems(org).then(setMentions) : Promise.resolve(),
      selectedProject ? useWikiStore.getState().refreshFor(selectedProject) : Promise.resolve(),
    ])
    setRefreshing(false)
  }, [org, selectedProject])

  useEffect(() => {
    void refresh()
    const t = setInterval(() => void refresh(), EVERY)
    return () => clearInterval(t)
  }, [refresh])

  const working = useMemo(() => activeWork(items, types), [items, types])
  const prs = useMemo(() => (me ? prsForMe(involved, me.userId) : { review: [], mine: [] }), [involved, me])
  const recentMentions = useMemo(() => [...(mentions ?? [])].sort((a, b) => String(b.fields['System.ChangedDate']).localeCompare(String(a.fields['System.ChangedDate']))).slice(0, 3), [mentions])
  const booking = nextBooking(bookings)
  const allClear = prs.review.length + prs.mine.length + working.length + recentMentions.length + wikiNews.length === 0 && !booking

  const openItem = (it: WorkItem) => {
    setMini(false)
    const ui = useUiStore.getState()
    ui.setView('mine')
    void useBoardStore.getState().openItem(it.id, { project: project(it), push: true })
    ui.toggleInspector(true)
  }
  const openPr = (pr: PullRequest) => {
    setMini(false)
    useUiStore.getState().setView('prs')
    void usePrStore.getState().open(pr)
  }

  return (
    <div className="mini">
      <div className="mini-head drag-region" data-tauri-drag-region>
        <span className="mini-title" data-tauri-drag-region>Boards</span>
        <span className="grow" data-tauri-drag-region />
        <button type="button" className="icon-btn sm" title="Refresh" onClick={() => void refresh()} disabled={refreshing}><RefreshCw size={13} className={refreshing ? 'spin' : undefined} /></button>
        <button type="button" className="icon-btn sm" title="Back to the full window (⌘⇧D)" onClick={() => setMini(false)}><Maximize2 size={13} /></button>
      </div>
      <div className="mini-body">
        <Section icon={<GitPullRequest size={13} />} title="Reviews for me" count={prs.review.length}>
          {prs.review.map((p) => <PrRow key={`r${p.pullRequestId}`} pr={p} sub={p.createdBy.displayName} onOpen={openPr} />)}
        </Section>
        <Section icon={<GitPullRequest size={13} />} title="My pull requests" count={prs.mine.length}>
          {prs.mine.map((p) => <PrRow key={`m${p.pullRequestId}`} pr={p} sub={STANDING[prStanding(p)]} tone={prStanding(p)} onOpen={openPr} />)}
        </Section>
        <Section icon={<Hammer size={13} />} title="Working on" count={working.length}>
          {working.map((it) => (
            <button key={it.id} type="button" className="mini-row" onClick={() => openItem(it)} style={{ ['--type-color' as string]: typeColor(types[project(it)] ?? [], String(it.fields['System.WorkItemType'] ?? '')) }}>
              <span className="mini-type" />
              <span className="mini-text"><b>{title(it)}</b><span className="faint">#{it.id} · {String(it.fields['System.State'] ?? '')}</span></span>
            </button>
          ))}
        </Section>
        <Section icon={<AtSign size={13} />} title="Mentions" count={recentMentions.length}>
          {recentMentions.map((it) => (
            <button key={it.id} type="button" className="mini-row" onClick={() => openItem(it)}>
              <span className="mini-text"><b>{title(it)}</b><span className="faint">#{it.id} · {project(it)}</span></span>
            </button>
          ))}
        </Section>
        <Section icon={<BookOpen size={13} />} title="Wiki" count={wikiNews.length}>
          {wikiNews.map((u) => (
            <button key={u.path} type="button" className="mini-row" onClick={() => { setMini(false); void useWikiStore.getState().show(u.path) }}>
              <span className="mini-text"><b>{pageTitle(u.path)}</b><span className="faint">{u.mention ? 'Mentions you · ' : 'Changed · '}{u.by ?? 'someone'}</span></span>
            </button>
          ))}
        </Section>
        {booking && (
          <div className="mini-booking">
            <CalendarClock size={13} />
            <span className="mini-text"><b>{booking.title || 'Room booking'}</b><span className="faint">{startsIn(booking)}</span></span>
          </div>
        )}
        {allClear && <div className="mini-empty faint">{refreshing ? 'Checking…' : 'All clear: no reviews, pull requests, work in progress, mentions or wiki changes.'}</div>}
        <div className="mini-drop faint"><ImagePlus size={13} /> Drop or paste a screenshot to report a bug</div>
      </div>
    </div>
  )
}

/** A list with something in it; an empty one is left out so the small window shows only what needs me. */
function Section({ icon, title, count, children }: { icon: React.ReactNode; title: string; count: number; children: React.ReactNode }) {
  if (count === 0) return null
  return (
    <section className="mini-section">
      <h4>{icon}{title}<span className="mini-count">{count}</span></h4>
      {children}
    </section>
  )
}

function PrRow({ pr, sub, tone, onOpen }: { pr: PullRequest; sub?: string; tone?: string; onOpen: (pr: PullRequest) => void }) {
  return (
    <button type="button" className="mini-row" onClick={() => onOpen(pr)}>
      <span className="mini-text"><b>{pr.title}</b><span className="faint">{pr.repository.name} · <span className={tone ? `mini-standing ${tone}` : undefined}>{sub}</span></span></span>
    </button>
  )
}
