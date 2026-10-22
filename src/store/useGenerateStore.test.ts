import { beforeAll, describe, expect, it } from 'vitest'
import { loadApi } from '@/lib/api'
import { useGenerateStore, type GenerateFor } from './useGenerateStore'

beforeAll(async () => {
  await loadApi()
})

const target: GenerateFor = { kind: 'new', projectId: 'p1', repoId: 'r1', source: 'refs/heads/feature/upload-resume', target: 'refs/heads/main' }

const finished = () => new Promise<void>((resolve) => {
  const stop = useGenerateStore.subscribe((s) => { if (s.run && s.run.status !== 'running') { stop(); resolve() } })
})

describe('useGenerateStore', () => {
  it('streams cleaned output, then hands the result over once', async () => {
    useGenerateStore.getState().start(target, () => true)
    expect(useGenerateStore.getState()).toMatchObject({ viewOpen: true, run: { status: 'running' } })
    // A second start while one is running is ignored.
    const id = useGenerateStore.getState().run!.id
    useGenerateStore.getState().start({ ...target, source: 'refs/heads/other' }, () => true)
    expect(useGenerateStore.getState().run!.id).toBe(id)

    await finished()
    const run = useGenerateStore.getState().run!
    expect(run.status).toBe('done')
    // A finished run closes its panel.
    expect(useGenerateStore.getState().viewOpen).toBe(false)
    const texts = run.lines.map((l) => l.text)
    expect(texts).toContain('✔ Asking the model')
    expect(texts.some((t) => t.includes('\x1b'))).toBe(false)

    expect(useGenerateStore.getState().take({ ...target, source: 'refs/heads/other' })).toBeNull()
    expect(useGenerateStore.getState().take(target)?.title).toBe('Resume chunked uploads after a network drop')
    expect(useGenerateStore.getState().take(target)).toBeNull()
  }, 10_000)

  it('cancel stops the run and closes the panel', async () => {
    useGenerateStore.setState({ run: null, viewOpen: false })
    useGenerateStore.getState().start(target, () => true)
    await new Promise((r) => setTimeout(r, 600))
    useGenerateStore.getState().cancel()
    expect(useGenerateStore.getState()).toMatchObject({ run: null, viewOpen: false })
    // The stopped run's late rejection must not bring anything back.
    await new Promise((r) => setTimeout(r, 1200))
    expect(useGenerateStore.getState().run).toBeNull()
  })

  it('keeps running when the panel is closed', () => {
    useGenerateStore.setState({ run: null, viewOpen: false })
    useGenerateStore.getState().start(target, () => true)
    useGenerateStore.getState().setViewOpen(false)
    expect(useGenerateStore.getState().run?.status).toBe('running')
  })
})
