import { create } from 'zustand'
import { isTauri } from '@/lib/api'
import { listProjectsBody, readWeekBody, saveRowBody, submitAllBody } from '@/lib/timesheet/agent'
import { LoginRequired, clearSession, goto, hide, onSite, pageSettled, peek, reload, runEditOp, runOp, show, signedIn, trace, tryAutoLogin } from '@/lib/timesheet/client'
import { useUiStore } from './useUiStore'


export type RowStatus = 'draft' | 'saved' | 'submitted' | 'approved' | 'rejected'

export interface TsRow {
  project: string
  hours: number[] // Sun..Sat
  note: string
  status: RowStatus
  locked: boolean
  dirty: boolean
}

interface SiteRow {
  project: string
  hours: number[]
  total: number
  status: 'saved' | 'submitted' | 'approved' | 'rejected'
  locked: boolean
}

const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase()

/** The site row for a project: an exact name, or one the grid cut short ("…") that fits only this project. */
export function findSiteRow<R extends { project: string }>(rows: R[], project: string): R | null {
  const want = norm(project)
  const exact = rows.find((r) => norm(r.project) === want)
  if (exact) return exact
  const near = rows.filter((r) => {
    const shown = norm(r.project).replace(/(\u2026|\.\.\.)$/, '').trim()
    return (shown.length >= 20 && want.startsWith(shown)) || (want.length >= 20 && shown.startsWith(want))
  })
  return near.length === 1 ? near[0] : null
}

export type Phase = 'idle' | 'connecting' | 'login' | 'ready' | 'working' | 'error'

interface TimesheetState {
  baseUrl: string
  phase: Phase
  message: string | null
  projects: string[]
  weekStart: string // YYYY-MM-DD, a Sunday
  rows: TsRow[]
  lastRead: number | null
  progress: { done: number; total: number; label: string } | null
  log: string[]

  setBaseUrl(url: string): void
  connect(): Promise<void>
  openWindow(): Promise<void>
  reloadWindow(): Promise<void>
  /** Clear the timesheet site's cookies and storage, then connect again (signed out). */
  resetSession(): Promise<void>
  finishLogin(): Promise<void>
  /** `onPage`: the window already shows this week, so read it without loading the page again. */
  loadWeek(weekStart?: string, opts?: { onPage?: boolean }): Promise<void>
  shiftWeek(delta: number): Promise<void>
  setHours(project: string, day: number, value: number): void
  setNote(project: string, note: string): void
  addRow(project: string): void
  removeRow(project: string): void
  fillWeekdays(project: string, hours: number): void
  copyLastWeek(): Promise<void>
  save(): Promise<boolean>
  saveAndSubmit(): Promise<void>
}

const readLS = <T,>(k: string, fb: T): T => {
  try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : fb } catch { return fb }
}
const writeLS = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* ignore */ } }

export function sundayOf(d: Date): string {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - x.getDay())
  return toISODate(x)
}
export function toISODate(d: Date): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return toISODate(d)
}

function draftKey(weekStart: string) {
  return `ts.draft.${weekStart}`
}

function mergeSiteRows(site: SiteRow[], drafts: TsRow[]): TsRow[] {
  const out: TsRow[] = site.map((r) => ({ project: r.project, hours: r.hours, note: '', status: r.status, locked: r.locked, dirty: false }))
  for (const d of drafts) {
    const idx = out.findIndex((r) => r.project.toLowerCase() === d.project.toLowerCase())
    if (idx === -1) out.push({ ...d, status: 'draft', locked: false, dirty: true })
    else if (!out[idx].locked && d.dirty) out[idx] = { ...out[idx], hours: d.hours, note: d.note, dirty: true }
  }
  return out
}

