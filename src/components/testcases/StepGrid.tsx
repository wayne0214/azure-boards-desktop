import DOMPurify from 'dompurify'
import { Copy, GripVertical, Layers, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react'
import { STEPS } from '@/lib/testcases/config'
import {
  duplicateStep, insertStep, moveStep, parseSteps, pasteSteps, plain, removeStep, replaceWithShared, serializeSteps, stepsFromPaste, stepsToText, textToSteps,
  type StepItem,
} from '@/lib/testcases/steps'
import type { WorkItem } from '@/lib/types'
import { useUiStore } from '@/store/useUiStore'

const SAVE_DELAY = 800
type Col = 'action' | 'expected'
const sanitize = (html: string) => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })

/** The steps of a test case: a keyboard-first grid of action and expected result, or plain text. */
export function StepGrid({ value, shared, usage, onChange, onMakeShared }: {
  value: string
  shared: WorkItem[]
  /** How many test cases use each shared steps item. */
  usage: Map<number, number>
  onChange: (xml: string) => void
  /** Turn steps into a Shared Steps item; resolves with its id. */
  onMakeShared?: (title: string, items: StepItem[]) => Promise<number | null>
}) {
  const [items, setItems] = useState(() => parseSteps(value))
  // Cells are uncontrolled while typing; a new version remounts them after a structural change.
  const [version, setVersion] = useState(0)
  const [mode, setMode] = useState<'grid' | 'text'>('grid')
  const [text, setText] = useState('')
  const [focus, setFocus] = useState<{ row: number; col: Col; end?: boolean } | null>(null)
  const [drag, setDrag] = useState<number | null>(null)
  const [slash, setSlash] = useState<{ row: number; q: string } | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const [sharedTitle, setSharedTitle] = useState('')
  const live = useRef(items)
  const emitted = useRef(value)
  const timer = useRef<number | null>(null)
  const cells = useRef(new Map<string, HTMLDivElement>())

  const sharedById = useMemo(() => new Map(shared.map((w) => [w.id, w])), [shared])
  const sharedByTitle = useMemo(() => new Map(shared.map((w) => [String(w.fields['System.Title'] ?? ''), w.id])), [shared])
  const titled = (list: StepItem[]) => list.map((it) => (it.kind === 'shared' && !it.title ? { ...it, title: String(sharedById.get(it.ref)?.fields['System.Title'] ?? '') || undefined } : it))

  // A save from elsewhere (or a reload) replaces what is shown, unless it is what this grid just sent.
  useEffect(() => {
    if (value === emitted.current) return
    // Typing not yet sent wins; it is saved on top of this when the timer fires.
    if (timer.current !== null) return
    emitted.current = value
    const next = parseSteps(value)
    live.current = next
    setItems(next)
    setVersion((v) => v + 1)
  }, [value])

  const emit = (next: StepItem[]) => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    const xml = serializeSteps(next, emitted.current)
    if (xml === emitted.current) return
    emitted.current = xml
    onChange(xml)
  }
  useEffect(() => () => { if (timer.current !== null) emit(live.current) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** A structural change: re-render the cells and save at once. */
  const commit = (next: StepItem[], nextFocus?: { row: number; col: Col; end?: boolean }) => {
    live.current = next
    setItems(next)
    setVersion((v) => v + 1)
    if (nextFocus) setFocus(nextFocus)
    emit(next)
  }

  useEffect(() => {
    if (!focus) return
    const el = cells.current.get(`${focus.row}:${focus.col}`)
    if (el) {
      el.focus()
      const range = document.createRange()
      range.selectNodeContents(el)
      range.collapse(!focus.end)
      const sel = window.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
    }
    setFocus(null)
  }, [focus, version])

  const typed = (row: number, col: Col, html: string) => {
    const cur = live.current[row]
    if (cur?.kind !== 'step') return
    live.current = live.current.map((it, j) => (j === row && it.kind === 'step' ? { ...it, [col]: html } : it))
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => emit(live.current), SAVE_DELAY)
  }

  const isEmpty = (it: StepItem | undefined) => it?.kind === 'step' && !plain(it.action).trim() && !plain(it.expected).trim()
  // Tab order: every step's action then expected; shared and raw rows are skipped.
  const order = live.current.flatMap((it, row) => (it.kind === 'step' ? (['action', 'expected'] as Col[]).map((col) => ({ row, col })) : []))

  const onKey = (e: KeyboardEvent<HTMLDivElement>, row: number, col: Col) => {
    const mod = e.metaKey || e.ctrlKey
    const list = live.current
    if (e.key === 'Enter' && !e.shiftKey && !mod) { e.preventDefault(); commit(insertStep(list, row), { row: row + 1, col: 'action' }) }
    else if (e.key === 'Tab') {
      e.preventDefault()
      const k = order.findIndex((c) => c.row === row && c.col === col) + (e.shiftKey ? -1 : 1)
      if (order[k]) setFocus({ ...order[k], end: true })
    }
    else if (mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      const dir = e.key === 'ArrowUp' ? -1 : 1
      if (row + dir >= 0 && row + dir < list.length) commit(moveStep(list, row, dir), { row: row + dir, col, end: true })
    }
    else if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); commit(duplicateStep(list, row), { row: row + 1, col, end: true }) }
    else if (e.key === '/' && col === 'action' && isEmpty(list[row]) && shared.length) { e.preventDefault(); setSlash({ row, q: '' }) }
    else if (e.key === 'Backspace' && col === 'action' && isEmpty(list[row]) && list.length > 1) {
      e.preventDefault()
      const prev = list.slice(0, row).map((it, j) => ({ it, j })).reverse().find((x) => x.it.kind === 'step')
      commit(removeStep(list, row), prev ? { row: prev.j, col: 'expected', end: true } : undefined)
    }
  }

  const onPaste = (e: ClipboardEvent<HTMLDivElement>, row: number) => {
    const raw = e.clipboardData.getData('text/plain')
    e.preventDefault()
    const rows = stepsFromPaste(raw)
    if (!rows) { document.execCommand('insertText', false, raw); return }
    const next = pasteSteps(live.current, row, rows)
    const replaced = isEmpty(live.current[row]) ? 0 : 1
    commit(next, { row: row + replaced + rows.length - 1, col: 'action', end: true })
    useUiStore.getState().toast({ kind: 'success', title: `${rows.length} steps pasted from Excel` })
  }

  const onDrop = (e: DragEvent, row: number) => {
    e.preventDefault()
    if (drag === null || drag === row) return setDrag(null)
    const list = live.current.slice()
    const [moved] = list.splice(drag, 1)
    list.splice(row, 0, moved)
    setDrag(null)
    commit(list)
  }

  const insertShared = (w: WorkItem) => {
    if (!slash) return
    const list = live.current
    const item: StepItem = { kind: 'shared', id: null, ref: w.id, title: String(w.fields['System.Title'] ?? '') }
    commit(isEmpty(list[slash.row]) ? list.map((it, j) => (j === slash.row ? item : it)) : [...list.slice(0, slash.row + 1), item, ...list.slice(slash.row + 1)])
    setSlash(null)
  }
  const pickRow = (row: number, extend: boolean) => {
    if (live.current[row]?.kind !== 'step') return
    setPicked((cur) => {
      if (!extend || cur.length === 0) return cur.length === 1 && cur[0] === row ? [] : [row]
      const from = Math.min(cur[0], row)
      const to = Math.max(cur[0], row)
      return Array.from({ length: to - from + 1 }, (_, k) => from + k).filter((i) => live.current[i]?.kind === 'step')
    })
  }
  const makeShared = async () => {
    if (!onMakeShared || !sharedTitle.trim() || picked.length === 0) return
    const chosen = picked.map((i) => live.current[i])
    const id = await onMakeShared(sharedTitle.trim(), chosen.map((it) => ({ ...it, id: null })))
    if (id === null) return
    commit(replaceWithShared(live.current, picked, id, sharedTitle.trim()))
    setPicked([]); setSharedTitle('')
  }
  /** The shared steps picker opens under the last row, so a pick lands at the end. */
  const openSharedPicker = () => {
    if (live.current.length === 0) commit(insertStep(live.current, -1))
    setSlash({ row: live.current.length - 1, q: '' })
  }
  const slashMatches = slash ? shared.filter((w) => String(w.fields['System.Title'] ?? '').toLowerCase().includes(slash.q.toLowerCase())).slice(0, 8) : []

  const toText = () => { setText(stepsToText(titled(live.current))); setMode('text') }
  const toGrid = () => { commit(textToSteps(text, titled(live.current), sharedByTitle)); setMode('grid') }

  const sharedSteps = (ref: number) => parseSteps(sharedById.get(ref)?.fields[STEPS] as string | undefined).length

  return (
    <div className="tc-steps-wrap">
      <div className="segmented small tc-steps-mode">
        <button type="button" className={mode === 'grid' ? 'on' : ''} onClick={() => mode === 'text' && toGrid()}>Grid</button>
        <button type="button" className={mode === 'text' ? 'on' : ''} onClick={() => mode === 'grid' && toText()}>Text</button>
      </div>
      {mode === 'text' ? (
        <>
          <textarea className="tc-steps-text" value={text} spellCheck={false} onChange={(e) => setText(e.target.value)} onBlur={() => emit(textToSteps(text, titled(live.current), sharedByTitle))} />
          <div className="tc-hint">One step per line: <code>Action =&gt; Expected result</code>. Shared steps: <code>/Title</code>.</div>
        </>
      ) : (
        <>
          <div className="tc-steps">
            <div className="tc-steps-head"><span>#</span><span>Action</span><span>Expected result</span><span /></div>
            {items.map((it, row) => (
              <div key={`${version}-${row}`} className={`tc-step ${drag === row ? 'dragging' : ''} ${picked.includes(row) ? 'picked' : ''}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, row)}>
                <span className="tc-step-n" draggable onDragStart={() => setDrag(row)} onDragEnd={() => setDrag(null)} onClick={(e) => pickRow(row, e.shiftKey)} title="Drag to reorder · click to select"><GripVertical size={12} />{row + 1}</span>
                {it.kind === 'step' ? (
                  (['action', 'expected'] as Col[]).map((col) => (
                    <div
                      key={col}
                      ref={(el) => { if (el) cells.current.set(`${row}:${col}`, el); else cells.current.delete(`${row}:${col}`) }}
                      className="tc-cell"
                      contentEditable
                      suppressContentEditableWarning
                      data-ph={col === 'action' ? 'Action' : 'Expected result (optional)'}
                      dangerouslySetInnerHTML={{ __html: sanitize(it[col]) }}
                      onInput={(e) => typed(row, col, e.currentTarget.innerHTML === '<br>' ? '' : e.currentTarget.innerHTML)}
                      onBlur={() => { if (timer.current !== null) emit(live.current) }}
                      onKeyDown={(e) => onKey(e, row, col)}
                      onPaste={(e) => onPaste(e, row)}
                    />
                  ))
                ) : it.kind === 'shared' ? (
                  <div className="tc-step-shared"><Layers size={14} /><b>{String(sharedById.get(it.ref)?.fields['System.Title'] ?? `Shared steps #${it.ref}`)}</b><span className="faint">shared steps · {sharedSteps(it.ref)} steps · edits apply everywhere</span></div>
                ) : (
                  <div className="tc-step-shared faint">Unsupported step kept as is</div>
                )}
                {slash?.row === row && (
                  <div className="tc-slash" onMouseDown={(e) => e.preventDefault()}>
                    <input autoFocus className="input" value={slash.q} placeholder="Find shared steps" onChange={(e) => setSlash({ row, q: e.target.value })}
                      onKeyDown={(e) => { if (e.key === 'Escape') setSlash(null); else if (e.key === 'Enter' && slashMatches[0]) { e.preventDefault(); insertShared(slashMatches[0]) } }} onBlur={() => setSlash(null)} />
                    {slashMatches.map((w) => (
                      <button key={w.id} type="button" onClick={() => insertShared(w)}>
                        <b>{String(w.fields['System.Title'] ?? '')}</b>
                        <small>{sharedSteps(w.id)} steps · used by {usage.get(w.id) ?? 0} test case{usage.get(w.id) === 1 ? '' : 's'}</small>
                      </button>
                    ))}
                    {slashMatches.length === 0 && <small className="faint">No shared steps match.</small>}
                  </div>
                )}
                <span className="tc-step-tools">
                  {it.kind === 'step' && <button type="button" className="icon-btn sm" title="Duplicate" onClick={() => commit(duplicateStep(live.current, row))}><Copy size={12} /></button>}
                  <button type="button" className="icon-btn sm" title="Delete step" onClick={() => commit(removeStep(live.current, row))}><X size={13} /></button>
                </span>
              </div>
            ))}
            <div className="tc-step-adds">
              <button type="button" className="tc-step-add" onClick={() => commit(insertStep(live.current, live.current.length - 1), { row: live.current.length, col: 'action' })}>+ Add step</button>
              {shared.length > 0 && <button type="button" className="tc-step-add" onClick={openSharedPicker}>+ Insert shared steps</button>}
            </div>
          </div>
          {picked.length > 0 && onMakeShared && (
            <div className="tc-picked-bar">
              <span>{picked.length} step{picked.length === 1 ? '' : 's'} selected</span>
              <input className="input" value={sharedTitle} placeholder="Name for the shared steps" onChange={(e) => setSharedTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void makeShared()} />
              <button type="button" className="btn sm primary" disabled={!sharedTitle.trim()} onClick={() => void makeShared()}>Save as shared steps</button>
              <button type="button" className="btn sm" onClick={() => setPicked([])}>Cancel</button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
