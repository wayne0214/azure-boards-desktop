import { beforeAll, describe, expect, it, vi } from 'vitest'
import { api, loadApi } from '@/lib/api'
import { useAppStore } from './useAppStore'

beforeAll(async () => {
  await loadApi()
})

describe('boot', () => {
  it('reports unreadable settings instead of spinning forever', async () => {
    const spy = vi.spyOn(api(), 'getSettings').mockRejectedValueOnce({ kind: 'internal', message: 'settings.json is damaged' })
    useAppStore.setState({ booted: false, bootError: null })
    await useAppStore.getState().boot()
    expect(useAppStore.getState().booted).toBe(false)
    expect(useAppStore.getState().bootError).toContain('damaged')
    spy.mockRestore()
  })
})

describe('loadProjects', () => {
  it('ignores projects that arrive after the user switched organization', async () => {
    useAppStore.setState({ activeOrg: 'demo', projects: [] })
    const loading = useAppStore.getState().loadProjects()
    useAppStore.setState({ activeOrg: 'other-org', projects: [] })
    await loading
    expect(useAppStore.getState().projects).toEqual([])
  })
})
