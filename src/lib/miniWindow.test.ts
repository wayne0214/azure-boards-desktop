import { beforeEach, describe, expect, it, vi } from 'vitest'

const win = {
  fullscreen: false,
  maximized: false,
  calls: [] as string[],
  isFullscreen: vi.fn(async () => win.fullscreen),
  isMaximized: vi.fn(async () => win.maximized),
  setFullscreen: vi.fn(async (v: boolean) => { win.fullscreen = v; win.calls.push(`fullscreen:${v}`) }),
  unmaximize: vi.fn(async () => { win.maximized = false; win.calls.push('unmaximize') }),
  maximize: vi.fn(async () => { win.maximized = true; win.calls.push('maximize') }),
  scaleFactor: vi.fn(async () => 1),
  innerSize: vi.fn(async () => ({ toLogical: () => ({ width: 1200, height: 800 }) })),
  outerPosition: vi.fn(async () => ({ toLogical: () => ({ x: 10, y: 20 }) })),
  setSize: vi.fn(async () => { win.calls.push('size') }),
  setPosition: vi.fn(async () => {}),
  setMinSize: vi.fn(async () => {}),
  setAlwaysOnTop: vi.fn(async () => {}),
}

vi.mock('./api', () => ({ isTauri: true }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => win,
  LogicalSize: class { constructor(public width: number, public height: number) {} },
  LogicalPosition: class { constructor(public x: number, public y: number) {} },
}))

const { setMiniWindow } = await import('./miniWindow')

describe('setMiniWindow', () => {
  beforeEach(() => { localStorage.clear(); win.fullscreen = false; win.maximized = false; win.calls = [] })

  it('goes back to full screen after mini mode', async () => {
    win.fullscreen = true
    await setMiniWindow(true)
    expect(win.fullscreen).toBe(false)
    win.calls = []
    await setMiniWindow(false)
    expect(win.calls.at(-1)).toBe('fullscreen:true')
  })

  it('goes back to maximized after mini mode', async () => {
    win.maximized = true
    await setMiniWindow(true)
    expect(win.maximized).toBe(false)
    await setMiniWindow(false)
    expect(win.maximized).toBe(true)
  })

  it('leaves a normal window normal', async () => {
    await setMiniWindow(true)
    win.calls = []
    await setMiniWindow(false)
    expect(win.calls).toEqual(['size'])
  })
})
