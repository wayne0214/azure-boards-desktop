import { AtSign, BookOpen, ChevronRight } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { relativeTime } from '@/lib/format'
import { pageTitle } from '@/lib/wiki/pages'
import { unseenChanges, useWikiStore } from '@/store/useWikiStore'

export interface WikiUpdate { path: string; by: string | null; date: string; mention: boolean }

/** Pages that mention me, then pages others changed since I last opened them; each page once. */
export function useWikiUpdates(): WikiUpdate[] {
  const s = useWikiStore(useShallow((st) => ({ changes: st.changes, seen: st.seen, since: st.since, mentionsOfMe: st.mentionsOfMe })))
  return useMemo(() => {
    const unseen = new Set(unseenChanges(s).map((c) => c.path))
    const mentions = s.mentionsOfMe.filter((m) => unseen.has(m.path)).map((m) => ({ ...m, mention: true }))
    const rest = unseenChanges(s).filter((c) => !mentions.some((m) => m.path === c.path)).map((c) => ({ path: c.path, by: c.author, date: c.date, mention: false }))
    return [...mentions, ...rest]
  }, [s])
}

function Row({ u, onOpen }: { u: WikiUpdate; onOpen: (path: string) => void }) {
  return (
    <button type="button" className="wiki-update" title={u.path} onClick={() => onOpen(u.path)}>
      {u.mention ? <AtSign size={13} className="me" /> : <span className="wiki-dot" />}
      <span className="t">{pageTitle(u.path)}</span>
      <span className="faint">{u.mention ? 'mentions you · ' : ''}{u.by ?? 'Someone'} · {relativeTime(u.date)}</span>
    </button>
  )
}

/** In the wiki's page list: what changed since I last looked. */
export function WikiUpdatesSide() {
  const updates = useWikiUpdates()
  const open = useWikiStore((s) => s.open)
  const [shut, setShut] = useState(false)
  if (updates.length === 0) return null
  return (
    <div className="wiki-updates">
      <button type="button" className="wiki-updates-h" onClick={() => setShut(!shut)}>
        <ChevronRight size={13} className={shut ? '' : 'open'} />
        Since you last looked <span className="count attn">{updates.length}</span>
      </button>
      {!shut && updates.slice(0, 8).map((u) => <Row key={u.path} u={u} onOpen={(p) => void open(p)} />)}
    </div>
  )
}

/** In My Work: the project wiki's news, opened in the Wiki view. */
export function WikiUpdatesStrip({ project }: { project: string }) {
  const updates = useWikiUpdates()
  const show = useWikiStore((s) => s.show)
  if (updates.length === 0) return null
  return (
    <div className="wiki-strip">
      <div className="wiki-strip-h"><BookOpen size={14} /> <b>{project} wiki</b><span className="faint">· {updates.length} since you last looked</span></div>
      {updates.slice(0, 4).map((u) => <Row key={u.path} u={u} onOpen={(p) => void show(p)} />)}
    </div>
  )
}
