/** Changed files of a pull request as folders, the way GitHub lists them. */

export type FileNode<T> =
  | { kind: 'dir'; name: string; path: string; children: FileNode<T>[] }
  | { kind: 'file'; name: string; path: string; value: T }

type Dir<T> = { dirs: Map<string, Dir<T>>; files: { name: string; path: string; value: T }[] }

/**
 * Folders first, then files, each by name. A folder whose only child is another folder is shown as one
 * row ("src-tauri/src/ado"), so deep paths do not push the file names out of view.
 */
export function buildFileTree<T>(entries: { path: string; value: T }[]): FileNode<T>[] {
  const root: Dir<T> = { dirs: new Map(), files: [] }
  for (const e of entries) {
    const parts = e.path.replace(/^\/+/, '').split('/')
    const name = parts.pop() ?? e.path
    let dir = root
    for (const p of parts) {
      if (!dir.dirs.has(p)) dir.dirs.set(p, { dirs: new Map(), files: [] })
      dir = dir.dirs.get(p)!
    }
    dir.files.push({ name, path: e.path, value: e.value })
  }
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
  const nodes = (dir: Dir<T>, prefix: string): FileNode<T>[] => {
    const dirs = [...dir.dirs.entries()].map(([name, d]): FileNode<T> => {
      let label = name
      let cur = d
      while (cur.files.length === 0 && cur.dirs.size === 1) {
        const [next, sub] = [...cur.dirs.entries()][0]
        label += `/${next}`
        cur = sub
      }
      const path = `${prefix}/${label}`
      return { kind: 'dir', name: label, path, children: nodes(cur, path) }
    })
    const files = dir.files.map((f): FileNode<T> => ({ kind: 'file', ...f }))
    return [...dirs.sort(byName), ...files.sort(byName)]
  }
  return nodes(root, '')
}

/** File paths in the order the tree shows them, for moving to the next or previous file. */
export function fileOrder<T>(tree: FileNode<T>[]): string[] {
  return tree.flatMap((n) => (n.kind === 'file' ? [n.path] : fileOrder(n.children)))
}

/** The folders a file sits in, so moving to it can open them. */
export function foldersOf<T>(tree: FileNode<T>[], path: string): string[] {
  for (const n of tree) {
    if (n.kind === 'file') { if (n.path === path) return []; continue }
    const inner = foldersOf(n.children, path)
    if (inner.length || n.children.some((c) => c.kind === 'file' && c.path === path)) return [n.path, ...inner]
  }
  return []
}
