import { ArrowDown, ArrowUp, Columns3, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Dropdown } from '@/components/ui/Dropdown'
import { Empty } from '@/components/ui/Empty'
import { useVirtualRows } from '@/components/ui/useVirtualRows'
import { useVisibleItems } from '@/lib/filter'
import { identityKey, identityName, pointsOf, relativeTime, stateColor, typeColor } from '@/lib/format'
import type { WorkItem } from '@/lib/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useUiStore } from '@/store/useUiStore'
import { showItemMenu } from '../board/cardMenu'
import { FilterBar } from '../board/FilterBar'

type SortKey = 'id' | 'type' | 'title' | 'state' | 'who' | 'pri' | 'pts' | 'iter' | 'changed'

const colDefs: { key: SortKey; label: string; num?: boolean }[] = [
  { key: 'id', label: 'ID', num: true },
  { key: 'type', label: 'Type' },
  { key: 'title', label: 'Title' },
  { key: 'state', label: 'State' },
  { key: 'who', label: 'Assigned to' },
  { key: 'pri', label: 'Priority', num: true },
  { key: 'pts', label: 'Points', num: true },
  { key: 'iter', label: 'Iteration' },
  { key: 'changed', label: 'Changed' },
]

function val(it: WorkItem, k: SortKey): string | number {
  const f = it.fields
  switch (k) {
    case 'id': return it.id
    case 'type': return String(f['System.WorkItemType'] ?? '')
    case 'title': return String(f['System.Title'] ?? '').toLowerCase()
    case 'state': return String(f['System.State'] ?? '')
    case 'who': return identityName(f['System.AssignedTo']).toLowerCase()
    case 'pri': return Number(f['Microsoft.VSTS.Common.Priority'] ?? 99)
    case 'pts': return pointsOf(it) ?? -1
    case 'iter': return String(f['System.IterationPath'] ?? '')
    case 'changed': return String(f['System.ChangedDate'] ?? '')
  }
}

