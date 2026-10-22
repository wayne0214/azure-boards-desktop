import { X } from 'lucide-react'
import { useVisibleItems } from '@/lib/filter'
import { useBoardStore } from '@/store/useBoardStore'

/** Shows active filters as removable chips. Hidden when nothing is filtered. */
export function FilterBar() {
  const filters = useBoardStore((s) => s.filters)
  const setFilters = useBoardStore((s) => s.setFilters)
  const clearFilters = useBoardStore((s) => s.clearFilters)
  const ctx = useBoardStore((s) => s.ctx)
  const total = useBoardStore((s) => s.items.length)
  const visible = useVisibleItems().length
  const chips: { label: string; remove: () => void }[] = []
  if (filters.iterationPath) chips.push({ label: `Iteration: ${ctx?.iterations.find((i) => i.path === filters.iterationPath)?.name ?? filters.iterationPath.split('\\').pop()}`, remove: () => setFilters({ iterationPath: null }) })
  if (filters.search) chips.push({ label: `“${filters.search}”`, remove: () => setFilters({ search: '' }) })
  if (filters.mine) chips.push({ label: 'Assigned to me', remove: () => setFilters({ mine: false }) })
  for (const t of filters.types) chips.push({ label: t, remove: () => setFilters({ types: filters.types.filter((x) => x !== t) }) })
  for (const a of filters.assignees) chips.push({ label: ctx?.members.find((m) => (m.uniqueName ?? m.id) === a)?.displayName ?? a, remove: () => setFilters({ assignees: filters.assignees.filter((x) => x !== a) }) })
  for (const t of filters.tags) chips.push({ label: `#${t}`, remove: () => setFilters({ tags: filters.tags.filter((x) => x !== t) }) })
  if (chips.length === 0) return null
  return (
    <div className="filter-bar">
      {chips.map((c) => (
        <span key={c.label} className="chip">{c.label}<button type="button" onClick={c.remove} aria-label={`Remove ${c.label}`}><X size={12} /></button></span>
      ))}
      <span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>{visible} of {total}</span>
      <button type="button" className="clear-all" onClick={clearFilters}>Clear</button>
    </div>
  )
}
