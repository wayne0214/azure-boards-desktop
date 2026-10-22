/** SDV test case IDs: `SDV-` + running number, next = highest existing + 1. */
export const SDV_PATTERN = /^SDV-(\d+)$/i

export function nextSdvId(existing: string[]): string {
  const max = existing.reduce((m, id) => {
    const n = SDV_PATTERN.exec(id.trim())
    return n ? Math.max(m, Number(n[1])) : m
  }, 0)
  return `SDV-${String(max + 1).padStart(4, '0')}`
}

export const duplicateSdv = (existing: string[], id: string): boolean =>
  existing.some(e => e.trim().toUpperCase() === id.trim().toUpperCase())

/** The test case already using `id`, and the next free id to offer instead; null when it is free. */
export function sdvClash(others: { id: number; sdv: string }[], id: string): { id: number; next: string } | null {
  if (!id.trim()) return null
  const hit = others.find((o) => duplicateSdv([o.sdv], id))
  return hit ? { id: hit.id, next: nextSdvId(others.map((o) => o.sdv)) } : null
}

/**
 * After creating test case `id`: if an earlier-created test case (lower id) holds the same SDV ID,
 * the next free one to move to; otherwise null.
 */
export function sdvAfterCreate(all: { id: number; sdv: string }[], id: number): string | null {
  const mine = all.find((x) => x.id === id)
  if (!mine?.sdv.trim()) return null
  const taken = all.some((x) => x.id < id && duplicateSdv([x.sdv], mine.sdv))
  return taken ? nextSdvId(all.map((x) => x.sdv)) : null
}
