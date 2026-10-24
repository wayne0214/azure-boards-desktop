import { Bell, Bot, CalendarClock, DoorOpen, HardDrive, KanbanSquare, Palette, Plus, Terminal, Trash2, Users } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { api, isTauri } from '@/lib/api'
import { Avatar } from '@/components/ui/Avatar'
import { Sheet } from '@/components/ui/Sheet'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { useTimesheetStore } from '@/store/useTimesheetStore'
import { useRoomStore } from '@/store/useRoomStore'
import { getGitToolsBin, setGitToolsBin } from '@/lib/pr/gitTools'
import { confirmAsync } from '@/lib/confirm'
import { useNotifyStore } from '@/store/useNotifyStore'
import { sendTestNotification } from '@/lib/notify/poller'
import type { NoteKind } from '@/lib/notify/watch'
import { mcpStatus } from '@/lib/mcp'
import { McpSettings } from './McpSettings'
import { SettingsGroup, SettingsRow, Switch } from './SettingsParts'

const NOTE_KINDS: { kind: NoteKind; label: string }[] = [
  { kind: 'review', label: 'A pull request needs my review' },
  { kind: 'assigned', label: 'A work item is assigned to me' },
  { kind: 'mention', label: 'Someone mentions me' },
  { kind: 'check', label: 'A check fails on my pull request' },
]

const SCALE_OPTIONS = [
  { v: 0.9, l: 'Small' },
  { v: 1, l: 'Default' },
  { v: 1.1, l: 'Large' },
  { v: 1.25, l: 'Larger' },
  { v: 1.4, l: 'Largest' },
]

export type SettingsTab = 'accounts' | 'appearance' | 'notifications' | 'board' | 'timesheet' | 'rooms' | 'ai' | 'dev' | 'storage'

const TABS: { id: SettingsTab; label: string; icon: ReactNode; sub: string }[] = [
  { id: 'accounts', label: 'Organizations', icon: <Users size={16} />, sub: 'Azure DevOps organizations you are signed in to.' },
  { id: 'appearance', label: 'Appearance', icon: <Palette size={16} />, sub: 'Theme, text size and how dense the board looks.' },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={16} />, sub: 'What Boards tells you about while it is open.' },
  { id: 'board', label: 'Board', icon: <KanbanSquare size={16} />, sub: 'How the board shows work.' },
  { id: 'timesheet', label: 'Timesheet', icon: <CalendarClock size={16} />, sub: 'Where your hours are logged.' },
  { id: 'rooms', label: 'Meeting rooms', icon: <DoorOpen size={16} />, sub: 'The Teamup calendar used for room bookings.' },
  { id: 'ai', label: 'AI tools', icon: <Bot size={16} />, sub: 'Let Claude Code and Codex read and update your work items.' },
  { id: 'dev', label: 'Developer tools', icon: <Terminal size={16} />, sub: 'Local programs used for pull requests.' },
  { id: 'storage', label: 'Storage', icon: <HardDrive size={16} />, sub: 'Data Boards keeps on this computer.' },
]

const TAB_KEY = 'settings.tab'
const readTab = (): SettingsTab => {
  try {
    const t = localStorage.getItem(TAB_KEY) as SettingsTab | null
    return TABS.some((x) => x.id === t) ? (t as SettingsTab) : 'accounts'
  } catch {
    return 'accounts'
  }
}

