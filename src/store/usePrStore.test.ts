import { beforeAll, describe, expect, it } from 'vitest'
import { api, loadApi } from '@/lib/api'
import type { Project } from '@/lib/types'
import { useAppStore } from './useAppStore'
import { usePrStore } from './usePrStore'

beforeAll(async () => {
  await loadApi()
  useAppStore.setState({ activeOrg: 'demo', projects: [{ id: 'p1', name: 'Contoso Mobile' } as Project] })
})

describe('loadChanges', () => {
  it('drops the files of a pull request the user already left', async () => {
    const [a, b] = (await api().prList('demo', 'Contoso Mobile', 'active')).slice(0, 2)
    const detail = await api().prDetail('demo', 'p1', a.repository.id, a.pullRequestId)
    usePrStore.setState({ selected: { repoId: a.repository.id, prId: a.pullRequestId, projectId: 'p1', projectName: 'Contoso Mobile' }, detail, changes: [], files: {}, activeFile: null })
    const loading = usePrStore.getState().loadChanges()
    // The user opens another pull request before the first answer arrives.
    usePrStore.setState({ selected: { repoId: b.repository.id, prId: b.pullRequestId, projectId: 'p1', projectName: 'Contoso Mobile' }, changes: [], files: {}, activeFile: null })
    await loading
    expect(usePrStore.getState().changes).toEqual([])
    expect(usePrStore.getState().activeFile).toBeNull()
  })
})

describe('closing the detail', () => {
  it('a different list tab closes the open pull request', () => {
    usePrStore.setState({ selected: { repoId: 'r1', prId: 1, projectId: 'p1', projectName: 'Contoso Mobile' } })
    usePrStore.getState().setTab('closed')
    expect(usePrStore.getState().selected).toBeNull()
  })
})
