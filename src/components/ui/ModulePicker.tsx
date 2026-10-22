import { ChevronDown, Layers, Plus } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { boardShows, createModule, listAreas, moduleLabel } from '@/lib/areas'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { Popover } from './Popover'

interface Props {
  project: string
  /** Area path in work item form ("Project\Audit"); empty means the project root. */
  value: string | undefined
  onChange: (path: string) => void
  disabled?: boolean
}

/** Pick a module (area path), or type a new one and create it. */
export function ModulePicker({ project, value, onChange, disabled }: Props) {
  const org = useAppStore((s) => s.activeOrg)
  const team = useAppStore((s) => (s.selectedProject?.name === project ? s.selectedTeam : null))
  const toast = useUiStore((s) => s.toast)
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [areas, setAreas] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [hl, setHl] = useState(0)

  useEffect(() => {
    if (!open || !org) return
    let live = true
    listAreas(org, project).then((a) => live && setAreas(a)).catch(() => live && setAreas([]))
    return () => { live = false }
  }, [open, org, project])

  const text = q.trim()
  const matches = useMemo(() => {
    const t = text.toLowerCase()
    return (areas ?? []).filter((a) => !t || moduleLabel(a).toLowerCase().includes(t))
  }, [areas, text])
  // Offer to create when what was typed is not already a module.
  const canCreate = !!text && !(areas ?? []).some((a) => moduleLabel(a).toLowerCase() === text.toLowerCase())
  const options = [...matches.map((a) => ({ kind: 'pick' as const, path: a })), ...(canCreate ? [{ kind: 'create' as const, path: '' }] : [])]

  const pick = (path: string) => { setOpen(false); setQ(''); onChange(path) }

  const create = async () => {
    if (!org || !text) return
    setBusy(true)
    try {
      const path = await createModule(org, project, text)
      pick(path)
      // A team board only shows the areas it is set up for; warn if this new module falls outside them.
      let warn: string | undefined
      if (team) {
        const ta = await api().teamAreas(org, project, team.name).catch(() => null)
        if (ta && !boardShows(ta, path)) warn = `The ${team.name} board does not include it yet. Turn on "Include sub areas" in the team's Areas settings, or items here will not show on the board.`
      }
      toast({ kind: warn ? 'info' : 'success', title: `Module “${text}” created`, detail: warn })
    } catch (e) {
      toast({ kind: 'error', title: 'Could not create the module', detail: String((e as { message?: string }).message ?? e) })
    } finally {
      setBusy(false)
    }
  }

  const choose = (i: number) => {
    const o = options[i]
    if (!o) return
    if (o.kind === 'create') void create()
    else pick(o.path)
  }

  return (
    <>
      <button ref={btn} type="button" className="field-btn module-btn" disabled={disabled || busy} onClick={() => { setOpen(true); setHl(0) }} title={value || project}>
        <Layers size={13} className="faint" />
        <span className="txt">{busy ? 'Creating…' : moduleLabel(value || project)}</span>
        <ChevronDown size={13} className="faint" />
      </button>
      <Popover anchor={btn.current} open={open} onClose={() => { setOpen(false); setQ('') }} width={300} className="module-pop">
        <input
          className="input"
          autoFocus
          value={q}
          placeholder="Find or type a new module"
          onChange={(e) => { setQ(e.target.value); setHl(0) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(options.length - 1, h + 1)) }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(0, h - 1)) }
            if (e.key === 'Enter') { e.preventDefault(); choose(hl) }
            if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
          }}
        />
        <div className="module-list">
          {areas === null && <div className="pop-hint">Loading modules…</div>}
          {options.map((o, i) => o.kind === 'pick' ? (
            <button key={o.path} type="button" className={`pop-item ${i === hl ? 'hl' : ''} ${o.path === (value || project) ? 'on' : ''}`} onMouseEnter={() => setHl(i)} onClick={() => pick(o.path)}>
              <span className="label">{moduleLabel(o.path)}</span>
            </button>
          ) : (
            <button key="create" type="button" className={`pop-item create ${i === hl ? 'hl' : ''}`} onMouseEnter={() => setHl(i)} onClick={() => void create()}>
              <Plus size={13} /><span className="label">Create module “{text}”</span>
            </button>
          ))}
          {areas !== null && areas.length <= 1 && !text && <div className="pop-hint">No modules yet. Type a name to create the first one.</div>}
        </div>
      </Popover>
    </>
  )
}
