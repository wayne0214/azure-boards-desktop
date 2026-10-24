import { create } from 'zustand'
import { api } from '@/lib/api'
import type { Booking, ChoiceField, Room } from '@/lib/rooms/types'
import { useAppStore } from './useAppStore'
import { useUiStore } from './useUiStore'

/** The calendar key from what was pasted: a Teamup link (https://teamup.com/ks…/…) or the key itself. */
export const calendarKey = (v: string) => v.trim().match(/teamup\.com\/([A-Za-z0-9]+)/i)?.[1] ?? v.trim()
/** The day the timeline shows, in minutes from midnight. */
export const DAY_START = 7 * 60
export const DAY_END = 21 * 60
export const STEP = 30

/**
 * "Type of meeting" as the calendar stores it (seen on existing bookings: custom.type_of_meeting = ["external"]).
 * Reading the real definition needs an admin key, so this is the fallback when that is refused.
 */
const KNOWN_MEETING_TYPE: ChoiceField = { id: 'type_of_meeting', name: 'Type of meeting', choices: [{ id: 'external', name: 'External' }] }

function meetingTypeFrom(defs: unknown): ChoiceField | null {
  const list = Array.isArray(defs) ? (defs as { id?: string; name?: string; type?: string; active?: boolean; choices?: { id?: string; name?: string; active?: boolean }[] }[]) : []
  const f = list.find((d) => d.id === KNOWN_MEETING_TYPE.id || /type of meeting/i.test(d.name ?? ''))
  if (!f?.id || !f.choices?.length) return null
  const choices = f.choices.filter((c) => c.id && c.active !== false).map((c) => ({ id: String(c.id), name: String(c.name ?? c.id) }))
  return choices.length ? { id: f.id, name: f.name ?? KNOWN_MEETING_TYPE.name, choices } : null
}

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`
/** A minute of the day as people read it on a clock: 9:00am, 12:30pm. `hhmm` stays 24-hour for the API. */
export const clock = (min: number) => {
  const h = Math.floor(min / 60) % 24
  return `${h % 12 || 12}:${pad(min % 60)}${h < 12 ? 'am' : 'pm'}`
}

/** A local date and minute as an ISO time with this computer's offset, e.g. 2026-10-21T09:00:00+08:00. */
function localDateTime(date: string, min: number): string {
  const d = new Date(`${date}T${hhmm(min)}:00`)
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  return `${date}T${hhmm(min)}:00${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
}

/** Minutes from the start of `date` (local), clamped to the day. All-day bookings fill the day. */
export function span(b: Booking, date: string): [number, number] {
  if (b.all_day) return [0, 24 * 60]
  const dayStart = new Date(`${date}T00:00:00`).getTime()
  const toMin = (s: string) => Math.round((new Date(s).getTime() - dayStart) / 60000)
  return [Math.max(0, toMin(b.start_dt)), Math.min(24 * 60, toMin(b.end_dt))]
}

const read = (key: string, fallback: string) => { try { return localStorage.getItem(key) ?? fallback } catch { return fallback } }
const write = (key: string, value: string) => { try { localStorage.setItem(key, value) } catch { /* ignore */ } }

/** The next half hour from now, kept inside the day. */
function nextSlot(): number {
  const now = new Date()
  const m = Math.ceil((now.getHours() * 60 + now.getMinutes()) / STEP) * STEP
  return Math.min(Math.max(m, 9 * 60), DAY_END - 60)
}

/** How far ahead "My bookings" looks. */
export const MINE_DAYS = 60

interface RoomState {
  /** Upcoming bookings under my name (null until loaded). */
  mine: Booking[] | null
  mineLoading: boolean
  loadMine(): Promise<void>
  calendar: string
  whoOverride: string
  hasKey: boolean | null
  date: string
  from: number
  to: number
  title: string
  rooms: Room[]
  bookings: Booking[]
  loading: boolean
  error: string | null
  booking: number | null
  meetingTypeField: ChoiceField
  /** Chosen option id; empty means not set (most bookings leave it empty). */
  meetingType: string

  who(): string
  setMeetingType(t: string): void
  setCalendar(c: string): void
  setWhoOverride(w: string): void
  setDate(d: string): void
  shiftDate(days: number): void
  setRange(from: number, to: number): void
  setTitle(t: string): void
  load(opts?: { silent?: boolean }): Promise<void>
  book(room: Room): Promise<void>
  cancel(b: Booking): Promise<void>
}

