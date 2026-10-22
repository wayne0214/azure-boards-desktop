import { api, isTauri } from '../api'
import type { PullRequest } from '../pr/types'
import { diff, failedChecks, waitingForReview, type Note, type NoteKind, type Signals, type Snapshot } from './watch'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useNotifyStore } from '@/store/useNotifyStore'
import { usePrStore } from '@/store/usePrStore'
import { useUiStore } from '@/store/useUiStore'

const EVERY = 3 * 60 * 1000
// Checks are fetched one pull request at a time; past this many only the newest are watched.
const MAX_OWN_PRS = 10

const snapKey = (org: string) => `notify.seen.${org}`

function readSnapshot(org: string): Snapshot | null {
  try {
    const raw = localStorage.getItem(snapKey(org))
    return raw ? (JSON.parse(raw) as Snapshot) : null
  } catch {
    return null
  }
}

function writeSnapshot(org: string, s: Snapshot) {
  try { localStorage.setItem(snapKey(org), JSON.stringify(s)) } catch { /* ignore */ }
}

type Kinds = Record<NoteKind, boolean>

/** The signals, and which kinds were actually fetched this round (switched on and not failed). */
async function gather(org: string, meId: string): Promise<{ signals: Signals; fetched: Kinds }> {
  const prefs = useNotifyStore.getState().prefs
  const fetched: Kinds = { review: true, assigned: prefs.assigned, mention: prefs.mention, check: prefs.check }
  const get = async <T,>(kind: NoteKind, p: () => Promise<T>, empty: T): Promise<T> => {
    if (!fetched[kind]) return empty
    try { return await p() } catch { fetched[kind] = false; return empty }
  }
  const [reviewing, work, mentions, own] = await Promise.all([
    // Fetched even when review notices are off: the dock badge counts them.
    get('review', () => api().prList(org, '', 'active', { reviewerId: meId }), [] as PullRequest[]),
    get('assigned', () => api().myWork(org), []),
    get('mention', () => api().mentionedItems(org), []),
    get('check', () => api().prList(org, '', 'active', { creatorId: meId, top: MAX_OWN_PRS }), [] as PullRequest[]),
  ])
  const failing = await Promise.all(own.slice(0, MAX_OWN_PRS).map(async (pr) => {
    const projectId = pr.repository.project?.id
    if (!projectId) return { pr, checks: [] }
    const checks = await get('check', () => api().prChecks(org, projectId, pr.repository.id, pr.pullRequestId), { statuses: [], policies: [] })
    return { pr, checks: failedChecks(checks) }
  }))
  return { signals: { reviewing, work, mentions, failing }, fetched }
}

function open(note: Note) {
  const ui = useUiStore.getState()
  if (note.target.type === 'pr') {
    ui.setView('prs')
    void usePrStore.getState().open(note.target.pr)
  } else {
    void useBoardStore.getState().openItem(note.target.id, { project: note.target.project, push: true })
    ui.toggleInspector(true)
  }
}

let permission: boolean | null = null

async function systemNotify(note: Note): Promise<boolean> {
  if (!isTauri) return false
  try {
    const n = await import('@tauri-apps/plugin-notification')
    if (permission === null) permission = (await n.isPermissionGranted()) || (await n.requestPermission()) === 'granted'
    if (!permission) return false
    n.sendNotification({ title: note.title, body: note.body })
    return true
  } catch {
    return false
  }
}

async function deliver(notes: Note[]) {
  const ui = useUiStore.getState()
  const focused = typeof document !== 'undefined' && document.hasFocus()
  for (const note of notes.slice(0, 5)) {
    // In the app the toast can open the item; outside it, the system notification gets attention.
    if (focused || !(await systemNotify(note))) ui.toast({ kind: 'info', title: note.title, detail: note.body, action: { label: 'Open', onClick: () => open(note) } })
  }
  if (notes.length > 5) {
    const more = notes.length - 5
    if (focused || !(await systemNotify({ ...notes[5], title: `${more} more updates`, body: 'Open Boards to see them.' }))) ui.toast({ kind: 'info', title: `${more} more updates` })
  }
}

async function setBadge(count: number) {
  if (!isTauri) return
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    await getCurrentWindow().setBadgeCount(count > 0 ? count : undefined)
  } catch { /* not supported on this platform */ }
}

let running = false

/** One round: fetch, compare with what was seen, announce what is new. */
export async function pollOnce(): Promise<void> {
  const app = useAppStore.getState()
  const org = app.activeOrg
  const me = app.account()
  if (!org || !me || running) return
  running = true
  try {
    const { signals, fetched } = await gather(org, me.userId)
    // The org may have changed while this was out; its snapshot belongs to the old one.
    if (useAppStore.getState().activeOrg !== org) return
    const prev = readSnapshot(org)
    const { notes, next } = diff(prev, signals, me.userId)
    // A kind that was off or failed to load keeps its old baseline (or none), so it never replays a backlog later.
    writeSnapshot(org, {
      reviews: fetched.review ? next.reviews : prev?.reviews,
      assigned: fetched.assigned ? next.assigned : prev?.assigned,
      mentions: fetched.mention ? next.mentions : prev?.mentions,
      failing: fetched.check ? next.failing : prev?.failing,
    })
    if (fetched.review) await setBadge(waitingForReview(signals.reviewing, me.userId).length)
    const prefs = useNotifyStore.getState().prefs
    await deliver(notes.filter((n) => prefs[n.kind] && fetched[n.kind]))
  } finally {
    running = false
  }
}

/** Settings' "Send test notification": a sample system notification, then a check for anything new right away. */
export async function sendTestNotification(): Promise<void> {
  const ui = useUiStore.getState()
  // Ask again: the user may have just allowed notifications in System Settings.
  permission = null
  const sample: Note = { key: 'test', kind: 'review', title: 'Boards notifications are working', body: 'This is how a review request, assignment, mention or failed check will look.', target: { type: 'item', id: 0, project: '' } }
  if (await systemNotify(sample)) {
    // Dev builds are not a bundled app, so the notification plugin sends as Terminal; macOS only shows
    // them when Terminal may notify. Installed builds send as Boards itself.
    // A development build loads the page from the dev server over http; an installed one from tauri://.
    const devNote = location.protocol.startsWith('http') && navigator.userAgent.includes('Mac')
    ui.toast(devNote
      ? { kind: 'info', title: 'Test notification sent as Terminal', detail: 'Development builds notify as Terminal. If nothing appeared, allow notifications for Terminal in System Settings → Notifications. Installed builds notify as Boards.', sticky: true }
      : { kind: 'success', title: 'Test notification sent', detail: 'If nothing appeared, check that Boards may send notifications in System Settings → Notifications and that Focus is off.' })
  } else {
    ui.toast({
      kind: isTauri ? 'error' : 'info',
      title: isTauri ? 'Could not show a system notification' : 'Notifications are working',
      detail: isTauri ? 'Allow notifications for Boards in System Settings → Notifications. In-app notices still work.' : 'System notifications need the desktop app; here they show as notices like this one.',
    })
  }
  await pollOnce()
}

/** Poll in the background while the app is open. Returns a stop function. */
export function startNotifications(): () => void {
  const first = setTimeout(() => void pollOnce(), 15_000)
  const again = setInterval(() => void pollOnce(), EVERY)
  return () => { clearTimeout(first); clearInterval(again) }
}
