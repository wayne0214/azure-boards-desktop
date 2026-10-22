import { create } from 'zustand'
import type { NoteKind } from '@/lib/notify/watch'

export type NotifyPrefs = Record<NoteKind, boolean>

const KEY = 'notify.prefs'
const DEFAULTS: NotifyPrefs = { review: true, assigned: true, mention: true, check: true }

function read(): NotifyPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NotifyPrefs>) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

interface NotifyState {
  prefs: NotifyPrefs
  setPref(kind: NoteKind, on: boolean): void
}

export const useNotifyStore = create<NotifyState>((set, get) => ({
  prefs: read(),
  setPref: (kind, on) => {
    const prefs = { ...get().prefs, [kind]: on }
    try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* ignore */ }
    set({ prefs })
  },
}))
