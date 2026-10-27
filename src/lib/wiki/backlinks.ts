import { api } from '@/lib/api'
import { mentionedIds, pageMeta, pageTitle, wikiVersion } from './pages'
import { DECISIONS, FEEDBACK, MEETINGS } from './templates'

export type BacklinkKind = 'meeting' | 'decision' | 'feedback' | 'page'

export interface Backlink {
  wikiId: string
  path: string
  title: string
  kind: BacklinkKind
  /** A decision's or feedback's status. */
  status: string | null
}

export const backlinkKind = (path: string): BacklinkKind =>
  path.startsWith(`${MEETINGS}/`) ? 'meeting' : path.startsWith(`${DECISIONS}/`) ? 'decision' : path.startsWith(`${FEEDBACK}/`) ? 'feedback' : 'page'

const FRESH = 2 * 60_000
const cache = new Map<string, { at: number; value: Promise<Backlink[]> }>()

/** Most pages read to check a search hit really names the item (search also finds "1182" in other text). */
const MAX_CHECKED = 12

/** Wiki pages that mention work item #id: found by search, then read to make sure. */
export function findBacklinks(org: string, project: string, id: number, force = false): Promise<Backlink[]> {
  const key = `${org}/${project}/${id}`
  const hit = cache.get(key)
  if (!force && hit && Date.now() - hit.at < FRESH) return hit.value
  const value = (async () => {
    const [found, wikis] = await Promise.all([api().wikiSearch(org, project, String(id)), api().wikiList(org, project)])
    if (!found.fullText || wikis.length === 0) return []
    const hits = found.results.slice(0, MAX_CHECKED)
    const checked = await Promise.all(hits.map(async (h) => {
      const w = wikis.find((x) => x.id === h.wikiId) ?? wikis[0]
      const page = await api().wikiPage(org, project, w.id, h.path, wikiVersion(w)).catch(() => null)
      if (!page || !mentionedIds(page.content).includes(id)) return null
      return { wikiId: w.id, path: h.path, title: pageTitle(h.path), kind: backlinkKind(h.path), status: pageMeta(page.content).status } satisfies Backlink
    }))
    return checked.filter((b): b is Backlink => b !== null)
  })()
  cache.set(key, { at: Date.now(), value })
  value.catch(() => cache.delete(key))
  return value
}
