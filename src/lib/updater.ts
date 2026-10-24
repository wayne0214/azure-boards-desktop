import { isTauri } from './api'
import { create } from 'zustand'
import { useUiStore } from '@/store/useUiStore'
import { RELEASE_NOTES } from './releaseNotes'

/** What the sidebar offers: the updater's `Update`, or the demo's stand-in. */
type Update = Pick<import('@tauri-apps/plugin-updater').Update, 'version' | 'body' | 'downloadAndInstall'>

/** The web demo always offers the newest release, so the update button and What's New can be tried there. */
const demoUpdate: Update | null = isTauri || !RELEASE_NOTES[0] ? null : { version: RELEASE_NOTES[0].version, body: undefined, downloadAndInstall: async () => {} }

/** The release found by the last check, so the sidebar can offer it after its toast is gone. */
export const useUpdateStore = create<{ available: Update | null }>(() => ({ available: demoUpdate }))

const EVERY = 6 * 60 * 60 * 1000
let checking = false
// One offer per version per session; the periodic check does not nag about a version already offered.
let offered: string | null = null

/** Look for a newer release. A manual check reports every outcome; the automatic ones only speak up when there is an update. */
export async function checkForUpdates(manual = false): Promise<void> {
  const ui = useUiStore.getState()
  if (!isTauri) {
    if (manual) ui.toast({ kind: 'info', title: 'Updates are only available in the desktop app' })
    return
  }
  if (checking) return
  checking = true
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    if (!(await invoke<boolean>('updater_configured'))) {
      if (manual) ui.toast({ kind: 'info', title: 'This build does not update itself', detail: 'Install a release build to get automatic updates.' })
      return
    }
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    useUpdateStore.setState({ available: update })
    if (!update) {
      if (manual) ui.toast({ kind: 'success', title: 'Boards is up to date' })
      return
    }
    if (!manual && offered === update.version) return
    offered = update.version
    ui.toast({
      kind: 'info',
      title: `Boards ${update.version} is available`,
      detail: update.body?.trim() ? update.body.trim().split('\n')[0] : 'Restart to update.',
      sticky: true,
      action: { label: 'Update and restart', onClick: () => void installUpdate(update) },
    })
  } catch (e) {
    if (manual) ui.toast({ kind: 'error', title: 'Could not check for updates', detail: String((e as { message?: string }).message ?? e) })
  } finally {
    checking = false
  }
}

let installing = false

export async function installUpdate(update: Update) {
  if (installing) return
  installing = true
  const ui = useUiStore.getState()
  if (!isTauri) {
    // Demo: what the desktop app shows once it has restarted on the new version.
    ui.openSheet('whats-new', { version: update.version })
    installing = false
    return
  }
  ui.toast({ kind: 'info', title: `Downloading Boards ${update.version}…` })
  try {
    await update.downloadAndInstall()
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (e) {
    ui.toast({ kind: 'error', title: 'The update did not install', detail: String((e as { message?: string }).message ?? e) })
  } finally {
    installing = false
  }
}

/** Check shortly after launch, then every few hours while the app stays open. Returns a stop function. */
export function startUpdateChecks(): () => void {
  if (!isTauri) return () => {}
  const first = setTimeout(() => void checkForUpdates(), 10_000)
  const again = setInterval(() => void checkForUpdates(), EVERY)
  return () => { clearTimeout(first); clearInterval(again) }
}
