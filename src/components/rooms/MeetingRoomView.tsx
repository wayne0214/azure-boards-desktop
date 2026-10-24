import { ArrowRight, CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, Clock3, DoorOpen, KeyRound, RefreshCw, User, X } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useState } from 'react'
import { Empty } from '@/components/ui/Empty'
import { Sheet } from '@/components/ui/Sheet'
import { confirmAsync } from '@/lib/confirm'
import type { Booking, Room } from '@/lib/rooms/types'
import { DAY_END, DAY_START, MINE_DAYS, STEP, clock, isoDate, span, useRoomStore } from '@/store/useRoomStore'
import { useUiStore } from '@/store/useUiStore'

const TOTAL = DAY_END - DAY_START
const pct = (min: number) => `${((Math.min(Math.max(min, DAY_START), DAY_END) - DAY_START) / TOTAL) * 100}%`
const SLOTS = Array.from({ length: TOTAL / STEP + 1 }, (_, i) => DAY_START + i * STEP)
const HOURS = SLOTS.filter((m) => m % 60 === 0)
const DURATIONS = [30, 60, 90, 120]

function dayLabel(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

const durLabel = (min: number) => (min < 60 ? `${min} min` : `${min / 60} h`)

/** Teamup names nested calendars "Floor > Room"; show the last part as the room and the rest above it. */
function splitName(name: string): { group: string; room: string } {
  const parts = name.split('>').map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return { group: '', room: name.trim() }
  return { group: parts.slice(0, -1).join(' › '), room: parts[parts.length - 1] }
}

function RoomName({ name }: { name: string }) {
  const { group, room } = splitName(name)
  return (
    <span className="rooms-nm">
      {group && <span className="grp">{group} ›</span>}
      <span className="room">{room}</span>
    </span>
  )
}

type Slot = { b: Booking; from: number; to: number }

/** The booking's "Type of meeting", as a readable name (e.g. "External"). */
function typeLabel(b: Booking): string {
  const f = useRoomStore.getState().meetingTypeField
  const ids = b.custom?.[f.id] ?? []
  return ids.map((id) => f.choices.find((c) => c.id === id)?.name ?? id).join(', ')
}

/** Every room for one day: pick a time, see which rooms are free, book one with a click. */
export function MeetingRoomView() {
  const s = useRoomStore(useShallow((st) => ({ booking: st.booking, bookings: st.bookings, calendar: st.calendar, cancel: st.cancel, date: st.date, error: st.error, from: st.from, hasKey: st.hasKey, load: st.load, loadMine: st.loadMine, loading: st.loading, mine: st.mine, rooms: st.rooms, setDate: st.setDate, setRange: st.setRange, setTitle: st.setTitle, shiftDate: st.shiftDate, title: st.title, to: st.to, who: st.who })))
  const who = s.who()
  const [freeOnly, setFreeOnly] = useState(false)
  const [confirmRoom, setConfirmRoom] = useState<Room | null>(null)
  const [showMine, setShowMine] = useState(false)
  const openSheet = useUiStore((st) => st.openSheet)

  useEffect(() => { void s.load(); void s.loadMine() }, [s.calendar]) // eslint-disable-line react-hooks/exhaustive-deps

  const byRoom = useMemo(() => {
    const map = new Map<number, Slot[]>()
    for (const b of s.bookings) {
      const [from, to] = span(b, s.date)
      if (to <= from) continue
      for (const id of b.subcalendar_ids) map.set(id, [...(map.get(id) ?? []), { b, from, to }])
    }
    return map
  }, [s.bookings, s.date])

  const clashes = (room: Room) => (byRoom.get(room.id) ?? []).filter((x) => x.from < s.to && x.to > s.from)
  const freeCount = s.rooms.filter((r) => clashes(r).length === 0).length
  const shown = freeOnly ? s.rooms.filter((r) => clashes(r).length === 0) : s.rooms
  const today = isoDate(new Date())
  const nowMin = s.date === today ? new Date().getHours() * 60 + new Date().getMinutes() : null
  const inPast = s.date < today || (nowMin !== null && s.to <= nowMin)
  const duration = s.to - s.from

  const pickSlot = (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const min = DAY_START + Math.floor((((e.clientX - r.left) / r.width) * TOTAL) / STEP) * STEP
    s.setRange(min, min + duration)
  }

  const cancel = async (b: Booking) => {
    if (await confirmAsync(`Cancel “${b.title}”?`, { okLabel: 'Cancel booking', cancelLabel: 'Keep', danger: true })) void s.cancel(b)
  }

  return (
    <div className="ts rooms">
      <div className="ts-head">
        <div className="ts-week">
          <button type="button" className="icon-btn" onClick={() => s.shiftDate(-1)} title="Previous day"><ChevronLeft size={18} /></button>
          <div className="ts-week-title">
            <strong>{dayLabel(s.date)}</strong>
            <span className="faint">{s.date === today ? 'Today' : s.date < today ? 'Past' : 'Upcoming'}</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => s.shiftDate(1)} title="Next day"><ChevronRight size={18} /></button>
          <input type="date" className="input rooms-date" value={s.date} onChange={(e) => e.target.value && s.setDate(e.target.value)} />
          {s.date !== today && <button type="button" className="btn sm" onClick={() => s.setDate(today)}>Today</button>}
        </div>
        <div className="grow" />
        {s.hasKey !== false && s.calendar && (
          <button type="button" className="btn" onClick={() => { setShowMine(true); void s.loadMine() }} title={`Your bookings for the next ${MINE_DAYS} days`}>
            <CalendarCheck size={15} /> My bookings{s.mine && s.mine.length > 0 && <span className="rooms-mine-count">{s.mine.length}</span>}
          </button>
        )}
        <button type="button" className="icon-btn" title="Reload" onClick={() => { void s.load(); void s.loadMine() }} disabled={s.loading}><RefreshCw size={16} className={s.loading ? 'spin' : ''} /></button>
      </div>

      {s.hasKey === false ? (
        <Empty icon={<KeyRound size={28} />} title="Teamup is not set up">
          This build of the app has no Teamup API key.
        </Empty>
      ) : !s.calendar ? (
        <Empty icon={<CalendarDays size={28} />} title="No Teamup calendar yet" action={<button type="button" className="btn primary" onClick={() => openSheet('settings', { tab: 'rooms' })}>Open Settings</button>}>
          Paste the rooms calendar's Teamup link in Settings.
        </Empty>
      ) : (
        <>
          <div className="rooms-controls">
            <div className="rooms-field">
              <span className="lbl">From</span>
              <select className="input" value={s.from} onChange={(e) => { const f = Number(e.target.value); s.setRange(f, f + duration) }}>
                {SLOTS.slice(0, -1).map((m) => <option key={m} value={m}>{clock(m)}</option>)}
              </select>
            </div>
            <ArrowRight size={14} className="faint rooms-arrow" />
            <div className="rooms-field">
              <span className="lbl">To</span>
              <select className="input" value={s.to} onChange={(e) => s.setRange(s.from, Number(e.target.value))}>
                {SLOTS.filter((m) => m > s.from).map((m) => <option key={m} value={m}>{clock(m)}</option>)}
              </select>
            </div>
            <div className="segmented rooms-durs">
              {DURATIONS.map((d) => <button key={d} type="button" className={duration === d ? 'on' : ''} onClick={() => s.setRange(s.from, s.from + d)}>{durLabel(d)}</button>)}
            </div>
            <div className="rooms-field grow">
              <span className="lbl">Meeting</span>
              <input className="input" value={s.title} onChange={(e) => s.setTitle(e.target.value)} placeholder="What is it about? (optional)" />
            </div>
          </div>

          {s.error && (
            <div className="ts-note danger">
              <span className="msg">{s.error}</span>
              <button type="button" className="btn sm primary" onClick={() => void s.load()}>Try again</button>
            </div>
          )}

          {s.loading && s.rooms.length === 0 ? (
            <div className="empty-state"><span className="spinner lg" /><p>Loading rooms…</p></div>
          ) : (
            <div className="ts-body">
              <div className="rooms-summary">
                <span className={`rooms-count ${freeCount ? 'ok' : 'none'}`}>{freeCount} of {s.rooms.length} free</span>
                <span className="faint">{clock(s.from)} – {clock(s.to)} · {durLabel(duration)}</span>
                {inPast && <span className="rooms-past">This time has already passed</span>}
                <span className="grow" />
                <div className="segmented">
                  <button type="button" className={!freeOnly ? 'on' : ''} onClick={() => setFreeOnly(false)}>All rooms</button>
                  <button type="button" className={freeOnly ? 'on' : ''} onClick={() => setFreeOnly(true)}>Free only</button>
                </div>
              </div>

              <div className="rooms-grid">
                <div className="rooms-row head">
                  <div className="rooms-name">Room</div>
                  <div className="rooms-track">
                    {HOURS.filter((m) => m % 120 === 0 && m > DAY_START && m < DAY_END).map((m) => <span key={m} className="rooms-hour" style={{ left: pct(m) }}>{clock(m)}</span>)}
                  </div>
                  <div className="rooms-act" />
                </div>
                {shown.map((room) => {
                  const hits = clashes(room)
                  const free = hits.length === 0
                  const freeFrom = free ? null : Math.max(...hits.map((h) => h.to))
                  return (
                    <div key={room.id} className={`rooms-row ${free ? 'free' : 'busy'}`}>
                      <div className="rooms-name" title={room.name}>
                        <i className={`rooms-dot ${free ? 'free' : 'busy'}`} />
                        <RoomName name={room.name} />
                      </div>
                      <div className="rooms-track" onClick={pickSlot} title="Click to move the selected time here">
                        {HOURS.map((m) => <i key={m} className="rooms-tick" style={{ left: pct(m) }} />)}
                        <i className={`rooms-sel ${free ? 'free' : 'busy'}`} style={{ left: pct(s.from), width: `calc(${pct(s.to)} - ${pct(s.from)})` }} />
                        {(byRoom.get(room.id) ?? []).map(({ b, from, to }) => {
                          const mine = !!who && b.who?.trim().toLowerCase() === who.toLowerCase()
                          return (
                            <div
                              key={b.id}
                              className={`rooms-block ${mine ? 'mine' : ''}`}
                              style={{ left: pct(from), width: `calc(${pct(to)} - ${pct(from)})` }}
                              title={`${b.all_day ? 'All day' : `${clock(from)}–${clock(to)}`} · ${b.title}${b.who ? ` · ${b.who}` : ''}${typeLabel(b) ? ` · ${typeLabel(b)}` : ''}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="t">
                                <b>{b.who || b.title}</b>
                                <span>{b.all_day ? 'All day' : `${clock(from)}–${clock(to)}`}</span>
                              </span>
                              {mine && <button type="button" className="x" title="Cancel my booking" onClick={() => void cancel(b)}><X size={12} /></button>}
                            </div>
                          )
                        })}
                        {nowMin !== null && nowMin > DAY_START && nowMin < DAY_END && <i className="rooms-now" style={{ left: pct(nowMin) }} />}
                      </div>
                      <div className="rooms-act">
                        {free ? (
                          <button type="button" className="btn sm primary" disabled={inPast || s.booking !== null || !who} onClick={() => setConfirmRoom(room)} title={!who ? 'Set your name in Settings first' : `Book ${room.name}`}>
                            {s.booking === room.id ? <span className="spinner" /> : <DoorOpen size={13} />} Book
                          </button>
                        ) : (
                          <span className="rooms-busy-note">{freeFrom !== null && freeFrom < DAY_END ? <>Free from<br /><b>{clock(freeFrom)}</b></> : 'Taken'}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
                {shown.length === 0 && !s.loading && !s.error && (
                  <Empty title={s.rooms.length ? 'No room is free at this time' : 'No rooms found'}>
                    {s.rooms.length ? 'Try another time, or show all rooms to see when they free up.' : 'This Teamup calendar has no sub-calendars.'}
                  </Empty>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {confirmRoom && <ConfirmBooking room={confirmRoom} onClose={() => setConfirmRoom(null)} />}
      {showMine && <MyBookings onClose={() => setShowMine(false)} />}
    </div>
  )
}

function ConfirmBooking({ room, onClose }: { room: Room; onClose: () => void }) {
  const s = useRoomStore(useShallow((st) => ({ book: st.book, date: st.date, from: st.from, meetingType: st.meetingType, meetingTypeField: st.meetingTypeField, setMeetingType: st.setMeetingType, setTitle: st.setTitle, title: st.title, to: st.to, who: st.who })))
  const who = s.who()
  const go = () => { onClose(); void s.book(room) }
  return (
    <Sheet
      title="Book this room?"
      onClose={onClose}
      size="narrow"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="button" className="btn primary" onClick={go} autoFocus><DoorOpen size={14} /> Book room</button>
        </>
      }
    >
      <div className="rooms-confirm">
        <div className="room-card"><DoorOpen size={20} /><RoomName name={room.name} /></div>
        <div className="line"><CalendarDays size={15} /><span>{dayLabel(s.date)}</span></div>
        <div className="line"><Clock3 size={15} /><span><b>{clock(s.from)}</b> to <b>{clock(s.to)}</b> <span className="faint">· {durLabel(s.to - s.from)}</span></span></div>
        <div className="line"><User size={15} /><span>{who}</span></div>
        <label className="rooms-confirm-field">
          <span>{s.meetingTypeField.name}</span>
          <select className="input" value={s.meetingType} onChange={(e) => s.setMeetingType(e.target.value)}>
            <option value="">Not set</option>
            {s.meetingTypeField.choices.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <input
          className="input"
          value={s.title}
          onChange={(e) => s.setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && go()}
          placeholder={`Meeting – ${who}`}
        />
      </div>
    </Sheet>
  )
}

/** Everything booked under my name from now on, by day; jump to it or cancel it. */
function MyBookings({ onClose }: { onClose: () => void }) {
  const s = useRoomStore(useShallow((st) => ({ cancel: st.cancel, mine: st.mine, mineLoading: st.mineLoading, rooms: st.rooms, setDate: st.setDate, setRange: st.setRange, who: st.who })))
  const roomName = (b: Booking) => s.rooms.find((r) => b.subcalendar_ids.includes(r.id))?.name ?? 'Room'
  const days = new Map<string, Booking[]>()
  for (const b of s.mine ?? []) {
    const d = isoDate(new Date(b.start_dt))
    days.set(d, [...(days.get(d) ?? []), b])
  }
  const today = isoDate(new Date())
  const tomorrow = isoDate(new Date(Date.now() + 86400000))
  const label = (d: string) => (d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : dayLabel(d))
  const time = (iso: string) => { const t = new Date(iso); return clock(t.getHours() * 60 + t.getMinutes()) }
  const show = (b: Booking) => {
    const st = new Date(b.start_dt)
    const en = new Date(b.end_dt)
    s.setDate(isoDate(st))
    s.setRange(st.getHours() * 60 + st.getMinutes(), en.getHours() * 60 + en.getMinutes())
    onClose()
  }
  const cancel = async (b: Booking) => {
    if (await confirmAsync(`Cancel ${roomName(b)} on ${label(isoDate(new Date(b.start_dt)))}, ${time(b.start_dt)}–${time(b.end_dt)}?`, { okLabel: 'Cancel booking', cancelLabel: 'Keep', danger: true })) await s.cancel(b)
  }
  return (
    <Sheet title="My bookings" onClose={onClose} size="narrow" headerExtra={<span className="faint" style={{ fontSize: 'var(--fs-xs)' }}>Next {MINE_DAYS} days · booked as {s.who()}</span>}>
      {s.mine === null || (s.mineLoading && s.mine.length === 0) ? (
        <div className="empty-state"><span className="spinner" /></div>
      ) : s.mine.length === 0 ? (
        <Empty icon={<CalendarCheck size={26} />} title="No upcoming bookings">Rooms you book with your name in “Who” show up here.</Empty>
      ) : (
        <div className="rooms-mine">
          {[...days.entries()].map(([d, list]) => (
            <div key={d} className="rooms-mine-day">
              <div className="rooms-mine-h">{label(d)}</div>
              {list.map((b) => (
                <div key={b.id} className="rooms-mine-row">
                  <div className="when">{b.all_day ? 'All day' : <>{time(b.start_dt)}<span>–{time(b.end_dt)}</span></>}</div>
                  <div className="what">
                    <RoomName name={roomName(b)} />
                    <span className="t">{b.title}{typeLabel(b) && <span className="rooms-type">{typeLabel(b)}</span>}</span>
                  </div>
                  <div className="acts">
                    <button type="button" className="btn sm ghost" onClick={() => show(b)}>Show</button>
                    <button type="button" className="icon-btn sm" title="Cancel this booking" onClick={() => void cancel(b)}><X size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}
