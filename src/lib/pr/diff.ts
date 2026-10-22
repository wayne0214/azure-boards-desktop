import { diffLines } from 'diff'

export type LineKind = 'ctx' | 'add' | 'del' | 'gap'

export interface DiffLine {
  kind: LineKind
  left?: number
  right?: number
  text: string
  hidden?: { count: number; index: number }
}

export interface DiffStats {
  added: number
  removed: number
}

/** Unified diff rows for two texts. `all` is the full row list; `collapse` folds unchanged regions. */
export function buildUnified(oldText: string, newText: string): { all: DiffLine[]; stats: DiffStats } {
  const parts = diffLines(oldText, newText)
  const all: DiffLine[] = []
  let l = 1
  let r = 1
  let added = 0
  let removed = 0
  for (const p of parts) {
    const lines = p.value.split('\n')
    if (lines[lines.length - 1] === '') lines.pop()
    for (const text of lines) {
      if (p.added) {
        all.push({ kind: 'add', right: r++, text })
        added++
      } else if (p.removed) {
        all.push({ kind: 'del', left: l++, text })
        removed++
      } else {
        all.push({ kind: 'ctx', left: l++, right: r++, text })
      }
    }
  }
  return { all, stats: { added, removed } }
}

export function collapse(all: DiffLine[], context: number, expanded: Set<number> = new Set(), keepRight: Set<number> = new Set()): DiffLine[] {
  const keep = new Array<boolean>(all.length).fill(false)
  for (let i = 0; i < all.length; i++) {
    const row = all[i]
    if (row.kind !== 'ctx' || (row.right !== undefined && keepRight.has(row.right))) {
      for (let j = Math.max(0, i - context); j <= Math.min(all.length - 1, i + context); j++) keep[j] = true
    }
  }
  const rows: DiffLine[] = []
  let i = 0
  while (i < all.length) {
    if (keep[i] || all[i].kind !== 'ctx') {
      rows.push(all[i])
      i++
      continue
    }
    let j = i
    while (j < all.length && !keep[j] && all[j].kind === 'ctx') j++
    const count = j - i
    if (expanded.has(i) || count <= 2) {
      for (let k = i; k < j; k++) rows.push(all[k])
    } else {
      rows.push({ kind: 'gap', text: '', hidden: { count, index: i } })
    }
    i = j
  }
  return rows
}

export function isProbablyBinary(path: string): boolean {
  return /\.(png|jpe?g|gif|bmp|ico|icns|webp|pdf|zip|gz|7z|jar|exe|dll|so|dylib|woff2?|ttf|otf|mp[34]|mov|avi|heic|psd|ai|sketch|fig|bin|dat|class|pyc)$/i.test(path)
}
