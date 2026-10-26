import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, loadApi } from '@/lib/api'
import { useAppStore } from './useAppStore'
import { useWikiStore } from './useWikiStore'

const project = { id: 'p1', name: 'Contoso Mobile' }

beforeAll(async () => { await loadApi() })

describe('useWikiStore', () => {
  beforeEach(async () => {
    localStorage.clear()
    useAppStore.setState({ activeOrg: 'demo-org' })
    useWikiStore.setState({ project: null, tree: null, path: null, page: null, draft: null, search: null })
    await useWikiStore.getState().load(project)
  })

  it('opens the project wiki at Home', () => {
    const s = useWikiStore.getState()
    expect(s.wikis[0].type).toBe('projectWiki')
    expect(s.path).toBe('/Home')
    expect(s.page?.content).toContain('# Contoso Mobile')
  })

  it('saves an edit and keeps the new version', async () => {
    const s = useWikiStore.getState()
    await s.open('/Onboarding')
    s.edit()
    s.setDraft(`${useWikiStore.getState().draft}\n4. Say hello.`)
    expect(await useWikiStore.getState().save()).toBe(true)
    const after = useWikiStore.getState()
    expect(after.draft).toBeNull()
    expect(after.page?.content).toContain('Say hello')
    expect(after.page?.version).toBe('"v2"')
  })

  it('keeps the edit when someone else saved first', async () => {
    const s = useWikiStore.getState()
    await s.open('/Collaborator feedback')
    s.edit()
    s.setDraft('mine')
    const page = useWikiStore.getState().page!
    await api().wikiSave('demo-org', project.name, 'w1', page.path, 'theirs', page.version!, null)
    expect(await useWikiStore.getState().save()).toBe(false)
    expect(useWikiStore.getState().draft).toBe('mine')
  })

  it('asks before leaving unsaved changes', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    useWikiStore.getState().edit()
    useWikiStore.getState().setDraft('changed')
    await useWikiStore.getState().open('/Onboarding')
    expect(confirm).toHaveBeenCalled()
    expect(useWikiStore.getState().path).toBe('/Home')
    expect(useWikiStore.getState().draft).toBe('changed')
    confirm.mockRestore()
  })

  it('drops the old page as soon as another is opened, so Edit cannot start from it', async () => {
    const opening = useWikiStore.getState().open('/Onboarding')
    expect(useWikiStore.getState().page).toBeNull()
    useWikiStore.getState().edit()
    expect(useWikiStore.getState().draft).toBeNull()
    await opening
    expect(useWikiStore.getState().page?.path).toBe('/Onboarding')
  })

  it('keeps the version an edit started from when its page is opened again', async () => {
    useWikiStore.getState().edit()
    useWikiStore.getState().setDraft('mine')
    const version = useWikiStore.getState().page!.version
    await api().wikiSave('demo-org', project.name, 'w1', '/Home', 'theirs', version!, null)
    await useWikiStore.getState().open('/Home')
    expect(useWikiStore.getState().page?.version).toBe(version)
    expect(await useWikiStore.getState().save()).toBe(false)
    expect(useWikiStore.getState().draft).toBe('mine')
  })

  it('creates a page under another and starts editing it', async () => {
    expect(await useWikiStore.getState().createPage('/Decision log', '0003 Offline mode')).toBe(true)
    const s = useWikiStore.getState()
    expect(s.path).toBe('/Decision log/0003 Offline mode')
    expect(s.draft).toBe('# 0003 Offline mode\n\n')
    expect(await useWikiStore.getState().createPage('/', 'a#b')).toBe(false)
  })
})
