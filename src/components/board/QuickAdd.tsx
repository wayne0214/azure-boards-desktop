import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useBoardStore } from '@/store/useBoardStore'
import type { BoardColumn } from '@/lib/types'

interface Props {
  column: BoardColumn
  types: string[]
}

/** Inline "add a card" at the bottom of a column. Enter creates, Shift+Enter adds a newline, Esc cancels. */
export function QuickAdd({ column, types }: Props) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [type, setType] = useState(types[0] ?? '')
  const [busy, setBusy] = useState(false)
  const submitting = useRef(false)
  const ref = useRef<HTMLTextAreaElement>(null)
  const create = useBoardStore((s) => s.create)
  const moveToColumn = useBoardStore((s) => s.moveToColumn)
  const board = useBoardStore((s) => s.board)
  const filters = useBoardStore((s) => s.filters)

  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])
  useEffect(() => {
    if (!types.includes(type)) setType(types[0] ?? '')
  }, [types, type])

  const submit = async () => {
    const t = title.trim()
    if (!t || !type || submitting.current) return
    submitting.current = true
    setBusy(true)
    const fields: Record<string, unknown> = { 'System.Title': t }
    const state = column.stateMappings?.[type]
    if (filters.iterationPath) fields['System.IterationPath'] = filters.iterationPath
    const created = await create(type, fields, null)
    if (created && board) {
      // Place it in this column if the column is not the first one.
      const first = board.columns[0]
      if (column.id !== first?.id && state) await moveToColumn(created.id, column.name, false)
    }
    setBusy(false)
    submitting.current = false
    setTitle('')
    ref.current?.focus()
  }

  if (!open) {
    return (
      <div className="quick-add">
        <button type="button" className="add-btn" onClick={() => setOpen(true)}>
          <Plus size={15} /> Add item
        </button>
      </div>
    )
  }
  return (
    <div className="quick-add">
      <textarea
        ref={ref}
        rows={2}
        value={title}
        placeholder={`New ${type} title`}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit() }
          if (e.key === 'Escape') { setOpen(false); setTitle('') }
        }}
        onBlur={() => { if (!title.trim()) setOpen(false) }}
        disabled={busy}
      />
      <div className="row">
        {types.length > 1 && (
          <select className="input" style={{ height: 26, width: 'auto', fontSize: 'var(--fs-xs)' }} value={type} onChange={(e) => setType(e.target.value)}>
            {types.map((t) => (<option key={t} value={t}>{t}</option>))}
          </select>
        )}
        <span className="hint">Enter to add · Esc to cancel</span>
        <button type="button" className="btn sm primary" onClick={() => void submit()} disabled={busy || !title.trim()}>{busy ? 'Adding…' : 'Add'}</button>
      </div>
    </div>
  )
}
