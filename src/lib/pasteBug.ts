import { imageFiles } from './attachments'

const LAST_PROJECT = 'bug.miniProject'

/**
 * The project a screenshot bug starts in from mini mode: the one the last such bug went to, while it is
 * still in the list, else the one open in the full window, else the first.
 */
export function miniBugProject<P extends { id: string }>(projects: P[], open: P | null): P | null {
  let last: string | null = null
  try { last = localStorage.getItem(LAST_PROJECT) } catch { /* ignore */ }
  return projects.find((p) => p.id === last) ?? open ?? projects[0] ?? null
}

export function rememberMiniBugProject(id: string): void {
  try { localStorage.setItem(LAST_PROJECT, id) } catch { /* ignore */ }
}

/** Fields that take a pasted or dropped image themselves: rich text, the run screenshot area, plain inputs. */
export const takesImages = (t: EventTarget | null) => t instanceof Element && !!t.closest('[contenteditable="true"], .tc-drop, input, textarea')

/**
 * Pasting a screenshot outside a field that takes images calls `open` with it.
 * WebKit only enables Paste outside an editable field when a beforepaste handler asks for it.
 */
export function listenForPastedImages(open: (files: File[]) => void, canOpen: () => boolean, target: Document = document): () => void {
  const onBeforePaste = (e: Event) => { if (!takesImages(e.target) && canOpen()) e.preventDefault() }
  const onPaste = (e: Event) => {
    if (takesImages(e.target) || !canOpen()) return
    const files = imageFiles((e as ClipboardEvent).clipboardData)
    if (files.length === 0) return
    e.preventDefault()
    open(files)
  }
  target.addEventListener('beforepaste', onBeforePaste)
  target.addEventListener('paste', onPaste)
  return () => {
    target.removeEventListener('beforepaste', onBeforePaste)
    target.removeEventListener('paste', onPaste)
  }
}
