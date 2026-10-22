import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { WorkItem } from '@/lib/types'
import { Popover } from '@/components/ui/Popover'
import { useAppStore } from '@/store/useAppStore'

/** "Link work item" button with a search by number or title; `exclude` hides items already linked. */
export function WorkItemPicker({ project, exclude, onPick, disabled }: { project: string; exclude: number[]; onPick: (w: WorkItem) => void; disabled?: boolean }) {
  const org = useAppStore((s) => s.activeOrg) ?? ''
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<WorkItem[] | null>(null)

  useEffect(() => {
    if (!open) return
    const text = q.trim().replace(/^#/, '')
    if (!text) { setHits(null); return }
    let live = true
    const t = setTimeout(() => {
      api().searchWorkItems(org, /^\d+$/.test(text) ? null : project || null, text)
        .then((r) => { if (live) setHits(r.slice(0, 10)) })
        .catch(() => live && setHits([]))
    }, 220)
    return () => { live = false; clearTimeout(t) }
  }, [q, open, org, project])

  const close = () => { setOpen(false); setQ(''); setHits(null) }
  const shown = hits?.filter((w) => !exclude.includes(w.id)) ?? null

  return (
    <>
      <button ref={btn} type="button" className="btn sm ghost" disabled={disabled} onClick={() => setOpen(true)}><Plus size={13} /> Link work item</button>
      <Popover anchor={btn.current} open={open} onClose={close} width={380} className="parent-pop">
        <input className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by number or title" />
        <div className="parent-hits">
          {shown === null ? <div className="pop-hint">Type a work item number or words from its title</div>
            : shown.length === 0 ? <div className="pop-hint">Nothing found</div>
              : shown.map((w) => (
                <button key={w.id} type="button" className="pop-item" onClick={() => { onPick(w); close() }}>
                  <span className="mention-id">#{w.id}</span>
                  <span className="label">{String(w.fields['System.Title'] ?? '')}</span>
                  <span className="sub">{String(w.fields['System.WorkItemType'] ?? '')}</span>
                </button>
              ))}
        </div>
      </Popover>
    </>
  )
}
