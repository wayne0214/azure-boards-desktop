import { isTauri } from './api'

interface Frame { w: number; h: number; x: number; y: number }

const read = (k: string): Frame | null => { try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as Frame) : null } catch { return null } }
const write = (k: string, f: Frame) => { try { localStorage.setItem(k, JSON.stringify(f)) } catch { /* ignore */ } }

const FULL_MIN = { w: 980, h: 620 }
const MINI_MIN = { w: 300, h: 320 }
const MINI_DEFAULT = { w: 340, h: 560 }

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
    await step('fullscreen', async () => { if (await w.isFullscreen()) await w.setFullscreen(false) })
    await step('maximized', async () => { if (await w.isMaximized()) await w.unmaximize() })
    await step('read frame', async () => write('mini.full', await frame()))
    await step('min size', () => w.setMinSize(new LogicalSize(MINI_MIN.w, MINI_MIN.h)))
    await place(read('mini.frame'), MINI_DEFAULT)
    await step('on top', () => w.setAlwaysOnTop(true))
  } else {
    await step('read frame', async () => write('mini.frame', await frame()))
    await step('on top', () => w.setAlwaysOnTop(false))
    // The full minimum first: it grows the window even if restoring the old size fails.
    await step('min size', () => w.setMinSize(new LogicalSize(FULL_MIN.w, FULL_MIN.h)))
    await place(read('mini.full'), { w: 1380, h: 880 })
  }
  if (failed.length) throw new Error(`The window could not fully switch (${failed.join('; ')})`)
}
