import { listen } from '@tauri-apps/api/event'
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '../api'
import { autoLoginBody, opScript, probeBody } from './agent'

export interface AgentReport<T = unknown> {
  id: string
  ok: boolean
  data: T | null
  error: string | null
  url: string
}

export const trace = (m: string) => { if (isTauri) void invoke('debug_log', { message: m }).catch(() => undefined) }

let seq = 1
const waiters = new Map<string, (r: AgentReport) => void>()
/** Steps a running op reports before it ends, keyed by op id. */
const progressWaiters = new Map<string, (step: string) => void>()
/** Called when the timesheet page starts loading again, which ends any script running in it. */
const reloadWaiters = new Set<() => void>()
let listening = false
let lastPage: { phase: string; url: string; at: number } = { phase: '', url: '', at: 0 }
const pageWaiters = new Set<() => void>()

async function ensureListeners() {
  if (listening || !isTauri) return
  listening = true
  await listen<AgentReport>('timesheet-report', (e) => {
    const r = e.payload
    trace(`report ${r.id} ok=${r.ok} err=${r.error ?? ''} url=${r.url}`)
    if (r.id.endsWith(':progress')) {
      progressWaiters.get(r.id.slice(0, -':progress'.length))?.(String(r.data))
      return
    }
    const w = waiters.get(r.id)
    if (w) {
      waiters.delete(r.id)
      w(r)
    }
  })
  await listen<{ phase: string; url: string }>('timesheet-page', (e) => {
    lastPage = { ...e.payload, at: Date.now() }
    trace(`page ${e.payload.phase} ${e.payload.url}`)
    if (e.payload.phase === 'started') for (const w of reloadWaiters) w()
    if (e.payload.phase === 'finished') {
      for (const w of pageWaiters) w()
      pageWaiters.clear()
    }
  })
}

export class LoginRequired extends Error {
  constructor() {
    super('Sign-in needed')
  }
}

export interface OpOptions {
  /** After the script reports "saved", wait this long for its end before giving up on it. */
  afterSaveMs?: number
}

/** Run one script in the timesheet window and wait for its report. */
export async function runOp<T>(body: string, timeoutMs = 30000, opts?: OpOptions): Promise<T> {
  await ensureListeners()
  const id = `op${seq++}`
  let afterSave: ReturnType<typeof setTimeout> | undefined
  let onReload: (() => void) | undefined
  const cleanup = () => { waiters.delete(id); progressWaiters.delete(id); if (onReload) reloadWaiters.delete(onReload); clearTimeout(afterSave) }
  const p = new Promise<AgentReport<T>>((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup()
      reject(new Error('The timesheet page did not respond. Open the window to check it.'))
    }, timeoutMs)
    const fail = (message: string) => { clearTimeout(t); cleanup(); reject(new Error(message)) }
    waiters.set(id, (r) => {
      clearTimeout(t)
      cleanup()
      resolve(r as AgentReport<T>)
    })
    // The site may reload or redraw the page after Save, ending the script before it can report;
    // then the caller checks the week itself instead of waiting out the whole timeout.
    if (opts?.afterSaveMs) {
      progressWaiters.set(id, (step) => {
        if (step === 'saved' && !afterSave) afterSave = setTimeout(() => fail('No answer after Save'), opts.afterSaveMs)
      })
      onReload = () => fail('The timesheet page reloaded during the step')
      reloadWaiters.add(onReload)
    }
  })
  trace(`eval ${id}`)
  await invoke('timesheet_eval', { script: opScript(id, body) })
  const r = await p
  if (!r.ok) {
    if (r.error === 'login') throw new LoginRequired()
    throw new Error(r.error ?? 'Unknown error')
  }
  return r.data as T
}

export interface Probe {
  login: boolean
  ready: boolean
  hasGrid: boolean
  title: string
  path: string
  href?: string
  ipc?: boolean
}

/** True when the probe comes from the timesheet site itself, not from a Microsoft sign-in page it redirected to. */
export const onSite = (p: Probe | null, baseUrl: string): p is Probe => !!p?.href && p.href.toLowerCase().startsWith(baseUrl.toLowerCase())

/** Signed in and showing a usable timesheet page. */
export const signedIn = (p: Probe | null, baseUrl: string) => onSite(p, baseUrl) && !p.login && p.ready && p.hasGrid

function waitForPageLoad(ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const t = setTimeout(() => { pageWaiters.delete(done); resolve(false) }, ms)
    const done = () => { clearTimeout(t); resolve(true) }
    pageWaiters.add(done)
  })
}

