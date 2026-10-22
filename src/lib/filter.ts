import { useMemo } from 'react'
import { identityKey, tagsOf } from './format'
import type { WorkItem } from './types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore, type Filters } from '@/store/useBoardStore'

export function matches(item: WorkItem, f: Filters, meKey: { id?: string; name?: string }): boolean {
  const title = String(item.fields['System.Title'] ?? '').toLowerCase()
  const type = String(item.fields['System.WorkItemType'] ?? '')
  const who = item.fields['System.AssignedTo']
  const tags = tagsOf(item)
  if (f.search) {
    const q = f.search.trim().toLowerCase()
    const idMatch = q.startsWith('#') ? String(item.id) === q.slice(1) : String(item.id).includes(q)
    const tagMatch = tags.some((t) => t.toLowerCase().includes(q))
    const whoMatch = who && typeof who === 'object' && (who as { displayName?: string }).displayName?.toLowerCase().includes(q)
    if (!(title.includes(q) || idMatch || tagMatch || whoMatch)) return false
  }
  if (f.mine) {
    const w = who as { id?: string; displayName?: string } | undefined
    if (!w) return false
    if (!(w.id && w.id === meKey.id) && !(w.displayName && w.displayName === meKey.name)) return false
  }
  if (f.types.length && !f.types.includes(type)) return false
  if (f.assignees.length) {
    const key = identityKey(who as never)
    const w = who as { id?: string } | undefined
    if (!f.assignees.includes(key) && !(w?.id && f.assignees.includes(w.id))) return false
  }
  if (f.tags.length && !f.tags.some((t) => tags.includes(t))) return false
  if (f.iterationPath) {
    const ip = String(item.fields['System.IterationPath'] ?? '')
    if (!(ip === f.iterationPath || ip.startsWith(f.iterationPath + '\\'))) return false
  }
  return true
}

export function useVisibleItems(): WorkItem[] {
  const items = useBoardStore((s) => s.items)
  const filters = useBoardStore((s) => s.filters)
  const account = useAppStore((s) => s.settings.accounts.find((a) => a.org === s.activeOrg))
  return useMemo(() => items.filter((i) => matches(i, filters, { id: account?.userId, name: account?.userName })), [items, filters, account?.userId, account?.userName])
}
