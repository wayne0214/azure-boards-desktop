import { CalendarClock, ChevronLeft, ChevronRight, Copy, Eraser, ExternalLink, LogIn, Plus, RefreshCw, Send, Trash2 } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Dropdown } from '@/components/ui/Dropdown'
import { Empty } from '@/components/ui/Empty'
import { addDays, sundayOf, useTimesheetStore } from '@/store/useTimesheetStore'
import { useUiStore } from '@/store/useUiStore'
import { confirmAsync } from '@/lib/confirm'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** Hours expected on each day, Sun..Sat. Weekends are never flagged. */
const EXPECTED = [0, 8.5, 8.5, 8.5, 8.5, 8, 0]
const EXPECTED_WEEK = EXPECTED.reduce((a, b) => a + b, 0)

/** Class and tooltip for a total that is short of, or beyond, what the day or week expects. */
function hint(actual: number, expected: number): { cls: string; title: string } {
  if (expected === 0 || actual === expected) return { cls: '', title: '' }
  const diff = Math.round(Math.abs(actual - expected) * 100) / 100
  return actual < expected
    ? { cls: 'under', title: `${diff} h short of the expected ${expected} h` }
    : { cls: 'over', title: `${diff} h over the expected ${expected} h` }
}

function fmtDay(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Weekly timesheet: fill the grid, press one button, done. */
export function TimesheetView() {
  const s = useTimesheetStore(useShallow((st) => ({ addRow: st.addRow, baseUrl: st.baseUrl, connect: st.connect, copyLastWeek: st.copyLastWeek, fillWeekdays: st.fillWeekdays, finishLogin: st.finishLogin, loadWeek: st.loadWeek, log: st.log, message: st.message, openWindow: st.openWindow, phase: st.phase, progress: st.progress, projects: st.projects, reloadWindow: st.reloadWindow, removeRow: st.removeRow, resetSession: st.resetSession, rows: st.rows, save: st.save, saveAndSubmit: st.saveAndSubmit, setHours: st.setHours, setNote: st.setNote, shiftWeek: st.shiftWeek, weekStart: st.weekStart })))
  const [addOpen, setAddOpen] = useState(false)
  const addBtn = useRef<HTMLButtonElement>(null)
  const openSheet = useUiStore((st) => st.openSheet)

  useEffect(() => {
    if (s.phase === 'idle') void s.connect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // While waiting for sign-in, check every few seconds whether it finished.
  useEffect(() => {
    if (s.phase !== 'login') return
    const id = setInterval(() => void s.finishLogin(), 3000)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.phase])

  const totals = useMemo(() => {
    const perDay = [0, 0, 0, 0, 0, 0, 0]
    for (const r of s.rows) r.hours.forEach((h, i) => (perDay[i] += h))
    return { perDay, week: perDay.reduce((a, b) => a + b, 0) }
  }, [s.rows])

  const available = s.projects.filter((p) => !s.rows.some((r) => r.project.toLowerCase() === p.toLowerCase()))
  const isCurrent = s.weekStart === sundayOf(new Date())
  const dirtyCount = s.rows.filter((r) => r.dirty && r.hours.some((h) => h > 0)).length
  const busy = s.phase === 'working' || s.phase === 'connecting'
  const resetSession = async () => {
    const ok = await confirmAsync('This signs you out of the timesheet and clears its cookies and cached site data. Hours you have not saved yet stay in the app.\n\nUse it when the timesheet window stays blank or sign-in keeps failing.', { title: 'Clear timesheet cookies?', okLabel: 'Clear and sign in again', danger: true })
    if (ok) await s.resetSession()
  }
  const weekHint = totals.week ? hint(totals.week, EXPECTED_WEEK) : { cls: '', title: '' }

  return (
    <div className="ts">
      <div className="ts-head">
        <div className="ts-week">
          <button type="button" className="icon-btn" onClick={() => void s.shiftWeek(-1)} disabled={busy} title="Previous week"><ChevronLeft size={18} /></button>
          <div className="ts-week-title">
            <strong>{fmtDay(s.weekStart)} – {fmtDay(addDays(s.weekStart, 6))}</strong>
            <span className="faint">{isCurrent ? 'This week' : new Date(s.weekStart) < new Date() ? 'Past week' : 'Upcoming'}</span>
          </div>
          <button type="button" className="icon-btn" onClick={() => void s.shiftWeek(1)} disabled={busy} title="Next week"><ChevronRight size={18} /></button>
          {!isCurrent && <button type="button" className="btn sm" onClick={() => void s.loadWeek(sundayOf(new Date()))} disabled={busy}>Today</button>}
        </div>
        <div className="grow" />
        <StatusPill />
        <button type="button" className="icon-btn" title="Reload from the timesheet site" onClick={() => void s.loadWeek()} disabled={busy}><RefreshCw size={16} className={busy ? 'spin' : ''} /></button>
        <button type="button" className="icon-btn" title="Show the timesheet window" onClick={() => void s.openWindow()}><ExternalLink size={16} /></button>
        <button type="button" className="icon-btn" title="Clear timesheet cookies and sign in again (fixes a blank window)" onClick={() => void resetSession()} disabled={s.phase === 'working' || !s.baseUrl}><Eraser size={16} /></button>
      </div>

      {s.phase === 'login' && (
        <div className="ts-note warn">
          <LogIn size={16} />
          <span className="msg">{s.message ?? 'Sign in in the timesheet window.'} The app continues by itself once you are in.</span>
          <button type="button" className="btn sm" onClick={() => void s.openWindow()}>Show window</button>
          <button type="button" className="btn sm" onClick={() => void resetSession()}>Clear cookies</button>
        </div>
      )}
      {s.phase === 'error' && (
        <div className="ts-note danger">
          <span className="msg">{s.message}</span>
          {s.baseUrl ? (
            <>
              <button type="button" className="btn sm primary" onClick={() => void s.connect()}>Try again</button>
              <button type="button" className="btn sm" onClick={() => void s.reloadWindow()}>Show & reload window</button>
              <button type="button" className="btn sm" onClick={() => void resetSession()}>Clear cookies & sign in again</button>
            </>
          ) : (
            <button type="button" className="btn sm primary" onClick={() => openSheet('settings')}>Open Settings</button>
          )}
        </div>
      )}
      {s.progress && (
        <div className="ts-note">
          <span className="spinner" />
          <span className="msg">{s.progress.label}</span>
          <span className="faint">{s.progress.done} of {s.progress.total}</span>
        </div>
      )}

      {s.phase === 'connecting' && s.rows.length === 0 ? (
        <div className="empty-state"><span className="spinner lg" /><p>Connecting to the timesheet…</p></div>
      ) : (
        <div className="ts-body">
          <table className="ts-grid">
            <thead>
              <tr>
                <th className="proj">Project</th>
                {DAYS.map((d, i) => (
                  <th key={d} className={`day ${i === 0 || i === 6 ? 'wk' : ''}`}><div>{d}</div><div className="faint">{fmtDay(addDays(s.weekStart, i))}</div></th>
                ))}
                <th className="num">Total</th>
                <th className="note">Note for the week</th>
                <th className="act" />
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r, ri) => (
                <tr key={r.project} className={r.locked ? 'locked' : r.dirty ? 'dirty' : ''}>
                  <td className="proj">
                    <div className="pname" title={r.project}>{r.project}</div>
                    <RowStatus status={r.status} dirty={r.dirty} />
                  </td>
                  {r.hours.map((h, i) => (
                    <td key={i} className={`day ${i === 0 || i === 6 ? 'wk' : ''}`}>
                      <HourCell row={ri} day={i} value={h} disabled={r.locked || busy} onChange={(v) => s.setHours(r.project, i, v)} />
                    </td>
                  ))}
                  <td className="num total">{sum(r.hours)}</td>
                  <td className="note">
                    <input className="ts-input" value={r.note} placeholder={r.locked ? '' : 'What did you work on?'} disabled={r.locked || busy} onChange={(e) => s.setNote(r.project, e.target.value)} />
                  </td>
                  <td className="act">
                    {!r.locked && (
                      <>
                        <button type="button" className="icon-btn sm" title="Fill Mon–Fri with 8 h" onClick={() => s.fillWeekdays(r.project, 8)} disabled={busy}><CalendarClock size={14} /></button>
                        {r.status === 'draft' && <button type="button" className="icon-btn sm" title="Remove row" onClick={() => s.removeRow(r.project)} disabled={busy}><Trash2 size={14} /></button>}
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {s.rows.length === 0 && s.phase === 'ready' && (
                <tr><td colSpan={11}><Empty title="No hours for this week yet">Add a project below, or copy last week and adjust.</Empty></td></tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="proj faint">Total <span className="ts-expected">· expected {EXPECTED_WEEK} h</span></td>
                {totals.perDay.map((h, i) => {
                  const k = totals.week ? hint(h, EXPECTED[i]) : { cls: '', title: '' }
                  return <td key={i} className={`day num ${i === 0 || i === 6 ? 'wk' : ''} ${k.cls}`} title={k.title}>{h || ''}</td>
                })}
                <td className={`num total ${weekHint.cls}`} title={weekHint.title}>{totals.week}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          </table>

          <div className="ts-actions">
            <button ref={addBtn} type="button" className="btn" onClick={() => setAddOpen(true)} disabled={busy || available.length === 0}><Plus size={15} /> Add project</button>
            <Dropdown anchor={addBtn.current} open={addOpen} onClose={() => setAddOpen(false)} options={available.map((p) => ({ value: p, label: p }))} searchable width={360} onSelect={(p) => s.addRow(p)} />
            <button type="button" className="btn" onClick={() => void s.copyLastWeek()} disabled={busy}><Copy size={15} /> Copy last week</button>
            <span className="grow" />
            {dirtyCount > 0 && <span className="faint">{dirtyCount} row{dirtyCount > 1 ? 's' : ''} not saved yet</span>}
            <button type="button" className="btn" onClick={() => void s.save()} disabled={busy || dirtyCount === 0 || s.phase !== 'ready'}>Save</button>
            <button type="button" className="btn primary" onClick={() => void confirmAsync(`Save ${dirtyCount ? `${dirtyCount} row${dirtyCount > 1 ? 's' : ''} and ` : ''}submit this week for approval?`, { okLabel: 'Submit' }).then((ok) => { if (ok) void s.saveAndSubmit() })} disabled={busy || s.phase !== 'ready' || (dirtyCount === 0 && !s.rows.some((r) => r.status === 'saved'))}>
              <Send size={15} /> {dirtyCount ? 'Save & submit' : 'Submit saved'}
            </button>
          </div>

          {s.log.length > 0 && (
            <details className="ts-log">
              <summary>{s.log.length} note{s.log.length > 1 ? 's' : ''} from the last run</summary>
              {s.log.slice(-10).map((l, i) => <div key={i}>{l}</div>)}
            </details>
          )}
        </div>
      )}
    </div>
  )
}

function sum(a: number[]) { return Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100 }

/** Focus the nearest enabled hour cell in the given direction; false when there is none. */
function focusCell(from: HTMLInputElement, row: number, day: number, dr: number, dd: number): boolean {
  const table = from.closest('table')
  if (!table) return false
  for (let r = row + dr, d = day + dd, n = 0; n < 200; r += dr, d += dd, n++) {
    if (d < 0 || d > 6 || r < 0) return false
    const next = table.querySelector<HTMLInputElement>(`.ts-hour[data-r="${r}"][data-d="${d}"]`)
    if (!next) return false
    if (!next.disabled) { next.focus(); return true }
  }
  return false
}

function HourCell({ row, day, value, disabled, onChange }: { row: number; day: number; value: number; disabled: boolean; onChange: (v: number) => void }) {
  const [v, setV] = useState(value ? String(value) : '')
  useEffect(() => setV(value ? String(value) : ''), [value])
  const commit = () => {
    const n = v.trim() === '' ? 0 : Number(v)
    if (Number.isNaN(n) || n < 0 || n > 24) { setV(value ? String(value) : ''); return }
    if (n !== value) onChange(n)
  }
  return (
    <input
      className="ts-hour"
      data-r={row}
      data-d={day}
      inputMode="decimal"
      value={v}
      disabled={disabled}
      placeholder="·"
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        // Moving focus to another cell blurs this one, which commits the value.
        const el = e.currentTarget
        const all = el.selectionStart === 0 && el.selectionEnd === el.value.length
        if (e.key === 'Enter') { e.preventDefault(); if (!focusCell(el, row, day, e.shiftKey ? -1 : 1, 0)) el.blur(); return }
        if (e.key === 'ArrowLeft' && (all || el.selectionStart === 0)) { e.preventDefault(); focusCell(el, row, day, 0, -1); return }
        if (e.key === 'ArrowRight' && (all || el.selectionEnd === el.value.length)) { e.preventDefault(); focusCell(el, row, day, 0, 1); return }
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft' || e.key === 'Tab') return
        if (e.key === 'ArrowUp') { e.preventDefault(); setV(String(Math.min(24, (Number(v) || 0) + 0.5))) }
        if (e.key === 'ArrowDown') { e.preventDefault(); setV(String(Math.max(0, (Number(v) || 0) - 0.5))) }
      }}
    />
  )
}

function RowStatus({ status, dirty }: { status: string; dirty: boolean }) {
  const label = dirty ? 'Not saved' : status === 'saved' ? 'Saved' : status === 'submitted' ? 'Submitted' : status === 'approved' ? 'Approved' : status === 'rejected' ? 'Needs changes' : 'Draft'
  return <span className={`ts-status ${dirty ? 'draft' : status}`}>{label}</span>
}

function StatusPill() {
  const phase = useTimesheetStore((s) => s.phase)
  const lastRead = useTimesheetStore((s) => s.lastRead)
  const map: Record<string, { cls: string; text: string }> = {
    idle: { cls: '', text: 'Not connected' },
    connecting: { cls: '', text: 'Connecting…' },
    login: { cls: 'warn', text: 'Sign-in needed' },
    ready: { cls: 'ok', text: lastRead ? 'Connected' : 'Connected' },
    working: { cls: '', text: 'Working…' },
    error: { cls: 'bad', text: 'Problem' },
  }
  const m = map[phase]
  return <span className={`ts-pill ${m.cls}`}><i />{m.text}</span>
}