export function ListView() {
  const project = useAppStore((s) => s.selectedProject)
  const board = useBoardStore((s) => s.board)
  const ctx = useBoardStore((s) => s.ctx)
  const loading = useBoardStore((s) => s.loading)
  const selectedId = useBoardStore((s) => s.selectedId)
  const selectedIds = useBoardStore((s) => s.selectedIds)
  const pending = useBoardStore((s) => s.pending)
  const select = useBoardStore((s) => s.select)
  const selectMany = useBoardStore((s) => s.selectMany)
  const clearSelection = useBoardStore((s) => s.clearSelection)
  const bulkUpdate = useBoardStore((s) => s.bulkUpdate)
  const assign = useBoardStore((s) => s.assign)
  const moveToColumn = useBoardStore((s) => s.moveToColumn)
  const toggleInspector = useUiStore((s) => s.toggleInspector)
  const items = useVisibleItems()
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'changed', dir: -1 })
  const [bulkMenu, setBulkMenu] = useState<null | 'assign' | 'column' | 'iter'>(null)
  const assignBtn = useRef<HTMLButtonElement>(null)
  const colBtn = useRef<HTMLButtonElement>(null)
  const iterBtn = useRef<HTMLButtonElement>(null)
  const lastClick = useRef<number | null>(null)

  const sorted = useMemo(() => {
    const arr = items.slice()
    arr.sort((a, b) => {
      const va = val(a, sort.key), vb = val(b, sort.key)
      if (va < vb) return -1 * sort.dir
      if (va > vb) return 1 * sort.dir
      return a.id - b.id
    })
    return arr
  }, [items, sort])

  const types = ctx?.workItemTypes ?? []

  const onRowClick = (e: React.MouseEvent, it: WorkItem) => {
    if (e.shiftKey && lastClick.current !== null) {
      const a = sorted.findIndex((x) => x.id === lastClick.current)
      const b = sorted.findIndex((x) => x.id === it.id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        selectMany(sorted.slice(lo, hi + 1).map((x) => x.id))
        return
      }
    }
    lastClick.current = it.id
    select(it.id, { additive: e.metaKey || e.ctrlKey })
  }

  const listRef = useRef<HTMLDivElement>(null)
  const rows = useVirtualRows({ count: sorted.length, scrollRef: listRef })

  if (!project) return <Empty icon={<Columns3 size={40} strokeWidth={1.2} />} title="Pick a project to get started" />
  if (loading && !board) return <div className="empty-state"><span className="spinner lg" /></div>

  const ids = [...selectedIds]
  return (
    <>
      <FilterBar />
      <div ref={listRef} className="list" onClick={(e) => { if (e.target === e.currentTarget) clearSelection() }}>
        {/* While only some rows are drawn, fixed column widths keep columns and row heights from shifting as you scroll. */}
        <table className={rows.on ? 'fixed' : undefined}>
          {rows.on && <colgroup>{colDefs.map((c) => <col key={c.key} className={`col-${c.key}`} />)}</colgroup>}
          <thead>
            <tr>
              {colDefs.map((c) => (
                <th key={c.key} className={c.num ? 'num' : ''}>
                  <button type="button" onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (s.dir === 1 ? -1 : 1) : c.key === 'changed' ? -1 : 1 }))}>
                    {c.label}
                    {sort.key === c.key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.padTop > 0 && <tr aria-hidden><td colSpan={colDefs.length} style={{ height: rows.padTop, padding: 0, border: 0 }} /></tr>}
            {sorted.slice(rows.start, rows.end).map((it, k) => {
              const f = it.fields
              const type = String(f['System.WorkItemType'] ?? '')
              const who = f['System.AssignedTo'] as { displayName?: string; uniqueName?: string } | undefined
              const pts = pointsOf(it)
              return (
                <tr
                  key={it.id}
                  ref={rows.measure(rows.start + k)}
                  className={`${selectedIds.has(it.id) || selectedId === it.id ? 'selected' : ''} ${pending.has(it.id) ? 'pending' : ''}`}
                  onClick={(e) => onRowClick(e, it)}
                  onDoubleClick={() => { select(it.id); toggleInspector(true) }}
                  onContextMenu={(e) => { e.preventDefault(); const sel = selectedIds.has(it.id) && selectedIds.size > 1 ? [...selectedIds] : [it.id]; if (!selectedIds.has(it.id)) select(it.id); showItemMenu(items.filter((x) => sel.includes(x.id))) }}
                  style={{ ['--type-color' as string]: typeColor(types, type) }}
                >
                  <td className="num faint">{it.id}</td>
                  <td><span className="typebar" />{type}</td>
                  <td className="title">{String(f['System.Title'] ?? '')}</td>
                  <td><span className="state-pill"><span className="state-dot" style={{ width: 8, height: 8, borderRadius: 4, background: stateColor(types, type, String(f['System.State'] ?? '')), display: 'inline-block' }} />{String(f['System.State'] ?? '')}</span></td>
                  <td>{who ? <span className="cell-person"><Avatar name={who.displayName} keyName={who.uniqueName} size="sm" />{who.displayName}</span> : <span className="faint">—</span>}</td>
                  <td className="num">{typeof f['Microsoft.VSTS.Common.Priority'] === 'number' ? `P${f['Microsoft.VSTS.Common.Priority']}` : ''}</td>
                  <td className="num">{pts ?? ''}</td>
                  <td className="muted">{String(f['System.IterationPath'] ?? '').split('\\').pop()}</td>
                  <td className="muted">{relativeTime(f['System.ChangedDate'])}</td>
                </tr>
              )
            })}
            {rows.padBottom > 0 && <tr aria-hidden><td colSpan={colDefs.length} style={{ height: rows.padBottom, padding: 0, border: 0 }} /></tr>}
          </tbody>
        </table>
        {sorted.length === 0 && <div className="empty-state"><h3>No items match</h3><p>Try clearing a filter.</p></div>}
      </div>
      {ids.length > 1 && (
        <div className="bulk-bar">
          <span className="n">{ids.length} selected</span>
          <button ref={assignBtn} type="button" className="btn sm" onClick={() => setBulkMenu('assign')}>Assign</button>
          <button ref={colBtn} type="button" className="btn sm" onClick={() => setBulkMenu('column')}>Move to</button>
          <button ref={iterBtn} type="button" className="btn sm" onClick={() => setBulkMenu('iter')}>Iteration</button>
          <button type="button" className="icon-btn sm" onClick={clearSelection} title="Clear selection"><X size={14} /></button>
          <Dropdown anchor={assignBtn.current} open={bulkMenu === 'assign'} onClose={() => setBulkMenu(null)} searchable width={260}
            options={[{ value: '', label: 'Nobody' }, ...(ctx?.members ?? []).map((m) => ({ value: identityKey(m), label: m.displayName }))]}
            onSelect={(v) => ids.forEach((id) => void assign(id, v || null))} />
          <Dropdown anchor={colBtn.current} open={bulkMenu === 'column'} onClose={() => setBulkMenu(null)} width={220}
            options={(board?.columns ?? []).map((c) => ({ value: c.name, label: c.name }))}
            onSelect={(v) => ids.forEach((id) => void moveToColumn(id, v, false))} />
          <Dropdown anchor={iterBtn.current} open={bulkMenu === 'iter'} onClose={() => setBulkMenu(null)} searchable width={260}
            options={(ctx?.iterations ?? []).map((i) => ({ value: i.path, label: i.name, sub: i.attributes?.timeFrame }))}
            onSelect={(v) => void bulkUpdate(ids, { 'System.IterationPath': v })} />
        </div>
      )}
    </>
  )
}
