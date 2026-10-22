import { isTauri } from './api'
import { useUiStore } from '@/store/useUiStore'

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
      action: { label: 'Update and restart', onClick: () => void install(update) },
    })
  } catch (e) {
    if (manual) ui.toast({ kind: 'error', title: 'Could not check for updates', detail: String((e as { message?: string }).message ?? e) })
  } finally {
    checking = false
  }
}

async function install(update: import('@tauri-apps/plugin-updater').Update) {
  const ui = useUiStore.getState()
  ui.toast({ kind: 'info', title: `Downloading Boards ${update.version}…` })
  try {
    await update.downloadAndInstall()
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (e) {
    ui.toast({ kind: 'error', title: 'The update did not install', detail: String((e as { message?: string }).message ?? e) })
  }
}

/** Check shortly after launch, then every few hours while the app stays open. Returns a stop function. */
export function startUpdateChecks(): () => void {
  if (!isTauri) return () => {}
  const first = setTimeout(() => void checkForUpdates(), 10_000)
  const again = setInterval(() => void checkForUpdates(), EVERY)
  return () => { clearTimeout(first); clearInterval(again) }
}
