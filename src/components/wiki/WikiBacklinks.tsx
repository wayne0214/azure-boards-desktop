import { BookOpen, CircleCheck, MessageSquareQuote, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { findBacklinks, type Backlink } from '@/lib/wiki/backlinks'
import { useWikiStore } from '@/store/useWikiStore'

const ICON = { meeting: Users, decision: CircleCheck, feedback: MessageSquareQuote, page: BookOpen }
const KIND = { meeting: 'Meeting notes', decision: 'Decision', feedback: 'Feedback', page: 'Page' }

/** "Mentioned in": wiki pages that name this work item. Left out when there are none. */
export function WikiBacklinks({ id, org, project }: { id: number; org: string | null; project: string }) {
  const [links, setLinks] = useState<Backlink[] | null>(null)
  useEffect(() => {
    if (!org || !project) return
    let live = true
    setLinks(null)
    findBacklinks(org, project, id).then((l) => { if (live) setLinks(l) }).catch(() => { if (live) setLinks([]) })
    return () => { live = false }
  }, [id, org, project])
  if (!links || links.length === 0) return null
  return (
    <>
      <div className="section-h">Mentioned in the wiki · {links.length}</div>
      <div className="wiki-backlinks">
        {links.map((b) => {
          const Icon = ICON[b.kind]
          return (
            <button key={`${b.wikiId}${b.path}`} type="button" className="wiki-backlink" title={b.path} onClick={() => void useWikiStore.getState().show(b.path, b.wikiId)}>
              <Icon size={14} />
              <span className="t">{b.title}</span>
              <span className="faint">{KIND[b.kind]}{b.status ? ` · ${b.status}` : ''}</span>
            </button>
          )
        })}
      </div>
    </>
  )
}
