import { api } from './api'
import { parseHtml } from './format'

const cache = new Map<string, Promise<string>>()

/** Only Azure DevOps hosts get the user's token; anything else (e.g. "https://evil.com?.visualstudio.com/") is left alone. */
export function isAdoAttachment(src: string): boolean {
  let url: URL
  try { url = new URL(src) } catch { return false }
  const host = url.hostname.toLowerCase()
  return url.protocol === 'https:' && (host === 'dev.azure.com' || host.endsWith('.visualstudio.com'))
}

/** Replace Azure DevOps attachment images (which need the user's token) with inline data URLs. */
export function hydrateImages(root: HTMLElement, org: string): void {
  for (const img of Array.from(root.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    if (!isAdoAttachment(src)) continue
    img.classList.add('loading')
    let p = cache.get(src)
    if (!p) {
      p = api().fetchAttachment(org, src)
      cache.set(src, p)
    }
    p.then((dataUrl) => {
      img.setAttribute('src', dataUrl)
      img.setAttribute('data-original-src', src)
      img.classList.remove('loading')
    }).catch(() => {
      img.classList.remove('loading')
      img.alt = 'Image could not be loaded'
    })
  }
}

/** Put original attachment URLs back before saving so Azure DevOps keeps its own links. */
export function restoreImageSources(html: string): string {
  const div = parseHtml(html).body
  for (const img of Array.from(div.querySelectorAll('img[data-original-src]'))) {
    img.setAttribute('src', img.getAttribute('data-original-src') ?? '')
    img.removeAttribute('data-original-src')
    img.classList.remove('loading')
    if (!img.getAttribute('class')) img.removeAttribute('class')
  }
  return div.innerHTML
}

const readAsDataUrl = (file: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result))
  r.onerror = () => reject(r.error ?? new Error('Could not read the file'))
  r.readAsDataURL(file)
})

/** Image files from a paste or drop, if any. */
export function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return []
  return Array.from(data.files ?? []).filter((f) => f.type.startsWith('image/'))
}

/**
 * Upload an image as a work item attachment and return the HTML to insert. The image shows from
 * the local copy; `data-original-src` holds the Azure DevOps URL that `restoreImageSources` saves.
 */
export async function uploadImageHtml(org: string, project: string, file: File): Promise<string> {
  const dataUrl = await readAsDataUrl(file)
  const ext = (file.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
  const name = file.name && file.name !== 'image.png' ? file.name : `screenshot-${Date.now()}.${ext}`
  const { url } = await api().uploadAttachment(org, project, name, dataUrl.slice(dataUrl.indexOf(',') + 1))
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;')
  return `<img src="${esc(dataUrl)}" data-original-src="${esc(url)}" alt="${esc(name)}" style="max-width:100%">`
}

/** Insert HTML at the caret if it is inside `el`, otherwise at the end of `el`. */
export function insertHtmlAt(el: HTMLElement, html: string): void {
  el.focus()
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !el.contains(sel.getRangeAt(0).startContainer)) {
    const r = document.createRange()
    r.selectNodeContents(el)
    r.collapse(false)
    sel?.removeAllRanges()
    sel?.addRange(r)
  }
  document.execCommand('insertHTML', false, html)
}
