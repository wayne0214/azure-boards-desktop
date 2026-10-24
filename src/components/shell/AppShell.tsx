import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus } from 'lucide-react'
import { api } from '@/lib/api'
import { itemUrl } from '@/lib/format'
import { listenForPastedImages, takesImages } from '@/lib/pasteBug'
import { inEditable, isModKey } from '@/lib/shortcuts'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useMyWorkStore } from '@/store/useMyWorkStore'
import { useUiStore, type View } from '@/store/useUiStore'
import { BoardView } from '../board/BoardView'
import { Inspector } from '../inspector/Inspector'
import { ListView } from '../list/ListView'
import { MyWorkView } from '../mine/MyWorkView'
import { TimesheetView } from '../timesheet/TimesheetView'
import { MeetingRoomView } from '../rooms/MeetingRoomView'
import { ImportsView } from '../imports/ImportsView'
import { RequirementsView } from '../requirements/RequirementsView'
import { TestCasesView } from '../testcases/TestCasesView'
import { PlansView } from '../plans/PlansView'
import { TeamView } from '../team/TeamView'
import { PrView } from '../pr/PrView'
import { VersioningView } from '../versioning/VersioningView'
import { CompletePrSheet } from '../pr/CompletePrSheet'
import { NewPrSheet } from '../pr/NewPrSheet'
import { checkForUpdates, startUpdateChecks } from '@/lib/updater'
import { startNotifications } from '@/lib/notify/poller'
import { StartWorkSheet } from '../sheets/StartWorkSheet'
import { GitToolsPanel } from '../pr/GitToolsPanel'
import { CommandPalette } from '../palette/CommandPalette'
import { ConnectScreen } from '../sheets/ConnectScreen'
import { ImportSheet } from '../sheets/ImportSheet'
import { NewItemSheet } from '../sheets/NewItemSheet'
import { SettingsSheet } from '../sheets/SettingsSheet'
import { ShortcutsSheet } from '../sheets/ShortcutsSheet'
import { WhatsNewSheet } from '../sheets/WhatsNewSheet'
import { exportCsv } from '../list/exportCsv'
import { Sidebar } from './Sidebar'
import { StatusBar } from './StatusBar'
import { Toolbar } from './Toolbar'
import { confirmAsync } from '@/lib/confirm'
import { ErrorBoundary } from '../ui/ErrorBoundary'
import { MiniView } from '../mini/MiniView'
import { fitMiniPopup } from '@/lib/miniWindow'
import { refreshCurrentView, refreshInBackground, refreshOnFocus } from '@/lib/refresh'
import { usePrStore } from '@/store/usePrStore'

const VIEW_NAMES: Record<View, string> = { board: 'The board', list: 'The list', mine: 'My Work', timesheet: 'Timesheet', prs: 'Pull Requests', rooms: 'Meeting Rooms', reqs: 'Requirements', tests: 'Test Cases', plans: 'Test Plans', team: 'Team', imports: 'Imports', versioning: 'Versioning' }

