import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, loadApi } from '@/lib/api'
import type { Project, WorkItem } from '@/lib/types'
import { useAppStore } from './useAppStore'
import { useBoardStore } from './useBoardStore'
import { useUiStore } from './useUiStore'

const P = 'Contoso Mobile'
let item: WorkItem

beforeAll(async () => {
  await loadApi()
  useAppStore.setState({ activeOrg: 'demo', selectedProject: { id: 'p', name: P } as Project })
})

beforeEach(async () => {
  const [first] = await api().projectItems('demo', P, ['Task', 'Bug', 'User Story', 'Product Backlog Item', 'Requirement'], ['Removed'], [])
  item = await api().getWorkItem('demo', P, first.id)
  useBoardStore.setState({ items: [item], pending: new Set() })
  useUiStore.setState({ toasts: [] })
})

const local = (id: number) => useBoardStore.getState().getItem(id)!

describe('updateFields', () => {
  it('saves two quick edits to one item without a conflict', async () => {
    const s = useBoardStore.getState()
    const [a, b] = await Promise.all([
      s.updateFields(item.id, { 'System.Title': 'Edited title' }),
      s.updateFields(item.id, { 'Microsoft.VSTS.Common.Priority': 1 }),
    ])
    expect(a).not.toBeNull()
    expect(b).not.toBeNull()
    const live = await api().getWorkItem('demo', P, item.id)
    expect(live.fields['System.Title']).toBe('Edited title')
    expect(live.fields['Microsoft.VSTS.Common.Priority']).toBe(1)
    expect(local(item.id).rev).toBe(live.rev)
    expect(useBoardStore.getState().pending.has(item.id)).toBe(false)
    expect(useUiStore.getState().toasts).toHaveLength(0)
  })

  it('shows the edit at once and puts back only the failed field', async () => {
    const original = String(item.fields['System.Title'])
    const spy = vi.spyOn(api(), 'updateWorkItem').mockRejectedValueOnce({ kind: 'network', message: 'offline' })
    const save = useBoardStore.getState().updateFields(item.id, { 'System.Title': 'Never saved' })
    expect(local(item.id).fields['System.Title']).toBe('Never saved')
    expect(await save).toBeNull()
    expect(local(item.id).fields['System.Title']).toBe(original)
    spy.mockRestore()
  })
})

describe('updateFields when queued saves fail', () => {
  it('falls back to what Azure DevOps has, not to an earlier unsaved edit', async () => {
    const original = String(item.fields['System.Title'])
    const spy = vi.spyOn(api(), 'updateWorkItem')
      .mockRejectedValueOnce({ kind: 'network', message: 'offline' })
      .mockRejectedValueOnce({ kind: 'network', message: 'offline' })
    const s = useBoardStore.getState()
    await Promise.all([s.updateFields(item.id, { 'System.Title': 'Edit A' }), s.updateFields(item.id, { 'System.Title': 'Edit B' })])
    expect(local(item.id).fields['System.Title']).toBe(original)
    spy.mockRestore()
  })
})

describe('remove', () => {
  it('restores just the item when the delete fails', async () => {
    const other = { ...item, id: item.id + 100000 }
    const spy = vi.spyOn(api(), 'deleteWorkItem').mockImplementationOnce(async () => {
      // A refresh lands while the delete is out.
      useBoardStore.setState((s) => ({ items: [...s.items, other] }))
      throw { kind: 'network', message: 'offline' }
    })
    await useBoardStore.getState().remove(item.id)
    const ids = useBoardStore.getState().items.map((i) => i.id)
    expect(ids).toContain(item.id)
    expect(ids).toContain(other.id)
    spy.mockRestore()
  })
})
