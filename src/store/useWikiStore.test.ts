import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, loadApi } from '@/lib/api'
import { useAppStore } from './useAppStore'
import { unseenChanges, useWikiStore } from './useWikiStore'
import { useUiStore } from './useUiStore'

const project = { id: 'p1', name: 'Contoso Mobile' }

beforeAll(async () => { await loadApi() })

describe('useWikiStore', () => {
  beforeEach(async () => {
    localStorage.clear()
    useAppStore.setState({ activeOrg: 'demo-org' })
    useWikiStore.setState({ project: null, tree: null, path: null, page: null, draft: null, creating: null, search: null })
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

  it('writes a new page only when it is saved', async () => {
    expect(await useWikiStore.getState().createPage('/Decision log', '0009 Offline mode')).toBe(true)
    let s = useWikiStore.getState()
    expect(s.path).toBe('/Decision log/0009 Offline mode')
    expect(s.draft).toBe('# 0009 Offline mode\n\n')
    await expect(api().wikiPage('demo-org', project.name, 'w1', s.path!, null)).rejects.toBeTruthy()
    expect(await useWikiStore.getState().save()).toBe(true)
    s = useWikiStore.getState()
    expect(s.creating).toBeNull()
    expect((await api().wikiPage('demo-org', project.name, 'w1', '/Decision log/0009 Offline mode', null)).content).toBe('# 0009 Offline mode\n\n')
    expect(await useWikiStore.getState().createPage('/', 'a#b')).toBe(false)
    expect(await useWikiStore.getState().createPage('/', 'Home')).toBe(false)
  })

  it('creates missing parents and goes back on cancel', async () => {
    await useWikiStore.getState().createPage('/Release notes', '1.4.0', '# 1.4.0')
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await useWikiStore.getState().cancelEdit()
    expect(useWikiStore.getState().path).toBe('/Home')
    await useWikiStore.getState().createPage('/Release notes', '1.4.0', '# 1.4.0')
    expect(await useWikiStore.getState().save()).toBe(true)
    expect((await api().wikiPage('demo-org', project.name, 'w1', '/Release notes', null)).content).toBe('# Release notes\n')
    vi.restoreAllMocks()
  })

  it('saves @names as mentions and shows them as names when editing', async () => {
    await useWikiStore.getState().open('/Onboarding')
    await vi.waitFor(() => expect(useWikiStore.getState().people.length).toBeGreaterThan(0))
    useWikiStore.getState().edit()
    useWikiStore.getState().setDraft(`${useWikiStore.getState().draft}\n\nAsk @Priya Natarajan.`)
    expect(await useWikiStore.getState().save()).toBe(true)
    expect(useWikiStore.getState().page!.content).toContain('Ask @<u2>.')
    useWikiStore.getState().edit()
    expect(useWikiStore.getState().draft).toContain('Ask @Priya Natarajan.')
    useWikiStore.getState().setDraft(useWikiStore.getState().draft!)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await useWikiStore.getState().open('/Home')
    // Nothing changed, so leaving does not ask.
    expect(window.confirm).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('turns new actions into tasks and links them on the page', async () => {
    await useWikiStore.getState().createPage('/Meeting notes', '2026-10-27 Standup', '# Standup\n\n## Actions\n- [ ] @Priya Natarajan check the upload limit\n- [ ] Ask legal about storage\n- [ ] Done already #1164\n')
    await useWikiStore.getState().save()
    await useWikiStore.getState().open('/Meeting notes/2026-10-27 Standup')
    expect(await useWikiStore.getState().createTasks()).toBe(2)
    const content = useWikiStore.getState().page!.content
    const ids = [...content.matchAll(/ #(\d{4})$/gm)].map((m) => Number(m[1])).filter((n) => n !== 1164)
    expect(ids).toHaveLength(2)
    const task = await api().getWorkItem('demo-org', project.name, ids[0])
    expect(task.fields['System.WorkItemType']).toBe('Task')
    expect(task.fields['System.Title']).toBe('check the upload limit')
    expect((task.fields['System.AssignedTo'] as { displayName: string }).displayName).toBe('Priya Natarajan')
    expect(await useWikiStore.getState().createTasks()).toBe(0)
  })

  it('keeps text typed while a save is under way, and saves once', async () => {
    await useWikiStore.getState().open('/Onboarding')
    useWikiStore.getState().edit()
    useWikiStore.getState().setDraft(`${useWikiStore.getState().draft}\nfirst`)
    const saving = useWikiStore.getState().save()
    expect(await useWikiStore.getState().save()).toBe(false)
    useWikiStore.getState().setDraft(`${useWikiStore.getState().draft}\nsecond`)
    expect(await saving).toBe(true)
    const s = useWikiStore.getState()
    expect(s.page!.content).toMatch(/first$/)
    expect(s.draft).toMatch(/first\nsecond$/)
    expect(await useWikiStore.getState().save()).toBe(true)
    expect(useWikiStore.getState().page!.content).toMatch(/second$/)
  })

  it('links new tasks on their own page even after moving to another', async () => {
    await useWikiStore.getState().createPage('/Meeting notes', '2026-10-28 Retro', '# Retro\n\n- [ ] Ask legal about storage\n')
    await useWikiStore.getState().save()
    const making = useWikiStore.getState().createTasks()
    void useWikiStore.getState().open('/Home')
    expect(await making).toBe(1)
    const retro = await api().wikiPage('demo-org', project.name, 'w1', '/Meeting notes/2026-10-28 Retro', null)
    expect(retro.content).toMatch(/- \[ \] Ask legal about storage #\d+/)
    expect((await api().wikiPage('demo-org', project.name, 'w1', '/Home', null)).content).not.toContain('Ask legal')
  })

  it('links the requirement a piece of feedback became', async () => {
    await useWikiStore.getState().open('/Collaborator feedback/2026-10-22 Parent survey')
    expect(await useWikiStore.getState().linkItem(1159)).toBe(true)
    expect(useWikiStore.getState().page!.content).toContain('## Became\n- #1159')
    expect(useWikiStore.getState().page!.content).not.toContain('Not linked yet')
    await useWikiStore.getState().linkItem(1159)
    expect(useWikiStore.getState().page!.content.match(/#1159/g)).toHaveLength(1)
  })

  it('starts meeting notes from a booking, with last time’s open actions', async () => {
    useAppStore.setState({ selectedProject: project })
    await useWikiStore.getState().notesFor({ id: 'b1', subcalendar_ids: [1], title: 'Sprint planning', who: 'Wayne Lai', start_dt: '2026-10-27T10:00:00', end_dt: '2026-10-27T10:30:00', all_day: false }, 'Room A')
    const s = useWikiStore.getState()
    expect(useUiStore.getState().view).toBe('wiki')
    expect(s.path).toBe('/Meeting notes/2026-10-27 Sprint planning')
    expect(s.creating).not.toBeNull()
    expect(s.draft).toContain('**Room:** Room A')
    expect(s.draft).toContain('## Open from last time')
    expect(s.draft).toContain('Tom: retake button design')
  })

  it('lists pages others changed since I last looked, and mentions of me', async () => {
    useAppStore.setState((st) => ({ settings: { ...st.settings, accounts: [{ org: 'demo-org', userId: 'u1', userName: 'Wayne Lai' }] } }))
    await useWikiStore.getState().loadChanges()
    const s = useWikiStore.getState()
    const unseen = unseenChanges(s).map((c) => c.path)
    expect(unseen).toContain('/Collaborator feedback/2026-10 Clinic pilot')
    expect(unseen).not.toContain('/Home')
    expect(s.mentionsOfMe.map((m) => m.path)).toEqual(['/Collaborator feedback/2026-10 Clinic pilot'])
    await useWikiStore.getState().open('/Collaborator feedback/2026-10 Clinic pilot')
    expect(unseenChanges(useWikiStore.getState()).map((c) => c.path)).not.toContain('/Collaborator feedback/2026-10 Clinic pilot')
  })
})
