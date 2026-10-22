import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'

/**
 * Renders only the rows near the visible part of a scrolling list. Rows may differ in height: each one is
 * measured once drawn, and rows not drawn yet count as `estimate` pixels. Below `threshold` rows every row is drawn.
 */
export function useVirtualRows({ count, scrollRef, estimate = 36, overscan = 12, threshold = 150 }: {
  count: number
  scrollRef: RefObject<HTMLElement | null>
  estimate?: number
  overscan?: number
  threshold?: number
}) {
  const heights = useRef<number[]>([])
  const [view, setView] = useState({ top: 0, height: 800 })
  const [, remeasured] = useState(0)
  const on = count > threshold

  useEffect(() => {
    const el = scrollRef.current
    if (!el || !on) return
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight })
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', update); ro.disconnect() }
  }, [scrollRef, on])

  useLayoutEffect(() => { heights.current.length = count }, [count])

  const measure = useCallback((index: number) => (el: HTMLElement | null) => {
    if (!el) return
    const h = el.getBoundingClientRect().height
    if (h > 0 && Math.abs((heights.current[index] ?? estimate) - h) > 1) {
      heights.current[index] = h
      remeasured((n) => n + 1)
    }
  }, [estimate])

  if (!on) return { on, start: 0, end: count, padTop: 0, padBottom: 0, measure }

  const h = (i: number) => heights.current[i] ?? estimate
  let start = 0
  let y = 0
  while (start < count && y + h(start) < view.top) { y += h(start); start++ }
  let end = start
  let seen = 0
  while (end < count && seen < view.height) { seen += h(end); end++ }
  const from = Math.max(0, start - overscan)
  const to = Math.min(count, end + overscan)
  let padTop = 0
  for (let i = 0; i < from; i++) padTop += h(i)
  let padBottom = 0
  for (let i = to; i < count; i++) padBottom += h(i)
  return { on, start: from, end: to, padTop, padBottom, measure }
}
