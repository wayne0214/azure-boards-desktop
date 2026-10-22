import { ChevronDown, ChevronRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { longDate, relativeTime } from '@/lib/format'
import { buildHistory, type HistoryEntry } from '@/lib/history'
import type { WorkItemType } from '@/lib/types'
import { Avatar } from '@/components/ui/Avatar'

/** Who changed what and when. Fetched only when opened, and again when the item's revision moves on. */
export function HistorySection({ org, project, id, rev, types, fieldTypes }: { org: string; project: string; id: number; rev: number; types: WorkItemType[]; fieldTypes: Record<string, string> }) {
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!open) return
    let live = true
    setFailed(false)
    api().getUpdates(org, project, id)
      .then((raw) => { if (live) setEntries(buildHistory(raw, types, fieldTypes)) })
      .catch(() => { if (live) { setEntries([]); setFailed(true) } })
    return () => { live = false }
    // Types and field kinds only affect labels; refetching on every context refresh is not worth it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, org, project, id, rev])

  return (
    <>
      <button type="button" className="section-h section-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>History{entries && entries.length ? ` · ${entries.length}` : ''}</span>
      </button>
      {open && (entries === null ? <div className="skeleton" style={{ height: 40 }} />
        : failed ? <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>Could not load the history.</div>
          : entries.length === 0 ? <div className="faint" style={{ fontSize: 'var(--fs-sm)' }}>No changes yet.</div>
            : <div className="history">{entries.map((e) => <Entry key={e.rev} e={e} />)}</div>)}
    </>
  )
}

function Entry({ e }: { e: HistoryEntry }) {
  return (
    <div className="history-entry">
      <Avatar name={e.by.displayName} keyName={e.by.uniqueName} size="sm" />
      <div className="history-main">
        <div><span className="who">{e.by.displayName ?? 'Someone'}</span><span className="when" title={longDate(e.date)}>{relativeTime(e.date)}</span></div>
        {e.created && <div className="history-line">Created the item</div>}
        {e.changes.map((c) => (
          <div key={c.field} className="history-line">
            <span className="k">{c.label}</span>
            {c.longText ? <span className="faint">edited</span>
              : <>
                {c.from && <><s className="from">{c.from}</s><span className="arrow">→</span></>}
                {c.to ? <span className="to">{c.to}</span> : <span className="faint">cleared</span>}
              </>}
          </div>
        ))}
        {e.links.map((l, i) => (
          <div key={`l${i}`} className="history-line"><span className="k">{l.added ? 'Linked' : 'Unlinked'}</span><span className="to">{l.label}</span></div>
        ))}
        {e.commented && <div className="history-line faint">Commented</div>}
      </div>
    </div>
  )
}
