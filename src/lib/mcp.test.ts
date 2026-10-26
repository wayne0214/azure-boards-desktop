import { beforeEach, describe, expect, it } from 'vitest'
import { openPrForm, type McpPrForm } from './mcp'
import { useUiStore } from '@/store/useUiStore'

const form: McpPrForm = { projectId: 'p1', repoId: 'r1', source: 'refs/heads/feature/x', target: 'refs/heads/develop', title: 'feat: x', description: 'Adds x', isDraft: false, workItemIds: [12] }

describe('openPrForm', () => {
  beforeEach(() => useUiStore.setState({ sheet: null, sheetPayload: null, toasts: [], view: 'board' }))

  it('opens the filled-in New pull request form', () => {
    openPrForm(form)
    const s = useUiStore.getState()
    expect(s.sheet).toBe('new-pr')
    expect(s.view).toBe('prs')
    expect(s.sheetPayload).toMatchObject({ repoId: 'r1', title: 'feat: x', description: 'Adds x', workItemIds: [12] })
  })

  it('offers it in a toast instead of replacing a form the user has open', () => {
    useUiStore.setState({ sheet: 'new-item' })
    openPrForm(form)
    const s = useUiStore.getState()
    expect(s.sheet).toBe('new-item')
    expect(s.toasts).toHaveLength(1)
    s.toasts[0].action?.onClick()
    expect(useUiStore.getState().sheet).toBe('new-pr')
  })
})
