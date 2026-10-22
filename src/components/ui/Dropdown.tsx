import { Check, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Popover } from './Popover'

export interface Option<T extends string = string> {
  value: T
  label: string
  sub?: string
  icon?: ReactNode
  group?: string
  danger?: boolean
}

interface Props<T extends string> {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  options: Option<T>[]
  value?: T | T[] | null
  onSelect: (value: T) => void
  searchable?: boolean
  placeholder?: string
  emptyLabel?: string
  width?: number
  align?: 'left' | 'right'
  header?: ReactNode
  footer?: ReactNode
  multi?: boolean
}

/** Searchable list picker with keyboard navigation. */
export function Dropdown<T extends string>({
  anchor, open, onClose, options, value, onSelect, searchable, placeholder = 'Search', emptyLabel = 'No matches', width = 260, align, header, footer, multi,
}: Props<T>) {
  const [q, setQ] = useState('')
  const [hl, setHl] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setQ('')
      setHl(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return options
    return options.filter((o) => o.label.toLowerCase().includes(t) || o.sub?.toLowerCase().includes(t))
  }, [q, options])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${hl}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [hl])

  const selected = new Set(Array.isArray(value) ? value : value ? [value] : [])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(filtered.length - 1, h + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(0, h - 1)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const o = filtered[hl]
      if (o) { onSelect(o.value); if (!multi) onClose() }
    }
  }

  let lastGroup: string | undefined
  return (
    <Popover anchor={anchor} open={open} onClose={onClose} width={width} align={align}>
      <div onKeyDown={onKey}>
        {header}
        {searchable && (
          <div className="pop-search">
            <Search size={14} />
            <input ref={inputRef} value={q} onChange={(e) => { setQ(e.target.value); setHl(0) }} placeholder={placeholder} />
          </div>
        )}
        <div ref={listRef}>
          {filtered.length === 0 && <div className="pop-empty">{emptyLabel}</div>}
          {filtered.map((o, i) => {
            const showGroup = o.group && o.group !== lastGroup
            lastGroup = o.group
            return (
              <div key={o.value}>
                {showGroup && <div className="pop-head">{o.group}</div>}
                <button
                  type="button"
                  data-idx={i}
                  className={`pop-item ${i === hl ? 'hl' : ''} ${o.danger ? 'danger' : ''}`}
                  onMouseEnter={() => setHl(i)}
                  onClick={() => { onSelect(o.value); if (!multi) onClose() }}
                >
                  <span className="check">{selected.has(o.value) ? <Check size={14} /> : null}</span>
                  {o.icon}
                  <span className="label">{o.label}</span>
                  {o.sub && <span className="sub">{o.sub}</span>}
                </button>
              </div>
            )
          })}
        </div>
        {footer}
      </div>
    </Popover>
  )
}
