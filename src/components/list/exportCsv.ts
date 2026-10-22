import { api } from '@/lib/api'
import { csvEscape, identityName, shortDate } from '@/lib/format'
import type { WorkItem } from '@/lib/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useUiStore } from '@/store/useUiStore'
import { matches } from '@/lib/filter'

export function itemsToCsv(items: WorkItem[]): string {
  const cols = ['ID', 'Type', 'Title', 'State', 'Assigned To', 'Priority', 'Points', 'Iteration', 'Area', 'Tags', 'Created', 'Changed']
  const lines = [cols.join(',')]
  for (const it of items) {
    const f = it.fields
    lines.push([
      it.id,
      f['System.WorkItemType'],
      f['System.Title'],
      f['System.State'],
      identityName(f['System.AssignedTo']),
      f['Microsoft.VSTS.Common.Priority'],
      f['Microsoft.VSTS.Scheduling.StoryPoints'] ?? f['Microsoft.VSTS.Scheduling.Effort'],
      f['System.IterationPath'],
      f['System.AreaPath'],
      f['System.Tags'],
      shortDate(f['System.CreatedDate']),
      shortDate(f['System.ChangedDate']),
    ].map(csvEscape).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

export async function exportCsv() {
  const b = useBoardStore.getState()
  const app = useAppStore.getState()
  const ui = useUiStore.getState()
  const me = app.account()
  const items = b.items.filter((i) => matches(i, b.filters, { id: me?.userId, name: me?.userName }))
  if (items.length === 0) {
    ui.toast({ kind: 'info', title: 'Nothing to export' })
    return
  }
  const name = `${app.selectedProject?.name ?? 'work-items'} ${new Date().toISOString().slice(0, 10)}.csv`.replace(/[\\/:*?"<>|]/g, '-')
  const path = await api().pickSavePath(name)
  if (!path) return
  try {
    await api().writeTextFile(path, itemsToCsv(items))
    ui.toast({ kind: 'success', title: `Exported ${items.length} items` })
  } catch (e) {
    ui.toast({ kind: 'error', title: 'Export failed', detail: String((e as { message?: string }).message ?? e) })
  }
}
