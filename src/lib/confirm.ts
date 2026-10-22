import { isTauri } from './api'

/**
 * A confirmation that really waits. `window.confirm` is not modal inside the desktop
 * web view, so we use the native dialog there.
 */
export async function confirmAsync(message: string, opts?: { title?: string; okLabel?: string; cancelLabel?: string; danger?: boolean }): Promise<boolean> {
  if (isTauri) {
    const { ask } = await import('@tauri-apps/plugin-dialog')
    return ask(message, { title: opts?.title ?? 'Boards', kind: opts?.danger ? 'warning' : 'info', okLabel: opts?.okLabel ?? 'OK', cancelLabel: opts?.cancelLabel ?? 'Cancel' })
  }
  return window.confirm(message)
}
