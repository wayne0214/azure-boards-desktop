import { X } from 'lucide-react'
import { useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Popover } from '@/components/ui/Popover'
import type { Identity } from '@/lib/types'

export interface ReviewerChoice { id: string; isRequired: boolean }

/** A text field that suggests people as you type; picking one calls `onPick`. */
export function ReviewerSearch({ members, exclude, onPick, placeholder = 'Add a reviewer…', autoFocus }: { members: Identity[]; exclude: string[]; onPick: (m: Identity) => void; placeholder?: string; autoFocus?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [hl, setHl] = useState(0)
  const text = q.trim().toLowerCase()
  const hits = members
    .filter((m) => !exclude.includes(m.id) && (!text || m.displayName.toLowerCase().includes(text) || (m.uniqueName ?? '').toLowerCase().includes(text)))
    .slice(0, 8)
  const pick = (m: Identity) => { onPick(m); setQ(''); setHl(0); input.current?.focus() }

  return (
    <>
      <input ref={input} className="input pr-rev-input" value={q} autoFocus={autoFocus} placeholder={members.length ? placeholder : 'Loading people…'} disabled={!members.length}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setHl(0); setOpen(true) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(hits.length - 1, h + 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(0, h - 1)) }
          else if (e.key === 'Enter' && hits[hl]) { e.preventDefault(); pick(hits[hl]) }
        }} />
      <Popover anchor={input.current} open={open && hits.length > 0} onClose={() => setOpen(false)} width={320} className="parent-pop">
        {hits.map((m, i) => (
          <button key={m.id} type="button" className={`pop-item ${i === hl ? 'hl' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(m)}>
            <Avatar name={m.displayName} keyName={m.uniqueName ?? undefined} size="sm" />
            <span className="label">{m.displayName}</span>
            {m.uniqueName && <span className="sub">{m.uniqueName}</span>}
          </button>
        ))}
      </Popover>
    </>
  )
}

/** Chosen reviewers as chips, each switchable between required and optional, plus a field to add more. */
export function ReviewerPicker({ members, value, onChange }: { members: Identity[]; value: ReviewerChoice[]; onChange: (v: ReviewerChoice[]) => void }) {
  const name = (id: string) => members.find((m) => m.id === id)
  return (
    <div className="pr-rev">
      {value.length > 0 && (
        <div className="pr-rev-chips">
          {value.map((r) => {
            const m = name(r.id)
            return (
              <span key={r.id} className={`pr-rev-chip ${r.isRequired ? 'required' : ''}`}>
                <Avatar name={m?.displayName ?? r.id} keyName={m?.uniqueName ?? undefined} size="sm" />
                <span className="nm">{m?.displayName ?? r.id}</span>
                <button type="button" className="pr-rev-kind" title={r.isRequired ? 'Required: must approve before completing. Click to make optional.' : 'Optional. Click to make required.'}
                  onClick={() => onChange(value.map((x) => (x.id === r.id ? { ...x, isRequired: !x.isRequired } : x)))}>
                  {r.isRequired ? 'Required' : 'Optional'}
                </button>
                <button type="button" className="icon-btn sm" title="Remove" onClick={() => onChange(value.filter((x) => x.id !== r.id))}><X size={12} /></button>
              </span>
            )
          })}
        </div>
      )}
      <ReviewerSearch members={members} exclude={value.map((r) => r.id)} onPick={(m) => onChange([...value, { id: m.id, isRequired: false }])} />
    </div>
  )
}