export function AppShell() {
  const sidebarOpen = useUiStore((s) => s.sidebarOpen)
  const inspectorOpen = useUiStore((s) => s.inspectorOpen)
  const activeOrg = useAppStore((s) => s.activeOrg)
  const view = useUiStore((s) => s.view)
  const sheet = useUiStore((s) => s.sheet)
  const density = useUiStore((s) => s.density)
  const pending = useUiStore((s) => s.pending > 0)
  const paletteOpen = useUiStore((s) => s.paletteOpen)
  const mini = useUiStore((s) => s.mini)

  const runCommand = useCallback((id: string) => {
    const ui = useUiStore.getState()
    const app = useAppStore.getState()
    const b = useBoardStore.getState()
    const org = app.activeOrg
    const project = app.selectedProject
    const selected = b.selectedId !== null ? b.items.find((i) => i.id === b.selectedId) : null
    switch (id) {
      case 'new-item': if (project || (ui.view === 'mine' && app.projects.length)) ui.openSheet('new-item'); break
      case 'import': if (project) ui.openSheet('import'); break
      case 'export': void exportCsv(); break
      case 'refresh': refreshCurrentView(); break
      case 'open-web': if (org && project) void api().openUrl(`https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project.name)}/_boards/board`); break
      case 'find': window.dispatchEvent(new Event('app:focus-search')); break
      case 'palette': ui.setPaletteOpen(true); break
      case 'view-board': ui.setView('board'); break
      case 'view-list': ui.setView('list'); break
      case 'view-mine': ui.setView('mine'); break
      case 'view-timesheet': ui.setView('timesheet'); break
      case 'view-prs': ui.setView('prs'); break
      case 'view-rooms': ui.setView('rooms'); break
      case 'toggle-sidebar': ui.toggleSidebar(); break
      case 'toggle-inspector': ui.toggleInspector(); break
      case 'toggle-mini': ui.setMini(!ui.mini); break
      case 'text-bigger': ui.setTextScale(ui.textScale + 0.1); break
      case 'text-smaller': ui.setTextScale(ui.textScale - 0.1); break
      case 'text-reset': ui.setTextScale(1); break
      case 'settings': ui.openSheet('settings'); break
      case 'assign-me': if (selected) { const me = app.account(); if (me) void b.assign(selected.id, me.userName) } break
      case 'start-work': { const id = b.selectedId; if (id !== null && b.getItem(id)) ui.openSheet('start-work', { id }) } break
      case 'copy-link': if (selected && org && project) { void navigator.clipboard.writeText(itemUrl(org, project.name, selected.id)); ui.toast({ kind: 'success', title: 'Link copied' }) } break
      case 'open-item-web': if (selected && org && project) void api().openUrl(itemUrl(org, project.name, selected.id)); break
      case 'delete-item': if (selected) void confirmAsync(`Move #${selected.id} to the recycle bin?`, { okLabel: 'Move to Recycle Bin', danger: true }).then((ok) => { if (ok) void b.remove(selected.id) }); break
      case 'help-pat': void api().openUrl('https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate'); break
      case 'help-shortcuts': ui.openSheet('shortcuts'); break
      case 'check-updates': void checkForUpdates(true); break
      case 'whats-new': ui.openSheet('whats-new'); break
    }
  }, [])

  // Native menu events (desktop) and keyboard shortcuts (both).
  useEffect(() => api().onMenu(runCommand), [runCommand])
  useEffect(() => startUpdateChecks(), [])
  useEffect(() => startNotifications(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = isModKey(e)
      const k = e.key.toLowerCase()
      if (mod && k === 'k') { e.preventDefault(); runCommand('palette'); return }
      if (mod && k === 'n' && !e.shiftKey) { e.preventDefault(); runCommand('new-item'); return }
      if (mod && k === 'r') { e.preventDefault(); runCommand('refresh'); return }
      if (mod && k === 'f') { e.preventDefault(); runCommand('find'); return }
      if (mod && k === 'i' && !e.shiftKey) { e.preventDefault(); runCommand('toggle-inspector'); return }
      if (mod && e.shiftKey && k === 's') { e.preventDefault(); runCommand('toggle-sidebar'); return }
      if (mod && e.shiftKey && k === 'd') { e.preventDefault(); runCommand('toggle-mini'); return }
      if (mod && e.shiftKey && k === 'i') { e.preventDefault(); runCommand('import'); return }
      if (mod && e.shiftKey && k === 'e') { e.preventDefault(); runCommand('export'); return }
      if (mod && e.shiftKey && k === 'm') { e.preventDefault(); runCommand('assign-me'); return }
      if (mod && e.shiftKey && k === 'c') { e.preventDefault(); runCommand('copy-link'); return }
      if (mod && k === ',') { e.preventDefault(); runCommand('settings'); return }
      if (mod && k === '/') { e.preventDefault(); runCommand('help-shortcuts'); return }
      if (mod && (k === '=' || k === '+')) { e.preventDefault(); runCommand('text-bigger'); return }
      if (mod && k === '-') { e.preventDefault(); runCommand('text-smaller'); return }
      if (mod && k === '0') { e.preventDefault(); runCommand('text-reset'); return }
      if (mod && k === '1') { e.preventDefault(); runCommand('view-board'); return }
      if (mod && k === '2') { e.preventDefault(); runCommand('view-list'); return }
      if (mod && k === '3') { e.preventDefault(); runCommand('view-mine'); return }
      if (mod && k === '4') { e.preventDefault(); runCommand('view-prs'); return }
      if (mod && k === '5') { e.preventDefault(); runCommand('view-timesheet'); return }
      if (mod && k === '6') { e.preventDefault(); runCommand('view-rooms'); return }
      if (mod && k === 'backspace' && !inEditable(e.target)) { e.preventDefault(); runCommand('delete-item'); return }
      if (e.key === 'Escape' && !inEditable(e.target)) {
        const ui = useUiStore.getState()
        if (ui.sheet || ui.paletteOpen) return
        useBoardStore.getState().clearSelection()
        ui.toggleInspector(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [runCommand])

  // Dropping a screenshot anywhere outside a field that takes images starts a new Bug with it in the Symptom.
  const [dropHint, setDropHint] = useState(false)
  const hintTimer = useRef<number | null>(null)
  useEffect(() => {
    const hasImage = (e: DragEvent) => Array.from(e.dataTransfer?.items ?? []).some((i) => i.kind === 'file' && i.type.startsWith('image/'))
    // Rich text fields and the run screenshot area take the image themselves.
    const ownDrop = takesImages
    const free = () => !useUiStore.getState().sheet
    const onOver = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return
      const show = hasImage(e) && free() && !ownDrop(e.target)
      e.dataTransfer.dropEffect = show || ownDrop(e.target) ? 'copy' : 'none'
      setDropHint(show)
      if (hintTimer.current !== null) window.clearTimeout(hintTimer.current)
      hintTimer.current = window.setTimeout(() => setDropHint(false), 150)
    }
    const onDrop = (e: DragEvent) => {
      setDropHint(false)
      if (!e.dataTransfer?.types.includes('Files')) return
      // main.tsx already cancels every drop, so whether a field took it is told by where it landed.
      if (ownDrop(e.target)) return
      const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
      if (files.length === 0 || !free()) return
      useUiStore.getState().openSheet('new-item', { type: 'Bug', images: files })
    }
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    // Pasting a screenshot outside a field does the same.
    const stopPaste = listenForPastedImages((images) => useUiStore.getState().openSheet('new-item', { type: 'Bug', images }), free)
    return () => {
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
      stopPaste()
    }
  }, [])

  // In mini mode the bug form fills the small window, which grows only if it is too small for it.
  const popup = mini && sheet === 'new-item'
  useEffect(() => {
    document.body.classList.toggle('mini-popup', popup)
    if (!mini) return
    fitMiniPopup(popup).catch((e) => useUiStore.getState().toast({ kind: 'error', title: 'Could not resize the window', detail: String((e as Error)?.message ?? e) }))
  }, [mini, popup])

  // The sidebar counts load as soon as an organization is active, so they are right from the start.
  useEffect(() => {
    void useMyWorkStore.getState().load({ silent: true })
    void usePrStore.getState().loadInvolved()
  }, [activeOrg])

  // Opening My Work marks its changes as seen; so does leaving it, for whatever arrived while it was open.
  useEffect(() => {
    if (view !== 'mine') return
    useMyWorkStore.getState().markSeen(true)
    return () => useMyWorkStore.getState().markSeen(false)
  }, [view, activeOrg])

  // Background refresh every 2 minutes while the window is focused.
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hasFocus() || useUiStore.getState().sheet) return
      refreshInBackground()
    }, 120000)
    window.addEventListener('focus', refreshOnFocus)
    return () => { clearInterval(id); window.removeEventListener('focus', refreshOnFocus) }
  }, [])

  // A click on empty space (not a card, row, control or editor) drops the selection and closes the details panel.
  const onBlankClick = (e: React.MouseEvent) => {
    const t = e.target as Element
    if (t.closest('.card, tr, button, input, textarea, select, a, [contenteditable], [role="menu"], [role="listbox"], [role="dialog"]')) return
    const b = useBoardStore.getState()
    if (b.selectedId !== null || b.selectedIds.size) b.clearSelection()
    if (useUiStore.getState().inspectorOpen) useUiStore.getState().toggleInspector(false)
  }

  const dropOverlay = dropHint && <div className="drop-hint"><div><ImagePlus size={28} /><b>Drop to report a bug</b><span>The image goes into a new Bug's Symptom.</span></div></div>

  if (mini) {
    return (
      <div className={`shell-mini ${density}`}>
        <ErrorBoundary where="Mini mode" inline><MiniView /></ErrorBoundary>
        {sheet === 'new-item' && <NewItemSheet />}
        {dropOverlay}
      </div>
    )
  }

  return (
    <div className={`shell ${sidebarOpen ? '' : 'no-sidebar'} ${density} ${pending ? 'pending' : ''}`}>
      <div className={`busy-bar ${pending ? 'on' : ''}`} role="progressbar" aria-hidden={!pending} aria-label="Sending to Azure DevOps" />
      <Sidebar />
      <div className="main">
        <Toolbar />
        <div className="main-body">
          <div className="content" onClick={onBlankClick}>
            <ErrorBoundary key={view} where={VIEW_NAMES[view]} inline>
            {view === 'versioning' ? <VersioningView /> : view === 'imports' ? <ImportsView /> : view === 'team' ? <TeamView /> : view === 'reqs' ? <RequirementsView /> : view === 'tests' ? <TestCasesView /> : view === 'plans' ? <PlansView /> : view === 'rooms' ? <MeetingRoomView /> : view === 'prs' ? <PrView /> : view === 'timesheet' ? <TimesheetView /> : view === 'mine' ? <MyWorkView /> : view === 'list' ? <ListView /> : <BoardView />}
            </ErrorBoundary>
          </div>
          {inspectorOpen && view !== 'timesheet' && view !== 'rooms' && view !== 'imports' && <Inspector floating={view !== 'board'} />}
        </div>
      </div>
      <StatusBar />
      {sheet === 'new-item' && <NewItemSheet />}
      {sheet === 'import' && <ImportSheet />}
      {sheet === 'settings' && <SettingsSheet />}
      {sheet === 'shortcuts' && <ShortcutsSheet />}
      {sheet === 'connect' && <ConnectScreen asSheet />}
      {sheet === 'new-pr' && <NewPrSheet />}
      {sheet === 'complete-pr' && <CompletePrSheet />}
      {sheet === 'start-work' && <StartWorkSheet />}
      {sheet === 'whats-new' && <WhatsNewSheet />}
      <GitToolsPanel />
      {paletteOpen && <CommandPalette onCommand={runCommand} />}
      {dropOverlay}
    </div>
  )
}
