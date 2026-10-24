import { ArrowRight, Download, FolderKanban, GitBranch, Hash, Inbox, Minimize2, Plus, Search, Settings, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { WorkItem } from '@/lib/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useUiStore } from '@/store/useUiStore'

interface Entry {
  id: string
  label: string
  sub?: string
  group: string
  icon: React.ReactNode
  run: () => void
}

/** ⌘K: jump to a project, open an item by number or title, or run a command. */
export function CommandPalette({ onCommand }: { onCommand: (id: string) => void }) {
  const close = () => useUiStore.getState().setPaletteOpen(false)
  const projects = useAppStore((s) => s.projects)
  const activeOrg = useAppStore((s) => s.activeOrg)
  const project = useAppStore((s) => s.selectedProject)
  const selectProject = useAppStore((s) => s.selectProject)
  const items = useBoardStore((s) => s.items)
  const select = useBoardStore((s) => s.select)
  const selectedId = useBoardStore((s) => s.selectedId)
  const setView = useUiStore((s) => s.setView)
  const [q, setQ] = useState('')
  const [hl, setHl] = useState(0)
  const [remote, setRemote] = useState<WorkItem[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  // Search Azure DevOps for items that are not on the current board.
  useEffect(() => {
    const t = q.trim()
    if (!activeOrg || t.length < 2) { setRemote([]); return }
    const h = setTimeout(() => {
      api().searchWorkItems(activeOrg, project?.name ?? null, t).then(setRemote).catch(() => setRemote([]))
    }, 250)
    return () => clearTimeout(h)
  }, [q, activeOrg, project?.name])

  const entries = useMemo<Entry[]>(() => {
    const t = q.trim().toLowerCase()
    const out: Entry[] = []
    const cmds: Entry[] = [
      { id: 'new-item', label: 'New work item', group: 'Commands', icon: <Plus size={16} />, run: () => onCommand('new-item') },
      ...(selectedId !== null ? [{ id: 'start-work', label: `Start work on #${selectedId}`, group: 'Commands', icon: <GitBranch size={16} />, run: () => onCommand('start-work') }] : []),
      { id: 'view-mine', label: 'My Work', group: 'Commands', icon: <Inbox size={16} />, run: () => setView('mine') },
      { id: 'toggle-mini', label: 'Mini mode', group: 'Commands', icon: <Minimize2 size={16} />, run: () => onCommand('toggle-mini') },
      { id: 'import', label: 'Import from CSV', group: 'Commands', icon: <Upload size={16} />, run: () => onCommand('import') },
      { id: 'export', label: 'Export view as CSV', group: 'Commands', icon: <Upload size={16} />, run: () => onCommand('export') },
      { id: 'settings', label: 'Settings', group: 'Commands', icon: <Settings size={16} />, run: () => onCommand('settings') },
      { id: 'check-updates', label: 'Check for updates', group: 'Commands', icon: <Download size={16} />, run: () => onCommand('check-updates') },
      { id: 'help-shortcuts', label: 'Keyboard shortcuts', group: 'Commands', icon: <Settings size={16} />, run: () => onCommand('help-shortcuts') },
    ]
    const projEntries: Entry[] = projects.map((p) => ({ id: `p:${p.id}`, label: p.name, sub: p.id === project?.id ? 'current' : undefined, group: 'Projects', icon: <FolderKanban size={16} />, run: () => void selectProject(p) }))
    const local = new Set<number>()
    const itemEntries: Entry[] = items
      .filter((it) => !t || String(it.id).includes(t.replace('#', '')) || String(it.fields['System.Title'] ?? '').toLowerCase().includes(t))
      .slice(0, 8)
      .map((it) => { local.add(it.id); return { id: `i:${it.id}`, label: String(it.fields['System.Title'] ?? ''), sub: `#${it.id} · ${it.fields['System.State']}`, group: 'On this board', icon: <Hash size={16} />, run: () => { setView(useUiStore.getState().view === 'mine' ? 'board' : useUiStore.getState().view); select(it.id) } } })
    const remoteEntries: Entry[] = remote.filter((it) => !local.has(it.id)).slice(0, 6).map((it) => ({ id: `r:${it.id}`, label: String(it.fields['System.Title'] ?? ''), sub: `#${it.id} · ${it.fields['System.TeamProject']} · ${it.fields['System.State']}`, group: 'Elsewhere', icon: <Search size={16} />, run: () => { if (activeOrg) void api().openUrl(`https://dev.azure.com/${encodeURIComponent(activeOrg)}/${encodeURIComponent(String(it.fields['System.TeamProject']))}/_workitems/edit/${it.id}`) } }))
    if (!t) {
      out.push(...projEntries.slice(0, 6), ...cmds)
    } else {
      out.push(...itemEntries, ...projEntries.filter((p) => p.label.toLowerCase().includes(t)), ...cmds.filter((c) => c.label.toLowerCase().includes(t)), ...remoteEntries)
    }
    return out
  }, [q, projects, project, items, remote, activeOrg, onCommand, selectProject, select, setView, selectedId])

  useEffect(() => setHl(0), [q])
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-idx="${hl}"]`)?.scrollIntoView({ block: 'nearest' }) }, [hl])

  const run = (e: Entry) => { close(); e.run() }
  let lastGroup = ''
  return (
    <div className="palette-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Go to anything">
        <div className="inp">
          <Search size={18} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Jump to a project, find #1234 or a title, run a command…"
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.preventDefault(); close() }
              if (e.key === 'ArrowDown') { e.preventDefault(); setHl((h) => Math.min(entries.length - 1, h + 1)) }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHl((h) => Math.max(0, h - 1)) }
              if (e.key === 'Enter') { e.preventDefault(); const en = entries[hl]; if (en) run(en) }
            }} />
        </div>
        <div className="results" ref={listRef}>
          {entries.length === 0 && <div className="pop-empty">Nothing matches “{q}”.</div>}
          {entries.map((en, i) => {
            const head = en.group !== lastGroup ? en.group : null
            lastGroup = en.group
            return (
              <div key={en.id}>
                {head && <div className="pop-head">{head}</div>}
                <button type="button" data-idx={i} className={`pop-item ${i === hl ? 'hl' : ''}`} onMouseEnter={() => setHl(i)} onClick={() => run(en)}>
                  <span className="ico">{en.icon}</span>
                  <span className="label">{en.label}</span>
                  {en.sub && <span className="sub">{en.sub}</span>}
                  {i === hl && <ArrowRight size={14} className="faint" />}
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
