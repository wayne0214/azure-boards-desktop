import { Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { idOf, type ReqNode, type ReqTree } from '@/lib/requirements'

/** Search the project's SRS by ID or title and pick one to link. */
export function SrsPicker({ tree, exclude, onPick, onClose }: { tree: ReqTree; exclude: number[]; onPick: (id: number) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  const matches = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return [...tree.byId.values()]
      .filter((n) => n.tier.level === 2 && !exclude.includes(n.item.id))
      .filter((n) => !needle || `${idOf(n)} ${n.item.fields['System.Title'] ?? ''} ${n.item.id}`.toLowerCase().includes(needle))
      .slice(0, 30)
  }, [tree, exclude, q])

  useEffect(() => {
    const away = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [onClose])

  const pick = (n: ReqNode | undefined) => { if (n) { onPick(n.item.id); onClose() } }

  return (
    <div className="tc-picker" ref={ref}>
      <div className="search-box">
        <Search size={14} />
        <input
          autoFocus
          value={q}
          placeholder="Type an SRS ID or words from it"
          onChange={(e) => { setQ(e.target.value); setI(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(matches.length - 1, x + 1)) }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)) }
            else if (e.key === 'Enter') { e.preventDefault(); pick(matches[i]) }
            else if (e.key === 'Escape') onClose()
          }}
        />
      </div>
      <div className="tc-picker-list">
        {matches.length === 0 && <div className="faint tc-picker-empty">No matching requirement.</div>}
        {matches.map((n, j) => (
          <button key={n.item.id} type="button" className={j === i ? 'on' : ''} onMouseEnter={() => setI(j)} onClick={() => pick(n)}>
            <span className="req-id">{idOf(n) || `#${n.item.id}`}</span>
            <span className="req-name">{String(n.item.fields['System.Title'] ?? '')}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
