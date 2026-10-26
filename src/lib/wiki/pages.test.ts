import { describe, expect, it } from 'vitest'
import { filterTree, flattenPages, imageMarkdown, mentionedIds, pageNameProblem, pageTitle, parentPath, wikiBranch, wikiVersion } from './pages'
import type { Wiki } from './types'

const tree = { path: '/', subPages: [
  { path: '/Meetings', order: 1, subPages: [{ path: '/Meetings/2026-10-26 Sprint review', order: 0 }] },
  { path: '/Home', order: 0 },
] }

describe('wiki pages', () => {
  it('names and walks pages', () => {
    expect(pageTitle('/Meetings/2026-10-26 Sprint review')).toBe('2026-10-26 Sprint review')
    expect(pageTitle('/')).toBe('Home')
    expect(parentPath('/Meetings/x')).toBe('/Meetings')
    expect(parentPath('/Meetings')).toBe('/')
    expect(flattenPages(tree)).toEqual(['/Home', '/Meetings', '/Meetings/2026-10-26 Sprint review'])
  })

  it('filters by title and keeps the parents of matches', () => {
    expect([...filterTree(flattenPages(tree), 'sprint')]).toEqual(['/Meetings/2026-10-26 Sprint review', '/Meetings'])
    expect(filterTree(flattenPages(tree), 'nothing').size).toBe(0)
  })

  it('checks page names', () => {
    expect(pageNameProblem('Decision log')).toBeNull()
    expect(pageNameProblem('a/b')).not.toBeNull()
    expect(pageNameProblem(' ')).not.toBeNull()
    expect(pageNameProblem('.x')).not.toBeNull()
  })

  it('finds work items mentioned outside code', () => {
    expect(mentionedIds('Fixes #1182 and #1164.\n`#99` ```\n#98\n``` see #1182, not a#5 or &#39;')).toEqual([1182, 1164])
  })

  it('knows which branch a wiki is on', () => {
    const project: Wiki = { id: 'w', name: 'P.wiki', type: 'projectWiki', projectId: 'p', repositoryId: 'r', versions: [{ version: 'wikiMaster' }] }
    expect(wikiVersion(project)).toBeNull()
    expect(wikiBranch(project)).toBe('wikiMaster')
    expect(wikiVersion({ ...project, type: 'codeWiki', versions: [{ version: 'main' }] })).toBe('main')
    expect(imageMarkdown('shot [1].png', '/.attachments/shot 1.png')).toBe('![shot 1.png](/.attachments/shot%201.png)')
  })
})

describe('links between pages', async () => {
  const { attachmentSrc, linkToPath } = await import('./pages')
  it('follows wiki links and leaves the rest alone', () => {
    expect(linkToPath('/Decision-log/0002-Resumable-uploads', '/Home')).toBe('/Decision log/0002 Resumable uploads')
    expect(linkToPath('/Q4%2Dplan', '/Home')).toBe('/Q4-plan')
    expect(linkToPath('Child-page', '/Meetings/Today')).toBe('/Meetings/Child page')
    expect(linkToPath('../Home.md#top', '/Meetings/Today')).toBe('/Home')
    expect(linkToPath('https://example.com', '/Home')).toBeNull()
    expect(linkToPath('mailto:a@b.c', '/Home')).toBeNull()
    expect(linkToPath('#section', '/Home')).toBeNull()
    expect(linkToPath('/.attachments/a.png', '/Home')).toBeNull()
  })
  it('spots attachment images', () => {
    expect(attachmentSrc('.attachments/a.png')).toBe('/.attachments/a.png')
    expect(attachmentSrc('https://x/a.png')).toBeNull()
    expect(attachmentSrc('data:image/png;base64,x')).toBeNull()
  })
})
