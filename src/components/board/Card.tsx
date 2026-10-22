import { useDraggable } from '@dnd-kit/core'
import { MessageSquare } from 'lucide-react'
import { memo } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { htmlToText, pointsOf, stateColor, tagsOf, typeColor } from '@/lib/format'
import { idLikeField } from '@/lib/customFields'
import type { WorkItem, WorkItemType } from '@/lib/types'

interface Props {
  item: WorkItem
  types: WorkItemType[]
  selected: boolean
  multi: boolean
  pending: boolean
  onSelect: (e: React.MouseEvent) => void
  onOpen: () => void
  onContextMenu: (e: React.MouseEvent) => void
  overlay?: boolean
}

export const Card = memo(function Card({ item, types, selected, multi, pending, onSelect, onOpen, onContextMenu, overlay }: Props) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: item.id, disabled: overlay })
  const f = item.fields
  const type = String(f['System.WorkItemType'] ?? '')
  const who = f['System.AssignedTo']
  const tags = tagsOf(item)
  const pri = f['Microsoft.VSTS.Common.Priority']
  const pts = pointsOf(item)
  const comments = f['System.CommentCount']
  const wit = types.find((t) => t.name === type)
  const extId = idLikeField(wit)
  const extIdValue = extId ? htmlToText(String(f[extId.referenceName] ?? '')) : ''
  const reporter = type === 'Bug' ? (f['System.CreatedBy'] as { displayName?: string } | undefined)?.displayName : undefined
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={`card ${selected ? 'selected' : ''} ${multi ? 'multi' : ''} ${pending ? 'pending' : ''} ${isDragging ? 'dragging' : ''} ${overlay ? 'card-overlay' : ''}`}
      style={{ ['--type-color' as string]: typeColor(types, type), ['--state-color' as string]: stateColor(types, type, String(f['System.State'] ?? '')) }}
      onClick={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={onContextMenu}
      data-id={item.id}
      tabIndex={-1}
      role="button"
    >
      <div className="card-top">
        <span className="type"><span className="state-dot" />{type}</span>
        <span className="id">#{item.id}</span>
        {extIdValue !== '' && <span className="ext-id" title={extId?.name}>{extIdValue}</span>}
        {reporter && <span className="by" title={`Reported by ${reporter}`}>by {reporter.split(' ')[0]}</span>}
        <span className="grow" />
        {typeof pri === 'number' && <span className={`pri p${pri}`}>P{pri}</span>}
      </div>
      <div className="card-title">{String(f['System.Title'] ?? '')}</div>
      <div className="card-bottom">
        {tags.slice(0, 3).map((t) => (<span key={t} className="tag">{t}</span>))}
        {tags.length > 3 && <span className="tag">+{tags.length - 3}</span>}
        <span className="grow" />
        {typeof comments === 'number' && comments > 0 && <span className="meta"><MessageSquare size={12} />{comments}</span>}
        {pts !== undefined && <span className="pts" title="Points">{pts}</span>}
        <Avatar name={(who as { displayName?: string } | undefined)?.displayName} keyName={(who as { uniqueName?: string } | undefined)?.uniqueName} size="sm" />
      </div>
    </div>
  )
})
