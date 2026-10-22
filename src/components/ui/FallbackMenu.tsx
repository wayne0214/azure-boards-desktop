import type { ContextMenuItem } from '@/lib/api'

/** Browser-only context menu used in demo mode. In the desktop app the native menu is used. */
export function showFallbackContextMenu(items: ContextMenuItem[], at?: { x: number; y: number }) {
  const x = at?.x ?? lastPointer.x
  const y = at?.y ?? lastPointer.y
  const host = document.createElement('div')
  host.className = 'popover fallback-menu'
  host.style.left = `${Math.min(x, window.innerWidth - 240)}px`
  host.style.top = `${Math.min(y, window.innerHeight - 300)}px`
  const close = () => {
    host.remove()
    document.removeEventListener('mousedown', onDown, true)
    document.removeEventListener('keydown', onKey, true)
  }
  const onDown = (e: MouseEvent) => {
    if (!host.contains(e.target as Node)) close()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close()
  }
  const render = (list: ContextMenuItem[], into: HTMLElement) => {
    for (const it of list) {
      if (it.separator) {
        const s = document.createElement('div')
        s.className = 'pop-sep'
        into.appendChild(s)
        continue
      }
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'pop-item'
      b.textContent = it.label ?? ''
      if (it.enabled === false) b.disabled = true
      if (it.submenu) {
        b.textContent = `${it.label} ›`
        const sub = document.createElement('div')
        sub.style.paddingLeft = '14px'
        render(it.submenu, sub)
        into.appendChild(b)
        into.appendChild(sub)
        continue
      }
      b.onclick = () => {
        close()
        it.action?.()
      }
      into.appendChild(b)
    }
  }
  render(items, host)
  document.body.appendChild(host)
  setTimeout(() => {
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
  }, 0)
}

const lastPointer = { x: 0, y: 0 }
if (typeof window !== 'undefined') {
  window.addEventListener('contextmenu', (e) => { lastPointer.x = e.clientX; lastPointer.y = e.clientY }, true)
  window.addEventListener('mousedown', (e) => { lastPointer.x = e.clientX; lastPointer.y = e.clientY }, true)
}
