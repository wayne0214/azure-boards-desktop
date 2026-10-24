import { create } from 'zustand'
import { setMiniWindow } from '@/lib/miniWindow'

export type View = 'board' | 'list' | 'mine' | 'timesheet' | 'prs' | 'rooms' | 'reqs' | 'tests' | 'plans' | 'team' | 'imports'
export type SheetKind = 'new-item' | 'import' | 'settings' | 'shortcuts' | 'connect' | 'new-pr' | 'complete-pr' | 'start-work' | 'whats-new' | null
export type Theme = 'system' | 'light' | 'dark'

export interface Toast {
  id: number
  kind: 'info' | 'success' | 'error'
  title: string
  detail?: string
  action?: { label: string; onClick: () => void }
  /** Stays until dismissed. */
  sticky?: boolean
}

interface UiState {
  view: View
  sidebarOpen: boolean
  inspectorOpen: boolean
  /** Width the user dragged the details panel to; null follows the window size. */
  inspectorWidth: number | null
  textScale: number
  theme: Theme
  sheet: SheetKind
  sheetPayload: Record<string, unknown> | null
  paletteOpen: boolean
  toasts: Toast[]
  density: 'comfortable' | 'compact'
  doneDays: number
  /** Changes sent to Azure DevOps that have not answered yet. */
  pending: number
  /** The window is a small always-on-top panel showing only what needs me. */
  mini: boolean

  setView(v: View): void
  toggleSidebar(): void
  toggleInspector(open?: boolean): void
  setInspectorWidth(w: number | null): void
  setTextScale(s: number): void
  setTheme(t: Theme): void
  setDensity(d: 'comfortable' | 'compact'): void
  setDoneDays(d: number): void
  setMini(on: boolean): void
  openSheet(kind: SheetKind, payload?: Record<string, unknown>): void
  closeSheet(): void
  setPaletteOpen(open: boolean): void
  toast(t: Omit<Toast, 'id'>): void
  dismissToast(id: number): void
  trackPending<T>(p: Promise<T>): Promise<T>
}

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

let toastSeq = 1

/** Test Cases or Test Plans, whichever was open last: the sidebar's Testing item goes back to it. */
export const lastTestingView = (): 'tests' | 'plans' => read<'tests' | 'plans'>('ui.testing', 'tests')

export const useUiStore = create<UiState>((set, get) => ({
  view: read<View>('ui.view', 'board'),
  sidebarOpen: read('ui.sidebar', true),
  inspectorOpen: false,
  inspectorWidth: read<number | null>('ui.inspectorWidth', null),
  textScale: read('ui.textScale', 1),
  theme: read<Theme>('ui.theme', 'system'),
  sheet: null,
  sheetPayload: null,
  paletteOpen: false,
  toasts: [],
  density: read('ui.density', 'comfortable'),
  doneDays: read('ui.doneDays', 30),
  pending: 0,
  mini: false,

  setView: (view) => {
    write('ui.view', view)
    if (view === 'tests' || view === 'plans') write('ui.testing', view)
    // Moving to another section closes the details panel; it reopens when an item is picked there.
    set((s) => ({ view, inspectorOpen: view === s.view ? s.inspectorOpen : false }))
  },
  toggleSidebar: () => {
    const next = !get().sidebarOpen
    write('ui.sidebar', next)
    set({ sidebarOpen: next })
  },
  toggleInspector: (open) => set((s) => ({ inspectorOpen: open ?? !s.inspectorOpen })),
  setInspectorWidth: (w) => {
    const width = w === null ? null : Math.round(w)
    write('ui.inspectorWidth', width)
    set({ inspectorWidth: width })
  },
  setTextScale: (textScale) => {
    const clamped = Math.min(1.5, Math.max(0.85, Math.round(textScale * 100) / 100))
    write('ui.textScale', clamped)
    set({ textScale: clamped })
  },
  setTheme: (theme) => {
    write('ui.theme', theme)
    set({ theme })
  },
  setDensity: (density) => {
    write('ui.density', density)
    set({ density })
  },
  setDoneDays: (doneDays) => {
    write('ui.doneDays', doneDays)
    set({ doneDays })
  },
  setMini: (mini) => {
    if (mini === get().mini) return
    set({ mini, paletteOpen: false })
    setMiniWindow(mini).catch((e) => get().toast({ kind: 'error', title: mini ? 'Could not switch to mini mode' : 'Could not restore the window', detail: String((e as Error)?.message ?? e) }))
  },
  // Forms need the full window, so opening one leaves mini mode.
  openSheet: (sheet, payload) => {
    if (sheet && get().mini) get().setMini(false)
    set({ sheet, sheetPayload: payload ?? null })
  },
  closeSheet: () => set({ sheet: null, sheetPayload: null }),
  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  toast: (t) => {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }))
    if (t.sticky) return
    // Errors and toasts with a button stay longer, so there is time to read and act.
    const ttl = t.kind === 'error' || t.action ? 8000 : 4000
    setTimeout(() => get().dismissToast(id), ttl)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  trackPending: (p) => {
    set((s) => ({ pending: s.pending + 1 }))
    return p.finally(() => set((s) => ({ pending: s.pending - 1 })))
  },
}))
