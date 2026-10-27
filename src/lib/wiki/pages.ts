import type { Wiki, WikiPageNode } from './types'

/** The branch a code wiki's pages are read from; none for a project wiki. */
export const wikiVersion = (w: Wiki | null | undefined): string | null => (w?.type === 'codeWiki' ? w.versions?.[0]?.version ?? null : null)

/** The branch its files live on, for reading images: a project wiki's is "wikiMaster". */
export const wikiBranch = (w: Wiki): string => w.versions?.[0]?.version ?? 'wikiMaster'

export const pageTitle = (path: string): string => path.split('/').filter(Boolean).pop() ?? 'Home'

export const parentPath = (path: string): string => {
  const parts = path.split('/').filter(Boolean)
  return parts.length <= 1 ? '/' : `/${parts.slice(0, -1).join('/')}`
}

/** Every page path, parents first, in the wiki's order. */
export function flattenPages(root: WikiPageNode | null): string[] {
  const out: string[] = []
  const walk = (n: WikiPageNode) => {
    if (n.path !== '/') out.push(n.path)
    ;[...(n.subPages ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).forEach(walk)
  }
  if (root) walk(root)
  return out
}

/** Why a page name cannot be used, or null. Azure DevOps rejects "/", "\" and "#", and a leading dot. */
export function pageNameProblem(name: string): string | null {
  const n = name.trim()
  if (!n) return 'Give the page a name.'
  if (/[/\\#]/.test(n) || n.startsWith('.')) return 'A page name cannot contain / \\ or #, or start with a dot.'
  return null
}

/** The pages to show for a filter: those whose title has every word, plus their parents so they can be found. */
export function filterTree(paths: string[], text: string): Set<string> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = new Set<string>()
  for (const p of paths) {
    if (!words.every((w) => pageTitle(p).toLowerCase().includes(w))) continue
    let cur = p
    while (cur !== '/') { shown.add(cur); cur = parentPath(cur) }
  }
  return shown
}

/** Work item numbers written as "#123" in markdown, outside code. */
export function mentionedIds(markdown: string): number[] {
  const text = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '')
  const ids = new Set<number>()
  for (const m of text.matchAll(/(^|[^\w&/#])#(\d{1,7})\b/g)) ids.add(Number(m[2]))
  return [...ids]
}

/** A markdown image for an uploaded attachment; spaces encoded so the link stays one token. */
export const imageMarkdown = (name: string, path: string) => `![${name.replace(/[[\]]/g, '')}](${path.replace(/ /g, '%20')})`

/**
 * The page a link in a page points to, or null for a link that leaves the wiki. Wiki links write
 * spaces as "-" and a real "-" as "%2D"; relative links are from the current page's parent.
 */
export function linkToPath(href: string, current: string): string | null {
  const h = href.trim()
  if (!h || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//') || h.startsWith('#')) return null
  const clean = h.split(/[?#]/)[0].replace(/\.md$/i, '')
  if (clean.includes('/.attachments/') || clean.startsWith('.attachments/')) return null
  const base = clean.startsWith('/') ? [] : parentPath(current).split('/').filter(Boolean)
  for (const seg of clean.split('/').filter(Boolean)) {
    if (seg === '.') continue
    if (seg === '..') base.pop()
    else base.push(safeDecode(seg.replace(/-/g, ' ')))
  }
  return base.length ? `/${base.join('/')}` : null
}

export const safeDecode = (s: string) => { try { return decodeURIComponent(s) } catch { return s } }

/** An .attachments image path from an <img src>, or null for any other image. */
export function attachmentSrc(src: string): string | null {
  const s = src.trim()
  if (/^[a-z]+:/i.test(s)) return null
  const p = s.startsWith('/') ? s : `/${s}`
  return p.startsWith('/.attachments/') ? p : null
}

/** "**Status:** Accepted · **Decided by:** Wayne · **Date:** 2026-10-20": the facts at the top of a decision or feedback page. */
export function pageMeta(markdown: string): { status: string | null; by: string | null; from: string | null; date: string | null } {
  const head = markdown.split('\n').slice(0, 12).join('\n')
  const field = (name: string) => new RegExp(`\\*\\*${name}:?\\*\\*:?\\s*([^·\\n*|]*)`, 'i').exec(head)?.[1]?.trim() || null
  return { status: field('Status'), by: field('Decided by'), from: field('From'), date: field('Date') ?? /\b(\d{4}-\d{2}-\d{2})\b/.exec(head)?.[1] ?? null }
}

/** Pages directly under a page, in the wiki's order. */
export function childPages(root: WikiPageNode | null, parent: string): string[] {
  const find = (n: WikiPageNode): WikiPageNode | null => (n.path === parent ? n : (n.subPages ?? []).reduce<WikiPageNode | null>((f, k) => f ?? find(k), null))
  const node = root ? find(root) : null
  return [...(node?.subPages ?? [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((n) => n.path)
}

/** The page with `line` added at the end of a "## heading" section (made at the end when missing); placeholder text there goes. */
export function appendToSection(markdown: string, heading: string, line: string, placeholder?: RegExp): string {
  const lines = markdown.replace(/\s+$/, '').split('\n')
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i').test(l))
  if (start < 0) return `${lines.join('\n')}\n\n## ${heading}\n${line}\n`
  let end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l))
  if (end < 0) end = lines.length
  const body = lines.slice(start + 1, end).filter((l) => !(placeholder && placeholder.test(l)))
  while (body.length && !body[body.length - 1].trim()) body.pop()
  const rest = lines.slice(end)
  return [...lines.slice(0, start + 1), ...body, line, ...(rest.length ? ['', ...rest] : [])].join('\n') + '\n'
}

/** The text under a "## heading", up to the next heading of that level or higher. */
export function sectionText(markdown: string, heading: string): string {
  const lines = markdown.split('\n')
  const start = lines.findIndex((l) => new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i').test(l))
  if (start < 0) return ''
  const end = lines.findIndex((l, i) => i > start && /^#{1,2}\s/.test(l))
  return lines.slice(start + 1, end < 0 ? undefined : end).join('\n')
}