async function probeUntil(ms: number): Promise<Probe | null> {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try {
      const p = await runOp<Probe>(probeBody, 3000)
      if (p.login) return p
      if (p.ready && p.hasGrid) return p
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return null
}

/**
 * Navigate the hidden window and wait until the page is a usable timesheet page or the login page.
 * If the window stops responding, it is recreated once (the signed-in cookies survive).
 */
export async function goto(url: string, opts?: { show?: boolean; timeoutMs?: number }): Promise<Probe> {
  await ensureListeners()
  const budget = opts?.timeoutMs ?? 45000
  const attempt = async (recreate: boolean): Promise<Probe | null> => {
    if (recreate) {
      await invoke('timesheet_close').catch(() => undefined)
      await new Promise((r) => setTimeout(r, 300))
    }
    const loaded = waitForPageLoad(Math.min(25000, budget / 2))
    trace(`open ${url} recreate=${recreate}`)
    await invoke('timesheet_open', { url, show: opts?.show ?? false })
    trace(`opened; waiting for page load`)
    const ok = await loaded
    trace(`page load ${ok ? 'seen' : 'not seen in time'}`)
    return probeUntil(Math.min(15000, budget / 3))
  }
  const first = await attempt(false)
  if (first) return first
  const second = await attempt(true)
  if (second) return second
  throw new Error('The timesheet site is not responding. Use “Show window” to see what it shows, or check your connection.')
}

/** Resolve once the page has finished loading (at once if it already has), or after `ms`. */
export const pageSettled = async (ms: number) => { if (lastPage.phase !== 'finished') await waitForPageLoad(ms) }

export const show = () => invoke('timesheet_show')
export const hide = () => invoke('timesheet_hide')
export const reload = () => invoke('timesheet_reload')
export const lastPageInfo = () => lastPage

/** Look at the current page without navigating. Returns null if the page does not answer. */
export async function peek(): Promise<Probe | null> {
  try {
    return await runOp<Probe>(probeBody, 3000)
  } catch {
    return null
  }
}

/**
 * Try the silent sign-in: press the site's "Login with …" button and wait for the site to come back with the grid.
 * The round trip goes through Microsoft's pages, where a probe also answers "not the login page",
 * so only a probe from the timesheet site itself counts as success.
 */
export async function tryAutoLogin(baseUrl: string, ms = 25000): Promise<boolean> {
  const press = async () => {
    try {
      const r = await runOp<{ clicked?: boolean }>(autoLoginBody, 3000)
      trace(`auto-login press clicked=${r?.clicked ?? false}`)
      return true
    } catch {
      return false
    }
  }
  if (!(await press())) return false
  const t0 = Date.now()
  let pressedAt = t0
  let presses = 1
  while (Date.now() - t0 < ms) {
    await new Promise((r) => setTimeout(r, 700))
    const p = await peek()
    if (signedIn(p, baseUrl)) return true
    // Still (or again) on the site's own login page: press once more, then a real sign-in is needed.
    if (onSite(p, baseUrl) && p.login && Date.now() - pressedAt > 5000) {
      if (presses >= 2) return false
      presses++
      pressedAt = Date.now()
      await press()
    }
  }
  return false
}

/**
 * Run an operation that edits the grid; if the hidden window cannot do it, show the window briefly and retry.
 * `landed` checks whether the edit reached the site anyway (a slow save, a lost report), so it is not entered twice.
 */
export async function runEditOp<T>(body: string, timeoutMs = 60000, landed?: (failure: Error) => Promise<T | null>, opts?: OpOptions): Promise<T> {
  const check = async (failure: unknown) => (landed ? landed(failure as Error).catch(() => null) : null)
  try {
    return await runOp<T>(body, timeoutMs, opts)
  } catch (e) {
    const msg = (e as Error).message ?? ''
    if (e instanceof LoginRequired) throw e
    const done = await check(e)
    if (done) { trace(`edit op failed (${msg.slice(0, 80)}) but the change is on the site`); return done }
    if (!/No edit row|did not respond|Timed out/i.test(msg)) throw e
    trace(`edit op failed hidden (${msg.slice(0, 80)}); retrying with the window visible`)
    await show()
    try {
      return await runOp<T>(body, timeoutMs, opts)
    } catch (again) {
      const late = await check(again)
      if (late) return late
      throw again
    } finally {
      await hide()
    }
  }
}
