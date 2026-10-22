import { useDroppable } from '@dnd-kit/core'
import type { ReactNode } from 'react'
import type { BoardColumn } from '@/lib/types'
import { QuickAdd } from './QuickAdd'

interface Props {
  column: BoardColumn
  count: number
  types: string[]
  doing?: ReactNode
  done?: ReactNode
  children?: ReactNode
  canAdd: boolean
}

export function Column({ column, count, types, children, doing, done, canAdd }: Props) {
  const overLimit = column.itemLimit > 0 && count > column.itemLimit
  return (
    <section className={`column ${column.isSplit ? 'split' : ''}`} aria-label={column.name}>
      <header className="column-head">
        <span className="name" title={column.description || column.name}>{column.name}</span>
        <span className={`count ${overLimit ? 'over' : ''}`} title={column.itemLimit ? `${count} of ${column.itemLimit} allowed` : `${count} items`}>
          {count}{column.itemLimit > 0 ? ` / ${column.itemLimit}` : ''}
        </span>
      </header>
      {column.isSplit ? (
        <div className="column-split">
          <DropPane id={`${column.name}::doing`} label="Doing">{doing}</DropPane>
          <DropPane id={`${column.name}::done`} label="Done">{done}</DropPane>
        </div>
      ) : (
        <DropPane id={column.name}>{children}</DropPane>
      )}
      {canAdd && <QuickAdd column={column} types={types} />}
    </section>
  )
}

function DropPane({ id, label, children }: { id: string; label?: string; children?: ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  const empty = !children || (Array.isArray(children) && children.length === 0)
  return (
    <div ref={setNodeRef} className={`split-pane ${isOver ? 'over' : ''}`} style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {label && <div className="split-label">{label}</div>}
      <div className="column-body">
        {empty ? <div className="column-empty">{isOver ? 'Drop here' : 'Nothing here'}</div> : children}
      </div>
    </div>
  )
}