export function SettingsSheet() {
  const closeSheet = useUiStore((s) => s.closeSheet)
  // Another view may open a specific page: openSheet('settings', { tab: 'timesheet' }).
  const asked = useUiStore((s) => s.sheetPayload?.tab) as SettingsTab | undefined
  const [tab, setTabState] = useState<SettingsTab>(() => (asked && TABS.some((t) => t.id === asked) ? asked : readTab()))
  const [aiOn, setAiOn] = useState(false)

  useEffect(() => {
    if (isTauri) void mcpStatus().then((s) => setAiOn(s.enabled && s.running)).catch(() => undefined)
  }, [])

  const setTab = (t: SettingsTab) => {
    setTabState(t)
    try { localStorage.setItem(TAB_KEY, t) } catch { /* remembered for this visit only */ }
  }
  const visible = TABS.filter((t) => t.id !== 'ai' || isTauri)
  const current = visible.find((t) => t.id === tab) ?? visible[0]

  return (
    <Sheet title="Settings" onClose={closeSheet} size="settings">
      <div className="settings-layout">
        <nav className="set-nav" aria-label="Settings sections">
          {visible.map((t) => (
            <button key={t.id} type="button" className={`nav-item ${t.id === current.id ? 'active' : ''}`} aria-current={t.id === current.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              <span className="ico">{t.icon}</span>
              <span className="label">{t.label}</span>
              {t.id === 'ai' && aiOn && <span className="dot" title="On" />}
            </button>
          ))}
        </nav>
        <div className="set-pane" key={current.id}>
          <h2 className="set-pane-h">{current.label}</h2>
          <p className="set-pane-sub">{current.sub}</p>
          {current.id === 'accounts' && <AccountsPane />}
          {current.id === 'appearance' && <AppearancePane />}
          {current.id === 'notifications' && <NotificationsPane />}
          {current.id === 'board' && <BoardPane />}
          {current.id === 'timesheet' && <TimesheetPane />}
          {current.id === 'rooms' && <RoomsPane />}
          {current.id === 'ai' && <McpSettings onStatus={(s) => setAiOn(s.enabled && s.running)} />}
          {current.id === 'dev' && <DevPane />}
          {current.id === 'storage' && <StoragePane />}
        </div>
      </div>
    </Sheet>
  )
}

function AccountsPane() {
  const closeSheet = useUiStore((s) => s.closeSheet)
  const openSheet = useUiStore((s) => s.openSheet)
  const toast = useUiStore((s) => s.toast)
  const settings = useAppStore((s) => s.settings)
  const activeOrg = useAppStore((s) => s.activeOrg)
  const applySettings = useAppStore((s) => s.applySettings)
  const switchOrg = useAppStore((s) => s.switchOrg)

  const remove = async (org: string) => {
    if (!(await confirmAsync(`Sign out of ${org}? The saved token will be removed from this computer.`, { okLabel: 'Sign out', danger: true }))) return
    const s = await api().removeAccount(org)
    applySettings(s)
    if (s.activeOrg && s.activeOrg !== activeOrg) await switchOrg(s.activeOrg)
    toast({ kind: 'info', title: `Signed out of ${org}` })
  }

  return (
    <SettingsGroup footer="Each organization's token is kept in the system keychain.">
      {settings.accounts.map((a) => (
        <div key={a.org} className="set-row account">
          <Avatar name={a.userName} keyName={a.userId} />
          <div className="set-lbl">
            <div className="set-name">{a.org}{a.org === activeOrg && <span className="set-badge">Current</span>}</div>
            <div className="set-hint">{a.userName}</div>
          </div>
          <div className="set-ctl">
            {a.org !== activeOrg && <button type="button" className="btn sm" onClick={() => { void switchOrg(a.org); closeSheet() }}>Switch</button>}
            <button type="button" className="icon-btn" title="Sign out" onClick={() => void remove(a.org)}><Trash2 size={15} /></button>
          </div>
        </div>
      ))}
      <div className="set-row">
        <button type="button" className="btn sm" onClick={() => openSheet('connect')}><Plus size={14} /> Add organization</button>
      </div>
    </SettingsGroup>
  )
}

function AppearancePane() {
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const textScale = useUiStore((s) => s.textScale)
  const setTextScale = useUiStore((s) => s.setTextScale)
  const density = useUiStore((s) => s.density)
  const setDensity = useUiStore((s) => s.setDensity)
  return (
    <SettingsGroup>
      <SettingsRow label="Theme" hint="System follows your computer's light or dark mode.">
        <div className="segmented">
          {(['system', 'light', 'dark'] as const).map((t) => <button key={t} type="button" className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
      </SettingsRow>
      <SettingsRow label="Text size" stack>
        <div className="segmented">
          {SCALE_OPTIONS.map((o) => <button key={o.v} type="button" className={Math.abs(textScale - o.v) < 0.03 ? 'on' : ''} onClick={() => setTextScale(o.v)}>{o.l}</button>)}
        </div>
      </SettingsRow>
      <SettingsRow label="Card density" hint="Compact fits more cards on screen.">
        <div className="segmented">
          <button type="button" className={density === 'comfortable' ? 'on' : ''} onClick={() => setDensity('comfortable')}>Comfortable</button>
          <button type="button" className={density === 'compact' ? 'on' : ''} onClick={() => setDensity('compact')}>Compact</button>
        </div>
      </SettingsRow>
    </SettingsGroup>
  )
}

function NotificationsPane() {
  const prefs = useNotifyStore((s) => s.prefs)
  const setPref = useNotifyStore((s) => s.setPref)
  const [testing, setTesting] = useState(false)
  return (
    <>
      <SettingsGroup title="Tell me when" footer="Checked every few minutes while Boards is open.">
        {NOTE_KINDS.map((k) => (
          <SettingsRow key={k.kind} label={k.label}>
            <Switch checked={prefs[k.kind]} label={k.label} onChange={(v) => setPref(k.kind, v)} />
          </SettingsRow>
        ))}
      </SettingsGroup>
      <SettingsGroup>
        <SettingsRow label="Try it" hint="Shows a sample notification and checks for anything new now.">
          <button type="button" className="btn sm" disabled={testing} onClick={() => { setTesting(true); void sendTestNotification().finally(() => setTesting(false)) }}>{testing ? 'Sending…' : 'Send test notification'}</button>
        </SettingsRow>
      </SettingsGroup>
    </>
  )
}

function BoardPane() {
  const doneDays = useUiStore((s) => s.doneDays)
  const setDoneDays = useUiStore((s) => s.setDoneDays)
  return (
    <SettingsGroup>
      <SettingsRow label="Show finished items from the last" hint="Keeps the Done column short.">
        <select className="input" style={{ width: 120 }} value={doneDays} onChange={(e) => setDoneDays(Number(e.target.value))}>
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </SettingsRow>
    </SettingsGroup>
  )
}

function TimesheetPane() {
  const tsUrl = useTimesheetStore((s) => s.baseUrl)
  const setTsUrl = useTimesheetStore((s) => s.setBaseUrl)
  return (
    <SettingsGroup>
      <SettingsRow label="TimeSheet address" hint="Opened in a hidden window; you sign in there once." stack>
        <input className="input" value={tsUrl} onChange={(e) => setTsUrl(e.target.value)} placeholder="https://timesheet.example.com" spellCheck={false} />
      </SettingsRow>
    </SettingsGroup>
  )
}

function RoomsPane() {
  const roomWho = useRoomStore((s) => s.whoOverride)
  const setRoomWho = useRoomStore((s) => s.setWhoOverride)
  const setRoomCalendar = useRoomStore((s) => s.setCalendar)
  // What was typed; the store keeps only the key taken from it.
  const [roomCalendar, setRoomCalendarText] = useState(() => useRoomStore.getState().calendar)
  return (
    <SettingsGroup>
      <SettingsRow label="Teamup calendar" hint="The rooms calendar's link, or just its key." stack>
        <input className="input" value={roomCalendar} onChange={(e) => { setRoomCalendarText(e.target.value); setRoomCalendar(e.target.value) }} placeholder="https://teamup.com/ks…" spellCheck={false} />
      </SettingsRow>
      <SettingsRow label="Name on bookings" hint="Filled into “Who”. Empty uses your Azure DevOps name." stack>
        <input className="input" value={roomWho} onChange={(e) => setRoomWho(e.target.value)} placeholder={useAppStore.getState().account()?.userName ?? ''} />
      </SettingsRow>
    </SettingsGroup>
  )
}

function DevPane() {
  const toast = useUiStore((s) => s.toast)
  const [gtBin, setGtBin] = useState(getGitToolsBin())
  return (
    <SettingsGroup title="git-tools">
      <SettingsRow label="Command" hint="Used by “Generate” in pull requests. Each repository asks for its local folder the first time.">
        <input className="input" style={{ width: 200 }} value={gtBin} onChange={(e) => { setGtBin(e.target.value); setGitToolsBin(e.target.value.trim() || 'git-tools') }} spellCheck={false} />
      </SettingsRow>
      <SettingsRow label="Forget repository folders" hint="Ask again where each repository is checked out.">
        <button type="button" className="btn sm" onClick={() => {
          try { Object.keys(localStorage).filter((k) => k.startsWith('gt.repo.')).forEach((k) => localStorage.removeItem(k)) } catch { /* storage unavailable: nothing saved to forget */ }
          toast({ kind: 'success', title: 'Folders forgotten' })
        }}>Forget</button>
      </SettingsRow>
    </SettingsGroup>
  )
}

function StoragePane() {
  const toast = useUiStore((s) => s.toast)
  return (
    <SettingsGroup>
      <SettingsRow label="Local cache" hint="Boards open instantly from a saved copy, then refresh. Clearing it is safe.">
        <button type="button" className="btn sm" onClick={() => void api().cacheClear().then(() => toast({ kind: 'success', title: 'Cache cleared' }))}>Clear</button>
      </SettingsRow>
    </SettingsGroup>
  )
}
