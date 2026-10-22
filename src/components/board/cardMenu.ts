import { api, type ContextMenuItem } from '@/lib/api'
import { identityKey, itemUrl } from '@/lib/format'
import type { WorkItem } from '@/lib/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useUiStore } from '@/store/useUiStore'
import { confirmAsync } from '@/lib/confirm'

/** Native right-click menu for one or more work items. */
export function showItemMenu(items: WorkItem[]) {
  if (items.length === 0) return
  const app = useAppStore.getState()
  const b = useBoardStore.getState()
  const ui = useUiStore.getState()
  const org = app.activeOrg
  const project = app.selectedProject
  if (!org || !project) return
  const ids = items.map((i) => i.id)
  const one = items.length === 1 ? items[0] : null
  const me = app.account()
  const members = b.ctx?.members ?? []
  const board = b.board

  const assignMenu: ContextMenuItem[] = [
    { label: 'Me', action: () => me && ids.forEach((id) => void b.assign(id, me.userName)) },
    { label: 'Nobody', action: () => ids.forEach((id) => void b.assign(id, null)) },
    { separator: true },
    ...members.slice(0, 25).map((m) => ({ label: m.displayName, action: () => ids.forEach((id) => void b.assign(id, identityKey(m))) })),
  ]
  const moveMenu: ContextMenuItem[] = (board?.columns ?? []).map((c) => ({
    label: c.name,
    action: () => ids.forEach((id) => void b.moveToColumn(id, c.name, false)),
  }))
  const iterMenu: ContextMenuItem[] = (b.ctx?.iterations ?? [])
    .filter((i) => i.attributes?.timeFrame !== 'past')
    .slice(0, 12)
    .map((i) => ({ label: i.name, action: () => void b.bulkUpdate(ids, { 'System.IterationPath': i.path }) }))
  const priMenu: ContextMenuItem[] = [1, 2, 3, 4].map((p) => ({ label: `P${p}`, action: () => void b.bulkUpdate(ids, { 'Microsoft.VSTS.Common.Priority': p }) }))

  const menu: ContextMenuItem[] = [
    ...(one
      ? [
          { label: 'Open', action: () => { b.select(one.id); ui.toggleInspector(true) } },
          { label: 'Start Work…', action: () => ui.openSheet('start-work', { id: one.id }) },
          { label: 'Open in Browser', action: () => void api().openUrl(itemUrl(org, project.name, one.id)) },
          { label: 'Copy Link', action: () => { void navigator.clipboard.writeText(itemUrl(org, project.name, one.id)); ui.toast({ kind: 'success', title: 'Link copied' }) } },
          { label: 'Copy ID and Title', action: () => { void navigator.clipboard.writeText(`#${one.id} ${one.fields['System.Title'] ?? ''}`); ui.toast({ kind: 'success', title: 'Copied' }) } },
          { separator: true },
        ]
      : [{ label: `${ids.length} items selected`, enabled: false }, { separator: true }]),
    { label: 'Assign To', submenu: assignMenu },
    ...(moveMenu.length ? [{ label: 'Move To Column', submenu: moveMenu }] : []),
    ...(iterMenu.length ? [{ label: 'Set Iteration', submenu: iterMenu }] : []),
    { label: 'Set Priority', submenu: priMenu },
    ...(one ? [{ label: 'Add Child Task…', action: () => ui.openSheet('new-item', { parentId: one.id, type: 'Task' }) }] : []),
    { separator: true },
    {
      label: ids.length === 1 ? 'Move to Recycle Bin' : `Move ${ids.length} Items to Recycle Bin`,
      action: () => {
        void confirmAsync(ids.length === 1 ? `Move #${ids[0]} to the recycle bin?` : `Move ${ids.length} items to the recycle bin?`, { okLabel: 'Move to Recycle Bin', danger: true }).then((ok) => { if (ok) ids.forEach((id) => void b.remove(id)) })
      },
    },
  ]
  void api().showContextMenu(menu)
}