export const useTimesheetStore = create<TimesheetState>((set, get) => ({
  baseUrl: readLS('ts.baseUrl', ''),
  phase: 'idle',
  message: null,
  projects: readLS<string[]>('ts.projects', []),
  weekStart: sundayOf(new Date()),
  rows: [],
  lastRead: null,
  progress: null,
  log: [],

  setBaseUrl: (url) => { writeLS('ts.baseUrl', url); set({ baseUrl: url.replace(/\/+$/, '') }) },

  connect: async () => {
    if (!isTauri) {
      set({ phase: 'error', message: 'The timesheet needs the desktop app (it is not available in browser demo mode).' })
      return
    }
    if (!get().baseUrl) {
      set({ phase: 'error', message: 'Enter your TimeSheet address in Settings first.' })
      return
    }
    set({ phase: 'connecting', message: null })
    trace('connect start')
    try {
      let probe = await goto(`${get().baseUrl}/timsheetentrybydate/${get().weekStart}`)
      trace(`probe ${JSON.stringify(probe)}`)
      if (probe.login) {
        // Often the Entra session is still alive and the button signs in without asking.
        const silent = await tryAutoLogin(get().baseUrl)
        trace(`auto-login ${silent}`)
        if (!silent) {
          set({ phase: 'login', message: 'Sign in once in the timesheet window. The app remembers the session after that.' })
          await show()
          return
        }
        probe = await goto(`${get().baseUrl}/timsheetentrybydate/${get().weekStart}`)
        if (probe.login) { set({ phase: 'login', message: 'Sign in in the timesheet window.' }); await show(); return }
      }
      if (get().projects.length === 0) {
        const projects = await runEditOp<string[]>(listProjectsBody)
        writeLS('ts.projects', projects)
        set({ projects })
      }
      // Stay on "Connecting…" until the hours are read; the window is already on this week.
      await get().loadWeek(undefined, { onPage: true })
    } catch (e) {
      trace(`connect error ${(e as Error).message}`)
      if (e instanceof LoginRequired) { set({ phase: 'login', message: 'Sign in once in the timesheet window.' }); await show(); return }
      set({ phase: 'error', message: String((e as Error).message ?? e) })
    }
  },

  openWindow: async () => { await show() },
  reloadWindow: async () => { await show(); await reload() },

  resetSession: async () => {
    if (!isTauri || !get().baseUrl) return
    set({ phase: 'connecting', message: null, progress: null, rows: [] })
    trace('reset session')
    try {
      await clearSession(get().baseUrl)
    } catch (e) {
      set({ phase: 'error', message: `Could not clear the timesheet cookies: ${(e as Error).message ?? e}` })
      return
    }
    useUiStore.getState().toast({ kind: 'success', title: 'Timesheet cookies cleared', detail: 'Sign in again in the timesheet window.' })
    await get().connect()
  },

  finishLogin: async () => {
    // Polled while the user signs in. It must only look at the page, never navigate,
    // or it would interrupt the sign-in redirects.
    const p = await peek()
    if (!p) return
    // Still on the site's login page, or somewhere in Microsoft's sign-in pages: leave it alone.
    if (!signedIn(p, get().baseUrl)) {
      if (onSite(p, get().baseUrl) && p.login && get().phase !== 'login') set({ phase: 'login' })
      return
    }
    set({ phase: 'connecting', message: null })
    try {
      await hide()
      const probe = await goto(`${get().baseUrl}/timsheetentrybydate/${get().weekStart}`, { timeoutMs: 30000 })
      if (probe.login) { set({ phase: 'login', message: 'Still on the sign-in page. Finish signing in, then try again.' }); await show(); return }
      const projects = await runEditOp<string[]>(listProjectsBody)
      writeLS('ts.projects', projects)
      set({ projects })
      await get().loadWeek(undefined, { onPage: true })
    } catch (e) {
      set({ phase: 'error', message: String((e as Error).message ?? e) })
    }
  },

  loadWeek: async (weekStart, opts) => {
    const ws = weekStart ?? get().weekStart
    const drafts = readLS<TsRow[]>(draftKey(ws), [])
    set({ weekStart: ws, rows: mergeSiteRows([], drafts), phase: get().phase === 'ready' || get().phase === 'working' ? 'working' : get().phase })
    if (!isTauri || get().phase === 'login' || get().phase === 'error' || get().phase === 'idle') return
    try {
      if (!opts?.onPage) await goto(`${get().baseUrl}/timsheetentrybydate/${ws}`)
      const week = await runOp<{ rows: SiteRow[] }>(readWeekBody)
      if (get().weekStart !== ws) return
      let rows = mergeSiteRows(week.rows, drafts)
      // An empty week starts with last week's projects, hours left blank so nothing is submitted by accident.
      // "Copy last week" still copies the hours when that is wanted.
      if (rows.length === 0) {
        const last = readLS<TsRow[]>(`ts.last.${addDays(ws, -7)}`, [])
        if (last.length) rows = last.map((r) => ({ ...r, hours: [0, 0, 0, 0, 0, 0, 0], note: '', status: 'draft', locked: false, dirty: true }))
      }
      set({ rows, phase: 'ready', lastRead: Date.now(), message: null })
      if (week.rows.length) writeLS(`ts.last.${ws}`, week.rows.map((r) => ({ project: r.project, hours: r.hours, note: '', status: r.status, locked: false, dirty: false })))
    } catch (e) {
      if (e instanceof LoginRequired) {
        if (await tryAutoLogin(get().baseUrl)) { set({ phase: 'ready' }); return get().loadWeek(ws) }
        set({ phase: 'login', message: 'Your timesheet session expired. Sign in again in the window.' }); await show(); return
      }
      set({ phase: 'error', message: String((e as Error).message ?? e) })
    }
  },

  shiftWeek: async (delta) => { await get().loadWeek(addDays(get().weekStart, delta * 7)) },

  setHours: (project, day, value) => set((s) => {
    const rows = s.rows.map((r) => (r.project === project && !r.locked ? { ...r, hours: r.hours.map((h, i) => (i === day ? value : h)), dirty: true } : r))
    writeLS(draftKey(s.weekStart), rows.filter((r) => r.dirty))
    return { rows }
  }),
  setNote: (project, note) => set((s) => {
    const rows = s.rows.map((r) => (r.project === project && !r.locked ? { ...r, note, dirty: true } : r))
    writeLS(draftKey(s.weekStart), rows.filter((r) => r.dirty))
    return { rows }
  }),
  addRow: (project) => set((s) => {
    if (s.rows.some((r) => r.project === project)) return {}
    const rows = [...s.rows, { project, hours: [0, 0, 0, 0, 0, 0, 0], note: '', status: 'draft' as RowStatus, locked: false, dirty: true }]
    writeLS(draftKey(s.weekStart), rows.filter((r) => r.dirty))
    return { rows }
  }),
  removeRow: (project) => set((s) => {
    const rows = s.rows.filter((r) => !(r.project === project && r.status === 'draft'))
    writeLS(draftKey(s.weekStart), rows.filter((r) => r.dirty))
    return { rows }
  }),
  fillWeekdays: (project, hours) => set((s) => {
    const rows = s.rows.map((r) => (r.project === project && !r.locked ? { ...r, hours: [0, hours, hours, hours, hours, hours, 0], dirty: true } : r))
    writeLS(draftKey(s.weekStart), rows.filter((r) => r.dirty))
    return { rows }
  }),

  copyLastWeek: async () => {
    const ws = get().weekStart
    let last = readLS<TsRow[]>(`ts.last.${addDays(ws, -7)}`, [])
    if (last.length === 0 && isTauri && get().phase === 'ready') {
      try {
        await goto(`${get().baseUrl}/timsheetentrybydate/${addDays(ws, -7)}`)
        const week = await runOp<{ rows: SiteRow[] }>(readWeekBody)
        last = week.rows.map((r) => ({ project: r.project, hours: r.hours, note: '', status: 'draft' as RowStatus, locked: false, dirty: true }))
        await goto(`${get().baseUrl}/timsheetentrybydate/${ws}`)
      } catch { /* fall through */ }
    }
    if (last.length === 0) { useUiStore.getState().toast({ kind: 'info', title: 'Nothing to copy', detail: 'Last week has no entries.' }); return }
    set((s) => {
      const rows = s.rows.slice()
      for (const l of last) {
        const idx = rows.findIndex((r) => r.project === l.project)
        if (idx === -1) rows.push({ ...l, status: 'draft', locked: false, dirty: true })
        else if (!rows[idx].locked) rows[idx] = { ...rows[idx], hours: l.hours, dirty: true }
      }
      writeLS(draftKey(s.weekStart), rows.filter((r) => r.dirty))
      return { rows }
    })
  },

  save: async () => {
    const { rows, weekStart, baseUrl } = get()
    const todo = rows.filter((r) => r.dirty && !r.locked && r.hours.some((h) => h > 0))
    if (todo.length === 0) { useUiStore.getState().toast({ kind: 'info', title: 'Nothing to save' }); return true }
    set({ phase: 'working', progress: { done: 0, total: todo.length, label: 'Opening the week…' }, message: null, log: [] })
    // Slow stages go into the run notes, so a slow save can be traced to one of them.
    const timed = async <T,>(label: string, work: Promise<T>) => {
      const t = Date.now()
      const out = await work
      if (Date.now() - t > 8000) set((s) => ({ log: [...s.log, `${label} took ${((Date.now() - t) / 1000).toFixed(1)}s`] }))
      return out
    }
    try {
      await timed('Opening the week', goto(`${baseUrl}/timsheetentrybydate/${weekStart}`))
      let failed = 0
      for (let i = 0; i < todo.length; i++) {
        const r = todo[i]
        set({ progress: { done: i, total: todo.length, label: `Saving ${r.project}…` } })
        try {
          // A save that times out may still have gone through; check the week before entering it again.
          const started = Date.now()
          const secs = () => `${((Date.now() - started) / 1000).toFixed(1)}s`
          const landed = async (failure: Error) => {
            // Silence or a reload right after Save usually means it went through; give a slow site a few more seconds.
            const afterSave = /after Save|reloaded/.test(failure.message)
            for (let attempt = 0; attempt < (afterSave ? 3 : 1); attempt++) {
              if (attempt) await new Promise((res) => setTimeout(res, 3000))
              await pageSettled(15000)
              const week = await runOp<{ rows: SiteRow[] }>(readWeekBody, 30000).catch(() => null)
              const row = week && findSiteRow(week.rows, r.project)
              if (row && row.hours.every((h, d) => Math.abs(h - (r.hours[d] ?? 0)) < 0.01)) {
                set((s) => ({ log: [...s.log, `${r.project}: saved after ${secs()}, found on the site after: ${failure.message}`] }))
                return { saved: true, row }
              }
            }
            return null
          }
          const res = await runEditOp<{ saved?: boolean; skipped?: boolean; reason?: string; steps?: string[]; row?: SiteRow | null }>(saveRowBody(r.project, r.hours, r.note), 60000, landed, { afterSaveMs: 12000 })
          if (res.steps && Date.now() - started > 8000) set((s) => ({ log: [...s.log, `${r.project}: slow save, ${secs()} (${res.steps!.join(', ')})`] }))
          if (res.skipped) {
            set((s) => ({ log: [...s.log, `${r.project}: ${res.reason}`] }))
          } else {
            set((s) => ({ rows: s.rows.map((x) => (x.project === r.project ? { ...x, status: 'saved', dirty: false } : x)) }))
          }
        } catch (e) {
          failed += 1
          set((s) => ({ log: [...s.log, `${r.project}: ${(e as Error).message}`] }))
          if (e instanceof LoginRequired) throw e
        }
      }
      const drafts = get().rows.filter((r) => r.dirty)
      writeLS(draftKey(weekStart), drafts)
      set({ progress: null, phase: 'ready' })
      await timed('Reading the week back', get().loadWeek(weekStart))
      if (failed) useUiStore.getState().toast({ kind: 'error', title: `${failed} of ${todo.length} rows could not be saved`, detail: 'Open the timesheet window to see what happened.' })
      else useUiStore.getState().toast({ kind: 'success', title: todo.length === 1 ? 'Saved to timesheet' : `Saved ${todo.length} rows to timesheet` })
      return failed === 0
    } catch (e) {
      set({ progress: null })
      if (e instanceof LoginRequired) { set({ phase: 'login', message: 'Your timesheet session expired. Sign in again in the window.' }); await show(); return false }
      set({ phase: 'error', message: String((e as Error).message ?? e) })
      return false
    }
  },

  saveAndSubmit: async () => {
    const ok = await get().save()
    if (!ok) return
    set({ phase: 'working', progress: { done: 0, total: 1, label: 'Submitting saved rows…' } })
    try {
      await goto(`${get().baseUrl}/pending-timesheet-entries`)
      await runEditOp(submitAllBody, 45000)
      set({ progress: null, phase: 'ready' })
      await get().loadWeek()
      useUiStore.getState().toast({ kind: 'success', title: 'Week submitted', detail: 'All saved rows were sent for approval.' })
    } catch (e) {
      set({ progress: null })
      if (e instanceof LoginRequired) { set({ phase: 'login', message: 'Your timesheet session expired. Sign in again in the window.' }); await show(); return }
      set({ phase: 'error', message: String((e as Error).message ?? e) })
      useUiStore.getState().toast({ kind: 'error', title: 'Submit did not complete', detail: 'Open the timesheet window to finish it there.' })
    }
  },
}))
