// Demo meeting rooms for the browser preview.
import type { Api } from './api'
import type { Booking, Room } from './rooms/types'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))

const roomNames = [
  'Level 3 > Meeting Room A (6 pax)', 'Level 3 > Meeting Room B (6 pax)', 'Level 3 > Discussion Room 1', 'Level 3 > Discussion Room 2',
  'Level 5 > Board Room (20 pax, TV + VC)', 'Level 5 > Meeting Room C', 'Level 5 > Meeting Room D', 'Level 5 > Phone Booth',
  'Level 7 > Training Room (30 pax)', 'Level 7 > Huddle Space', 'Pantry Corner',
]
const rooms: Room[] = roomNames.map((name, i) => ({ id: 1000 + i, name, active: true }))

const pad = (n: number) => String(n).padStart(2, '0')
const localIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`

let seq = 1
const bookings: Booking[] = (() => {
  const out: Booking[] = []
  const today = new Date()
  const at = (h: number, m = 0) => { const d = new Date(today); d.setHours(h, m, 0, 0); return localIso(d) }
  const add = (room: number, sh: number, sm: number, eh: number, em: number, title: string, who: string) =>
    out.push({ id: String(seq++), version: '1', subcalendar_ids: [1000 + room], title, who, start_dt: at(sh, sm), end_dt: at(eh, em), all_day: false })
  add(0, 9, 0, 10, 30, 'Sprint planning', 'Priya Natarajan')
  add(0, 14, 0, 15, 0, 'Design review', 'Hana Kobayashi')
  add(1, 10, 0, 12, 0, 'Client call', 'Marcus Oyelaran')
  add(3, 13, 30, 17, 0, 'Workshop', 'Tomás Ferreira')
  add(9, 9, 0, 18, 0, 'Board meeting', 'Admin')
  add(5, 11, 0, 11, 30, '1:1', 'Priya Natarajan')
  add(2, 17, 0, 18, 0, 'Sprint review prep', 'Wayne Lai')
  const tomorrow = (h: number, m = 0) => { const d = new Date(today); d.setDate(d.getDate() + 1); d.setHours(h, m, 0, 0); return localIso(d) }
  out.push({ id: String(seq++), version: '1', subcalendar_ids: [1004], title: 'Client demo', who: 'Wayne Lai', start_dt: tomorrow(10), end_dt: tomorrow(11, 30), all_day: false, custom: { type_of_meeting: ['external'] } })
  return out
})()

export const mockRooms: Pick<Api, 'roomsHasKey' | 'roomsList' | 'roomsFields' | 'roomsEvents' | 'roomsBook' | 'roomsCancel'> = {
  roomsHasKey: async () => true,
  // Like the real calendar key, the demo has no admin rights, so the app falls back to the known field.
  roomsFields: async () => { await delay(); throw { kind: 'forbidden', message: 'No permission' } },
  roomsList: async () => { await delay(); return { subcalendars: structuredClone(rooms) } },
  roomsEvents: async (_c, start, end) => {
    await delay()
    return { events: structuredClone(bookings.filter((b) => b.start_dt.slice(0, 10) <= end && b.end_dt.slice(0, 10) >= start)) }
  },
  roomsBook: async (_c, ev) => {
    await delay(400)
    const b: Booking = { ...ev, id: String(seq++), version: '1' }
    bookings.push(b)
    return { event: structuredClone(b) }
  },
  roomsCancel: async (_c, id) => {
    await delay()
    const i = bookings.findIndex((b) => b.id === id)
    if (i >= 0) bookings.splice(i, 1)
  },
}