export const useRoomStore = create<RoomState>((set, get) => ({
  mine: null,
  mineLoading: false,
  loadMine: async () => {
    const who = get().who().trim().toLowerCase()
    if (!who || !get().calendar) { set({ mine: [] }); return }
    set({ mineLoading: true })
    try {
      const today = new Date()
      const until = new Date(today)
      until.setDate(until.getDate() + MINE_DAYS)
      const { events } = await api().roomsEvents(get().calendar, isoDate(today), isoDate(until))
      const now = Date.now()
      // Bookings made here carry my name in "Who"; ones still going on count as upcoming.
      const mine = events
        .filter((e) => (e.who ?? '').trim().toLowerCase() === who && new Date(e.end_dt).getTime() > now)
        .sort((a, b) => new Date(a.start_dt).getTime() - new Date(b.start_dt).getTime())
      set({ mine, mineLoading: false })
    } catch {
      set({ mineLoading: false })
    }
  },

  calendar: read('rooms.calendar', ''),
  whoOverride: read('rooms.who', ''),
  hasKey: null,
  date: isoDate(new Date()),
  from: nextSlot(),
  to: nextSlot() + 60,
  title: '',
  rooms: [],
  bookings: [],
  loading: false,
  error: null,
  booking: null,
  meetingTypeField: KNOWN_MEETING_TYPE,
  meetingType: '',

  setMeetingType: (meetingType) => set({ meetingType }),
  who: () => get().whoOverride.trim() || useAppStore.getState().account()?.userName || '',
  setCalendar: (c) => {
    const calendar = calendarKey(c)
    if (calendar === get().calendar) return
    write('rooms.calendar', calendar)
    // Rooms are cached per calendar.
    set({ calendar, rooms: [], bookings: [], mine: null })
  },
  setWhoOverride: (w) => { write('rooms.who', w); set({ whoOverride: w }) },
  setDate: (date) => { set({ date }); void get().load() },
  shiftDate: (days) => {
    const d = new Date(`${get().date}T00:00:00`)
    d.setDate(d.getDate() + days)
    get().setDate(isoDate(d))
  },
  setRange: (from, to) => {
    const f = Math.max(DAY_START, Math.min(from, DAY_END - STEP))
    set({ from: f, to: Math.max(f + STEP, Math.min(to, DAY_END)) })
  },
  setTitle: (title) => set({ title }),

  load: async (opts) => {
    const { calendar, date } = get()
    if (!calendar) return
    if (!opts?.silent) set({ loading: true, error: null })
    try {
      const hasKey = await api().roomsHasKey()
      set({ hasKey })
      if (!hasKey) { set({ loading: false }); return }
      const [r, e] = await Promise.all([
        get().rooms.length ? Promise.resolve({ subcalendars: get().rooms }) : api().roomsList(calendar),
        api().roomsEvents(calendar, date, date),
      ])
      if (get().date !== date) return
      // The real field list, when the key is allowed to read it; otherwise keep the known field.
      if (get().meetingTypeField === KNOWN_MEETING_TYPE) {
        void api().roomsFields(calendar).then((d) => { const f = meetingTypeFrom(d?.definitions); if (f) set({ meetingTypeField: f }) }).catch(() => undefined)
      }
      const rooms = r.subcalendars.filter((x) => x.active !== false).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      set({ rooms, bookings: e.events, loading: false, error: null })
    } catch (err) {
      set({ loading: false, error: (err as { message?: string })?.message ?? String(err) })
    }
  },

  book: async (room) => {
    const { calendar, date, from, to } = get()
    const who = get().who()
    const title = get().title.trim() || `Meeting – ${who || 'booked from Boards'}`
    set({ booking: room.id })
    try {
      const { event } = await api().roomsBook(calendar, {
        subcalendar_ids: [room.id],
        title,
        who,
        start_dt: localDateTime(date, from),
        end_dt: localDateTime(date, to),
        all_day: false,
        ...(get().meetingType ? { custom: { [get().meetingTypeField.id]: [get().meetingType] } } : {}),
      })
      void get().loadMine()
      // The type goes back to "Not set" so the next booking is not marked External by accident.
      set((s) => ({ booking: null, bookings: [...s.bookings, event], meetingType: '' }))
      useUiStore.getState().toast({
        kind: 'success',
        title: `${room.name} booked`,
        detail: `${clock(from)}–${clock(to)} · ${title}`,
        action: { label: 'Undo', onClick: () => void get().cancel(event) },
      })
    } catch (err) {
      set({ booking: null })
      useUiStore.getState().toast({ kind: 'error', title: `Could not book ${room.name}`, detail: (err as { message?: string })?.message ?? String(err) })
    }
    void get().load({ silent: true })
  },

  cancel: async (b) => {
    try {
      await api().roomsCancel(get().calendar, b.id, b.version)
      set((s) => ({ bookings: s.bookings.filter((x) => x.id !== b.id), mine: s.mine?.filter((x) => x.id !== b.id) ?? null }))
      useUiStore.getState().toast({ kind: 'info', title: 'Booking cancelled' })
    } catch (err) {
      useUiStore.getState().toast({ kind: 'error', title: 'Could not cancel the booking', detail: (err as { message?: string })?.message ?? String(err) })
    }
  },
}))
