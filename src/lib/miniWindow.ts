import { isTauri } from './api'

/** A window's place; the full window also notes whether it was full screen or maximized. */
interface Frame { w: number; h: number; x: number; y: number; fullscreen?: boolean; maximized?: boolean }

const read = (k: string): Frame | null => { try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as Frame) : null } catch { return null } }
const write = (k: string, f: Frame) => { try { localStorage.setItem(k, JSON.stringify(f)) } catch { /* ignore */ } }

const FULL_MIN = { w: 980, h: 620 }
const MINI_MIN = { w: 300, h: 320 }
const MINI_DEFAULT = { w: 340, h: 560 }
/** The least room the bug form needs when it opens over mini mode. */
const POPUP_MIN = { w: 440, h: 640 }

/**
 * Shrink the window to a small panel that stays on top, or bring it back to where it was.
 * Each mode remembers its own size and place.
 */
export async function setMiniWindow(on: boolean): Promise<void> {
  if (!isTauri) return
  const { getCurrentWindow, LogicalSize, LogicalPosition } = await import('@tauri-apps/api/window')
  const w = getCurrentWindow()
  const frame = async (): Promise<Frame> => {
    const scale = await w.scaleFactor()
    const size = (await w.innerSize()).toLogical(scale)
    const pos = (await w.outerPosition()).toLogical(scale)
    return { w: size.width, h: size.height, x: pos.x, y: pos.y }
  }
  // One failed step must not leave the window half switched, so each runs on its own and failures are reported.
  const failed: string[] = []
  const step = async (what: string, run: () => Promise<unknown>) => { try { await run() } catch (e) { failed.push(`${what}: ${(e as Error)?.message ?? e}`) } }
  const place = async (f: Frame | null, fallback: { w: number; h: number }) => {
    await step('size', () => w.setSize(new LogicalSize(f?.w ?? fallback.w, f?.h ?? fallback.h)))
    if (f) await step('position', () => w.setPosition(new LogicalPosition(f.x, f.y)))
  }
  if (on) {
    // Noted before leaving them, so going back restores the same window.
    let fullscreen = false
    let maximized = false
    await step('fullscreen', async () => {
      fullscreen = await w.isFullscreen()
      if (!fullscreen) return
      await w.setFullscreen(false)
      // Leaving full screen is animated on macOS, and a resize during it is lost.
      for (let i = 0; i < 20 && (await w.isFullscreen()); i++) await new Promise((r) => setTimeout(r, 100))
      await new Promise((r) => setTimeout(r, 300))
    })
    await step('maximized', async () => { maximized = await w.isMaximized(); if (maximized) await w.unmaximize() })
    await step('read frame', async () => write('mini.full', { ...(await frame()), fullscreen, maximized }))
    await step('min size', () => w.setMinSize(new LogicalSize(MINI_MIN.w, MINI_MIN.h)))
    await place(read('mini.frame'), MINI_DEFAULT)
    await step('on top', () => w.setAlwaysOnTop(true))
  } else {
    // If a popup grew the window, mini mode keeps the size it had before.
    await step('read frame', async () => {
      const before = read('mini.beforePopup')
      try { localStorage.removeItem('mini.beforePopup') } catch { /* ignore */ }
      write('mini.frame', before ?? (await frame()))
    })
    await step('on top', () => w.setAlwaysOnTop(false))
    // The full minimum first: it grows the window even if restoring the old size fails.
    await step('min size', () => w.setMinSize(new LogicalSize(FULL_MIN.w, FULL_MIN.h)))
    const full = read('mini.full')
    await place(full, { w: 1380, h: 880 })
    if (full?.fullscreen) await step('fullscreen', () => w.setFullscreen(true))
    else if (full?.maximized) await step('maximized', () => w.maximize())
  }
  if (failed.length) throw new Error(`The window could not fully switch (${failed.join('; ')})`)
}

/**
 * Make room for a form opened over mini mode, and give the room back when it closes.
 * The window stays on top and only grows if it is smaller than the form needs.
 */
export async function fitMiniPopup(open: boolean): Promise<void> {
  if (!isTauri) return
  const { getCurrentWindow, LogicalSize } = await import('@tauri-apps/api/window')
  const w = getCurrentWindow()
  const KEY = 'mini.beforePopup'
  if (open) {
    const scale = await w.scaleFactor()
    const size = (await w.innerSize()).toLogical(scale)
    if (size.width >= POPUP_MIN.w && size.height >= POPUP_MIN.h) return
    const pos = (await w.outerPosition()).toLogical(scale)
    write(KEY, { w: size.width, h: size.height, x: pos.x, y: pos.y })
    await w.setSize(new LogicalSize(Math.max(size.width, POPUP_MIN.w), Math.max(size.height, POPUP_MIN.h)))
  } else {
    const before = read(KEY)
    if (!before) return
    try { localStorage.removeItem(KEY) } catch { /* ignore */ }
    await w.setSize(new LogicalSize(before.w, before.h))
  }
}
