import { Plus, Trash2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Avatar } from '@/components/ui/Avatar'
import { Sheet } from '@/components/ui/Sheet'
import { useAppStore } from '@/store/useAppStore'
import { useUiStore } from '@/store/useUiStore'
import { useTimesheetStore } from '@/store/useTimesheetStore'
import { useRoomStore } from '@/store/useRoomStore'
import { getGitToolsBin, setGitToolsBin } from '@/lib/pr/gitTools'
import { useState } from 'react'
import { confirmAsync } from '@/lib/confirm'
import { useNotifyStore } from '@/store/useNotifyStore'
import { sendTestNotification } from '@/lib/notify/poller'
import type { NoteKind } from '@/lib/notify/watch'

const NOTE_KINDS: { kind: NoteKind; label: string }[] = [
  { kind: 'review', label: 'A pull request needs my review' },
  { kind: 'assigned', label: 'A work item is assigned to me' },
  { kind: 'mention', label: 'Someone mentions me' },
  { kind: 'check', label: 'A check fails on my pull request' },
]

export function SettingsSheet() {
  const closeSheet = useUiStore((s) => s.closeSheet)
  const openSheet = useUiStore((s) => s.openSheet)
  const theme = useUiStore((s) => s.theme)
  const setTheme = useUiStore((s) => s.setTheme)
  const textScale = useUiStore((s) => s.textScale)
  const setTextScale = useUiStore((s) => s.setTextScale)
  const density = useUiStore((s) => s.density)
  const setDensity = useUiStore((s) => s.setDensity)
  const doneDays = useUiStore((s) => s.doneDays)
  const setDoneDays = useUiStore((s) => s.setDoneDays)
  const toast = useUiStore((s) => s.toast)
  const settings = useAppStore((s) => s.settings)
  const activeOrg = useAppStore((s) => s.activeOrg)
  const applySettings = useAppStore((s) => s.applySettings)
  const switchOrg = useAppStore((s) => s.switchOrg)
  const tsUrl = useTimesheetStore((s) => s.baseUrl)
  const setTsUrl = useTimesheetStore((s) => s.setBaseUrl)
  const [gtBin, setGtBin] = useState(getGitToolsBin())
  const roomWho = useRoomStore((s) => s.whoOverride)
  const setRoomWho = useRoomStore((s) => s.setWhoOverride)
  const setRoomCalendar = useRoomStore((s) => s.setCalendar)
  // What was typed; the store keeps only the key taken from it.
  const [roomCalendar, setRoomCalendarText] = useState(() => useRoomStore.getState().calendar)
  const notifyPrefs = useNotifyStore((s) => s.prefs)
  const setNotifyPref = useNotifyStore((s) => s.setPref)
  const [testing, setTesting] = useState(false)

  const remove = async (org: string) => {
    if (!(await confirmAsync(`Sign out of ${org}? The saved token will be removed from this computer.`, { okLabel: 'Sign out', danger: true }))) return
    const s = await api().removeAccount(org)
    applySettings(s)
    if (s.activeOrg && s.activeOrg !== activeOrg) await switchOrg(s.activeOrg)
    toast({ kind: 'info', title: `Signed out of ${org}` })
  }

  const scaleOptions = [
    { v: 0.9, l: 'Small' },
    { v: 1, l: 'Default' },
    { v: 1.1, l: 'Large' },
    { v: 1.25, l: 'Larger' },
    { v: 1.4, l: 'Largest' },
  ]

  return (
    <Sheet title="Settings" onClose={closeSheet} size="narrow">
      <div className="section-h" style={{ marginTop: 4 }}>Organizations</div>
      {settings.accounts.map((a) => (
        <div key={a.org} className="account-row">
          <Avatar name={a.userName} keyName={a.userId} />
          <div className="nm">
            <div>{a.org}{a.org === activeOrg && <span className="faint" style={{ fontSize: 'var(--fs-xs)', marginLeft: 8 }}>current</span>}</div>
            <div className="sub">{a.userName}</div>
          </div>
          {a.org !== activeOrg && <button type="button" className="btn sm" onClick={() => { void switchOrg(a.org); closeSheet() }}>Switch</button>}
          <button type="button" className="icon-btn" title="Sign out" onClick={() => void remove(a.org)}><Trash2 size={15} /></button>
        </div>
      ))}
      <button type="button" className="btn" onClick={() => openSheet('connect')}><Plus size={14} /> Add organization</button>

      <div className="section-h">Appearance</div>
      <div className="settings-row">
        <div className="lbl">Theme</div>
        <div className="segmented">
          {(['system', 'light', 'dark'] as const).map((t) => <button key={t} type="button" className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
        </div>
      </div>
      <div className="settings-row">
        <div className="lbl">Text size</div>
        <div className="segmented">
          {scaleOptions.map((o) => <button key={o.v} type="button" className={Math.abs(textScale - o.v) < 0.03 ? 'on' : ''} onClick={() => setTextScale(o.v)}>{o.l}</button>)}
        </div>
      </div>
      <div className="settings-row">
        <div className="lbl">Card density</div>
        <div className="segmented">
          <button type="button" className={density === 'comfortable' ? 'on' : ''} onClick={() => setDensity('comfortable')}>Comfortable</button>
          <button type="button" className={density === 'compact' ? 'on' : ''} onClick={() => setDensity('compact')}>Compact</button>
        </div>
      </div>

      <div className="section-h">Notifications</div>
      <div className="settings-row">
        <div className="lbl">Tell me when<div className="sub">Checked every few minutes while Boards is open.</div></div>
        <div className="check-list">
          {NOTE_KINDS.map((k) => <label key={k.kind} className="form-inline"><input type="checkbox" checked={notifyPrefs[k.kind]} onChange={(e) => setNotifyPref(k.kind, e.target.checked)} /> {k.label}</label>)}
        </div>
      </div>
      <div className="settings-row">
        <div className="lbl">Try it<div className="sub">Shows a sample notification and checks for anything new now.</div></div>
        <button type="button" className="btn sm" disabled={testing} onClick={() => { setTesting(true); void sendTestNotification().finally(() => setTesting(false)) }}>{testing ? 'Sending…' : 'Send test notification'}</button>
      </div>

      <div className="section-h">Board</div>
      <div className="settings-row">
        <div className="lbl">Show finished items from the last<div className="sub">Keeps the Done column short.</div></div>
        <select className="input" style={{ width: 120 }} value={doneDays} onChange={(e) => setDoneDays(Number(e.target.value))}>
          {[7, 14, 30, 60, 90].map((d) => <option key={d} value={d}>{d} days</option>)}
        </select>
      </div>

      <div className="section-h">Timesheet</div>
      <div className="settings-row">
        <div className="lbl">TimeSheet address<div className="sub">Opened in a hidden window; you sign in there once.</div></div>
        <input className="input" style={{ width: 300 }} value={tsUrl} onChange={(e) => setTsUrl(e.target.value)} placeholder="https://timesheet.example.com" spellCheck={false} />
      </div>

      <div className="section-h">Meeting rooms</div>
      <div className="settings-row">
        <div className="lbl">Teamup calendar<div className="sub">The rooms calendar's link, or just its key.</div></div>
        <input className="input" style={{ width: 300 }} value={roomCalendar} onChange={(e) => { setRoomCalendarText(e.target.value); setRoomCalendar(e.target.value) }} placeholder="https://teamup.com/ks…" spellCheck={false} />
      </div>
      <div className="settings-row">
        <div className="lbl">Name on bookings<div className="sub">Filled into “Who”. Empty uses your Azure DevOps name.</div></div>
        <input className="input" style={{ width: 220 }} value={roomWho} onChange={(e) => setRoomWho(e.target.value)} placeholder={useAppStore.getState().account()?.userName ?? ''} />
      </div>

      <div className="section-h">git-tools</div>
      <div className="settings-row">
        <div className="lbl">Command<div className="sub">Used by “Generate” in pull requests. Each repository asks for its local folder the first time.</div></div>
        <input className="input" style={{ width: 220 }} value={gtBin} onChange={(e) => { setGtBin(e.target.value); setGitToolsBin(e.target.value.trim() || 'git-tools') }} spellCheck={false} />
      </div>
      <div className="settings-row">
        <div className="lbl">Forget repository folders<div className="sub">Ask again where each repository is checked out.</div></div>
        <button type="button" className="btn sm" onClick={() => {
          try { Object.keys(localStorage).filter((k) => k.startsWith('gt.repo.')).forEach((k) => localStorage.removeItem(k)) } catch { /* storage unavailable: nothing saved to forget */ }
          toast({ kind: 'success', title: 'Folders forgotten' })
        }}>Forget</button>
      </div>

      <div className="section-h">Storage</div>
      <div className="settings-row">
        <div className="lbl">Local cache<div className="sub">Boards open instantly from a saved copy, then refresh.</div></div>
        <button type="button" className="btn sm" onClick={() => void api().cacheClear().then(() => toast({ kind: 'success', title: 'Cache cleared' }))}>Clear</button>
      </div>
    </Sheet>
  )
}
