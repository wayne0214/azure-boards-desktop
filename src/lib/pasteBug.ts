import { imageFiles } from './attachments'

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
