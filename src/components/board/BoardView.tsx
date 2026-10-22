import { DndContext, DragOverlay, PointerSensor, useSensor, useSensors, type DragEndEvent, type DragStartEvent } from '@dnd-kit/core'
import { Columns3, WifiOff } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Empty } from '@/components/ui/Empty'
import { useVisibleItems } from '@/lib/filter'
import { columnFor, isDone } from '@/lib/format'
import type { WorkItem } from '@/lib/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useUiStore } from '@/store/useUiStore'
import { Card } from './Card'
import { Column } from './Column'
import { showItemMenu } from './cardMenu'
import { FilterBar } from './FilterBar'

export function BoardView() {
  const project = useAppStore((s) => s.selectedProject)
  const contextLoading = useAppStore((s) => s.contextLoading)
  const board = useBoardStore((s) => s.board)
  const ctx = useBoardStore((s) => s.ctx)
  const loading = useBoardStore((s) => s.loading)
  const refreshing = useBoardStore((s) => s.refreshing)
  const error = useBoardStore((s) => s.error)
  const selectedId = useBoardStore((s) => s.selectedId)
  const selectedIds = useBoardStore((s) => s.selectedIds)
  const pending = useBoardStore((s) => s.pending)
  const select = useBoardStore((s) => s.select)
  const clearSelection = useBoardStore((s) => s.clearSelection)
  const moveToColumn = useBoardStore((s) => s.moveToColumn)
  const toggleInspector = useUiStore((s) => s.toggleInspector)
  const openSheet = useUiStore((s) => s.openSheet)
  const items = useVisibleItems()
  const allItems = useBoardStore((s) => s.items)
  const [dragging, setDragging] = useState<WorkItem | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  const grouped = useMemo(() => {
    const map = new Map<string, { all: WorkItem[]; doing: WorkItem[]; done: WorkItem[] }>()
    if (!board) return map
    for (const c of board.columns) map.set(c.name, { all: [], doing: [], done: [] })
    for (const it of items) {
      const c = columnFor(board, it)
      if (!c) continue
      const g = map.get(c.name)
      if (!g) continue
      g.all.push(it)
      if (isDone(board, it)) g.done.push(it)
      else g.doing.push(it)
    }
    return map
  }, [board, items])

  const typesOf = useCallback((colName: string) => (board?.columns.find((c) => c.name === colName)?.stateMappings ? Object.keys(board.columns.find((c) => c.name === colName)!.stateMappings) : []), [board])

  const onDragStart = (e: DragStartEvent) => {
    const it = allItems.find((i) => i.id === e.active.id)
    setDragging(it ?? null)
  }
  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null)
    const over = e.over?.id
    if (!over || !board) return
    const id = Number(e.active.id)
    const [colName, part] = String(over).split('::')
    const item = allItems.find((i) => i.id === id)
    if (!item) return
    const current = columnFor(board, item)
    const currentlyDone = isDone(board, item)
    const targetDone = part === 'done'
    if (current?.name === colName && currentlyDone === targetDone) return
    const ids = selectedIds.has(id) && selectedIds.size > 1 ? [...selectedIds] : [id]
    for (const i of ids) void moveToColumn(i, colName, targetDone)
  }

  // Keyboard: arrows move selection across cards in visual order.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!board || useUiStore.getState().sheet || useUiStore.getState().paletteOpen) return
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, [contenteditable="true"]')) return
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return
      const order: { col: number; idx: number; id: number }[] = []
      board.columns.forEach((c, ci) => (grouped.get(c.name)?.all ?? []).forEach((it, ii) => order.push({ col: ci, idx: ii, id: it.id })))
      if (order.length === 0) return
      const cur = order.findIndex((o) => o.id === selectedId)
      if (e.key === 'Enter') { if (cur >= 0) { toggleInspector(true); e.preventDefault() } return }
      e.preventDefault()
      let next: typeof order[number] | undefined
      if (cur < 0) next = order[0]
      else if (e.key === 'ArrowDown') next = order.find((o) => o.col === order[cur].col && o.idx === order[cur].idx + 1) ?? order[cur]
      else if (e.key === 'ArrowUp') next = order.find((o) => o.col === order[cur].col && o.idx === order[cur].idx - 1) ?? order[cur]
      else {
        const dir = e.key === 'ArrowRight' ? 1 : -1
        let col = order[cur].col + dir
        while (col >= 0 && col < board.columns.length) {
          const inCol = order.filter((o) => o.col === col)
          if (inCol.length) { next = inCol[Math.min(order[cur].idx, inCol.length - 1)]; break }
          col += dir
        }
        next ??= order[cur]
      }
      if (next) {
        select(next.id)
        document.querySelector<HTMLElement>(`.card[data-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [board, grouped, selectedId, select, toggleInspector])

  if (!project) {
    return (
      <Empty icon={<Columns3 size={40} strokeWidth={1.2} />} title="Pick a project to get started">
        Choose a project from the sidebar. Your boards, teams and sprints will show up here.
      </Empty>
    )
  }
  if (error && !board) {
    return (
      <Empty icon={<WifiOff size={40} strokeWidth={1.2} />} title="Could not load this board" action={<button type="button" className="btn" onClick={() => void useBoardStore.getState().load()}>Try again</button>}>
        {error}
      </Empty>
    )
  }
  if ((loading && !board) || contextLoading || !board) {
    return (
      <div className="board">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="column" style={{ padding: 10, gap: 8, display: 'flex', flexDirection: 'column' }}>
            <div className="skeleton" style={{ height: 20, width: '50%' }} />
            <div className="skeleton" style={{ height: 76 }} />
            <div className="skeleton" style={{ height: 64 }} />
            {i < 2 && <div className="skeleton" style={{ height: 70 }} />}
          </div>
        ))}
      </div>
    )
  }

  const renderCard = (it: WorkItem) => (
    <Card
      key={it.id}
      item={it}
      types={ctx?.workItemTypes ?? []}
      selected={selectedId === it.id}
      multi={selectedIds.size > 1 && selectedIds.has(it.id)}
      pending={pending.has(it.id)}
      onSelect={(e) => select(it.id, { additive: e.metaKey || e.ctrlKey, range: e.shiftKey })}
      onOpen={() => { select(it.id); toggleInspector(true) }}
      onContextMenu={(e) => {
        e.preventDefault()
        const ids = selectedIds.has(it.id) && selectedIds.size > 1 ? [...selectedIds] : [it.id]
        if (!selectedIds.has(it.id)) select(it.id)
        showItemMenu(allItems.filter((x) => ids.includes(x.id)))
      }}
    />
  )

  return (
    <>
      <FilterBar />
      {allItems.length === 0 && !loading && !refreshing && (
        <div className="board-note">
          <span>This board is empty. Create the first item with “Add item” in a column.</span>
          <button type="button" className="btn sm primary" onClick={() => openSheet('new-item')}>New work item</button>
        </div>
      )}
      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className="board" onClick={(e) => { if (e.target === e.currentTarget) clearSelection() }}>
          {board.columns.map((c) => {
            const g = grouped.get(c.name) ?? { all: [], doing: [], done: [] }
            return (
              <Column key={c.id} column={c} count={g.all.length} types={typesOf(c.name)} canAdd={board.canEdit !== false && c.columnType !== 'outgoing'} doing={g.doing.map(renderCard)} done={g.done.map(renderCard)}>
                {g.all.map(renderCard)}
              </Column>
            )
          })}
        </div>
        <DragOverlay dropAnimation={null}>
          {dragging && (
            <Card item={dragging} types={ctx?.workItemTypes ?? []} selected={false} multi={false} pending={false} onSelect={() => undefined} onOpen={() => undefined} onContextMenu={() => undefined} overlay />
          )}
        </DragOverlay>
      </DndContext>
    </>
  )
}
