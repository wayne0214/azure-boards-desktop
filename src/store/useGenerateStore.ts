import { create } from 'zustand'
import { api } from '@/lib/api'
import { cleanToolLine, generatePrText, type Generated } from '@/lib/pr/gitTools'
import { branchName } from '@/lib/pr/types'
import { useUiStore } from './useUiStore'

/** What the text is for: a pull request still being created, or one that exists. */
export type GenerateFor =
  | { kind: 'new'; projectId: string; repoId: string; source: string; target: string }
  | { kind: 'pr'; repoId: string; prId: number; source: string; target: string }

export interface GenerateRun {
  id: number
  for: GenerateFor
  status: 'running' | 'done' | 'failed'
  lines: { stream: 'stdout' | 'stderr'; text: string }[]
  startedAt: number
  endedAt?: number
  result?: Generated
  error?: string
  /** Set once a form took the result, so it is not offered again. */
  applied: boolean
}

/** Whether a finished run is for this form's current selection. */
export function sameTarget(a: GenerateFor, b: GenerateFor): boolean {
  if (a.kind !== b.kind || a.repoId !== b.repoId) return false
  if (a.kind === 'pr' && b.kind === 'pr') return a.prId === b.prId
  return a.source === b.source && a.target === b.target
}

// Enough to follow along; a runaway tool cannot grow the panel without limit.
const MAX_LINES = 2000

interface GenerateState {
  run: GenerateRun | null
  /** The output panel; closing it leaves the run going. */
  viewOpen: boolean
  setViewOpen(open: boolean): void
  /** Start git-tools; one run at a time, since it works in the one local checkout. */
  start(target: GenerateFor, confirmBranch: (current: string, wanted: string) => boolean | Promise<boolean>): void
  /** Stop the running git-tools and close the panel. */
  cancel(): void
  /** Hand the result to a form, once. */
  take(target: GenerateFor): Generated | null
}

let seq = 1
// Per run, so a cancel during the folder or branch question stops git-tools from starting at all.
const aborts = new Map<number, AbortController>()

export const useGenerateStore = create<GenerateState>((set, get) => ({
  run: null,
  viewOpen: false,
  setViewOpen: (viewOpen) => set({ viewOpen }),

  start: (target, confirmBranch) => {
    if (get().run?.status === 'running') return
    const id = seq++
    const abort = new AbortController()
    aborts.set(id, abort)
    const update = (patch: Partial<GenerateRun>) => set((s) => (s.run?.id === id ? { run: { ...s.run, ...patch } } : {}))
    set({ run: { id, for: target, status: 'running', lines: [], startedAt: Date.now(), applied: false }, viewOpen: true })
    void generatePrText({
      repoId: target.repoId,
      sourceRef: target.source,
      targetRef: target.target,
      confirmBranch,
      signal: abort.signal,
      onOutput: (line) => {
        const text = cleanToolLine(line.text)
        if (!text) return
        set((s) => (s.run?.id === id ? { run: { ...s.run, lines: [...s.run.lines, { stream: line.stream, text }].slice(-MAX_LINES) } } : {}))
      },
    }).finally(() => aborts.delete(id)).then(
      (result) => {
        // Done: the panel has served its purpose. The form fills itself, or the toast below reopens it.
        set((s) => (s.run?.id === id ? { run: { ...s.run, status: 'done', result, endedAt: Date.now() }, viewOpen: false } : {}))
        // A form showing this selection takes the result as soon as it lands; otherwise point the user to it.
        setTimeout(() => {
          const run = get().run
          if (run?.id !== id || run.applied) return
          useUiStore.getState().toast({
            kind: 'success',
            title: 'Pull request text is ready',
            detail: `${branchName(target.source)} → ${branchName(target.target)}`,
            action: { label: 'View', onClick: () => get().setViewOpen(true) },
          })
        }, 0)
      },
      (e: unknown) => {
        const message = (e as Error)?.message ?? String(e)
        // Picking no folder or declining the branch warning is not a failure worth a red panel.
        if (message === 'cancelled') { set((s) => (s.run?.id === id ? { run: null, viewOpen: false } : {})); return }
        update({ status: 'failed', error: message, endedAt: Date.now() })
      },
    )
  },

  cancel: () => {
    const run = get().run
    if (run?.status !== 'running') return
    // Forget the run first, so its "cancelled" rejection lands on nothing.
    set({ run: null, viewOpen: false })
    aborts.get(run.id)?.abort()
    void api().cancelGitTools().catch(() => {})
    useUiStore.getState().toast({ kind: 'info', title: 'git-tools stopped' })
  },

  take: (target) => {
    const run = get().run
    if (!run || run.status !== 'done' || run.applied || !run.result || !sameTarget(run.for, target)) return null
    set({ run: { ...run, applied: true } })
    return run.result
  },
}))
