import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, loadApi } from '@/lib/api'
import { STEPS, tcConfig, type TcConfig } from '@/lib/testcases/config'
import { planImport } from '@/lib/testcases/importPlan'
import { parseSteps, stepsToText, type StepItem } from '@/lib/testcases/steps'
import type { Project, WorkItem } from '@/lib/types'
import { useBoardStore } from './useBoardStore'
import { useAppStore } from './useAppStore'
import { useTcStore } from './useTcStore'

const P = 'Contoso Mobile'
let cfg: TcConfig

beforeAll(async () => {
  await loadApi()
  const ctx = await api().getTeamContext('demo', 'p', P, 'team')
  cfg = tcConfig(ctx)!
  useAppStore.setState({ activeOrg: 'demo', selectedProject: { id: 'p', name: P } as Project })
  useBoardStore.setState({ ctx })
})

beforeEach(async () => {
  const tests = await api().projectItems('demo', P, [cfg.type.name], ['Removed'], cfg.extraFields, true)
  const shared = await api().projectItems('demo', P, ['Shared Steps'], [], [STEPS])
  useTcStore.setState({ project: P, cfg, tests, shared, error: null, saveState: {} })
})

const live = (id: number) => api().getWorkItem('demo', P, id)
const local = (id: number) => useTcStore.getState().tests.find((t) => t.id === id) as WorkItem

describe('saving a test case', () => {
  it('keeps every edit when saves follow each other quickly', async () => {
    const s = useTcStore.getState()
    await Promise.all([s.save(1301, { 'System.Title': 'First' }), s.save(1301, { [cfg.sdvField!.referenceName]: 'SDV-0101' }), s.save(1301, { 'System.Title': 'Second' })])
    const now = await live(1301)
    expect(now.fields['System.Title']).toBe('Second')
    expect(now.fields[cfg.sdvField!.referenceName]).toBe('SDV-0101')
    expect(useTcStore.getState().error).toBeNull()
    expect(local(1301).rev).toBe(now.rev)
  })

  it('keeps what was typed when a save fails, and says so', async () => {
    vi.spyOn(api(), 'updateWorkItem').mockRejectedValueOnce({ kind: 'network', message: 'offline' })
    await useTcStore.getState().save(1302, { 'System.Title': 'Typed offline' })
    expect(local(1302).fields['System.Title']).toBe('Typed offline')
    expect(useTcStore.getState().saveState[1302]).toBe('failed')
    vi.restoreAllMocks()
  })
})

describe('recording a run', () => {
  it('updates Last Outcome even though the comment made a new revision', async () => {
    await useTcStore.getState().recordRun(1304, { outcome: 'pass', release: 'v9', date: '2026-10-21', by: 'QA', criteria: [{ text: 'ok', met: true }], steps: [], note: '' }, [])
    const now = await live(1304)
    expect(now.fields[cfg.lastOutcomeField!.referenceName]).toBe('Passed')
    expect(now.fields[cfg.lastReleaseField!.referenceName]).toBe('v9')
    expect(useTcStore.getState().error).toBeNull()
  })
})

describe('filing a bug', () => {
  it('leaves the test case editable afterwards', async () => {
    await useTcStore.getState().createBug(1306, { title: 'x', repro: '<p>x</p>', srsId: null })
    await useTcStore.getState().save(1306, { 'System.Title': 'After the bug' })
    expect((await live(1306)).fields['System.Title']).toBe('After the bug')
    expect(useTcStore.getState().error).toBeNull()
  })
})

describe('reloading', () => {
  it('keeps edits that are still being saved', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const real = api().updateWorkItem
    vi.spyOn(api(), 'updateWorkItem').mockImplementationOnce(async (...a) => { await gate; return real(...a) })
    const saving = useTcStore.getState().save(1308, { 'System.Title': 'Mid-save' })
    await useTcStore.getState().load({ silent: true })
    expect(useTcStore.getState().loadedAt).not.toBeNull()
    expect(local(1308).fields['System.Title']).toBe('Mid-save')
    release(); await saving
    vi.restoreAllMocks()
  })
})

describe('creating a test case', () => {
  it('moves to the next SDV ID when someone else took it at the same moment', async () => {
    const sdvRef = cfg.sdvField!.referenceName
    const before = await api().projectItems('demo', P, [cfg.type.name], [], [sdvRef])
    const next = `SDV-${String(Math.max(...before.map((t) => Number(String(t.fields[sdvRef]).replace(/\D/g, '')) || 0)) + 1).padStart(4, '0')}`
    // Another QA creates the same number just after this app read the list.
    const real = api().projectItems
    vi.spyOn(api(), 'projectItems').mockImplementationOnce(async (...a) => {
      const list = await real(...a)
      await api().createWorkItem('demo', P, cfg.type.name, { 'System.Title': 'Theirs', [sdvRef]: next }, null)
      return list
    })
    const id = await useTcStore.getState().create(null)
    vi.restoreAllMocks()
    const mine = await live(id!)
    expect(mine.fields[sdvRef]).not.toBe(next)
  })
})

describe('importing over an existing test case', () => {
  it('keeps the ids of its steps and its shared steps', async () => {
    const before = await live(1301)
    const prev = parseSteps(before.fields[STEPS] as string)
    const shared = useTcStore.getState().shared
    const titled = prev.map((it): StepItem => (it.kind === 'shared' ? { ...it, title: String(shared.find((w) => w.id === it.ref)?.fields['System.Title']) } : it))
    const lastStep = [...titled].reverse().find((it) => it.kind === 'step')!
    const text = stepsToText(titled).replace(stepsToText([lastStep]).replace(/^1\. /, ''), 'Edited last step')
    const sdv = String(before.fields[cfg.sdvField!.referenceName])
    const plan = planImport([[sdv, text]], { sdv: 0, srs: -1, steps: 1, criteria: -1 }, new Map(), new Map([[sdv, 1301]]))
    await useTcStore.getState().importCases(plan, () => {})
    const after = parseSteps((await live(1301)).fields[STEPS] as string)
    expect(after.map((s) => s.id)).toEqual(prev.map((s) => s.id))
    expect(after.find((s) => s.kind === 'shared')).toMatchObject({ ref: (prev.find((s) => s.kind === 'shared') as { ref: number }).ref })
  })
})
