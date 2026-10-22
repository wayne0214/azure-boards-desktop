import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  children: ReactNode
  align?: 'left' | 'right'
  width?: number
  className?: string
}

/** Anchored floating panel. Closes on outside click or Escape. */
export function Popover({ anchor, open, onClose, children, align = 'left', width, className }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; maxHeight: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor) return
    const place = () => {
      const r = anchor.getBoundingClientRect()
      const el = ref.current
      const w = width ?? el?.offsetWidth ?? 220
      const h = el?.offsetHeight ?? 300
      const vw = window.innerWidth
      const vh = window.innerHeight
      let left = align === 'right' ? r.right - w : r.left
      left = Math.max(8, Math.min(left, vw - w - 8))
      let top = r.bottom + 4
      let maxHeight = vh - top - 12
      if (h > maxHeight && r.top > vh - r.bottom) {
        top = Math.max(8, r.top - 4 - h)
        maxHeight = r.top - 12
      }
      setPos({ top, left, maxHeight })
    }
    place()
    const id = requestAnimationFrame(place)
    window.addEventListener('resize', place)
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('resize', place)
    }
  }, [open, anchor, align, width])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchor?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, anchor, onClose])

  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      className={`popover ${className ?? ''}`}
      style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999, maxHeight: pos?.maxHeight, width, visibility: pos ? 'visible' : 'hidden' }}
      role="menu"
    >
      {children}
    </div>,
    document.body,
  )
}
