// Demo wiki for browser mode: a few pages a team would keep, saved in memory with versions.
import type { Api } from './api'
import { pageTitle, parentPath } from './wiki/pages'
import type { Wiki, WikiPageNode } from './wiki/types'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const fail = (message: string, status: number) => Object.assign(new Error(message), { message, status, kind: status === 412 || status === 409 ? 'conflict' : 'validation' })

const wikis: Record<string, Wiki[]> = {
  'Contoso Mobile': [{ id: 'w1', name: 'Contoso Mobile.wiki', type: 'projectWiki', projectId: 'p1', repositoryId: 'wr1', versions: [{ version: 'wikiMaster' }], remoteUrl: 'https://dev.azure.com/demo-org/Contoso%20Mobile/_wiki/wikis/Contoso%20Mobile.wiki' }],
}

const pages = new Map<string, { content: string; version: number }>([
  ['/Home', { version: 1, content: '# Contoso Mobile\n\nThe scoliosis screening app: patients take a photo, the app measures the Cobb angle, and clinicians review it.\n\n## Start here\n- [Onboarding](/Onboarding) for new team members\n- [Decision log](/Decision-log) for why things are the way they are\n- [Meeting notes](/Meeting-notes) from planning and reviews\n\nCurrent focus: #1182 (retaking a photo when the pose check fails).' }],
  ['/Onboarding', { version: 1, content: '# Onboarding\n\n1. Ask for access to the **Contoso Mobile** project and the `contoso-mobile` repository.\n2. Read the [Decision log](/Decision-log).\n3. Pick a starter bug tagged `good-first`.\n\n| Who | Ask about |\n|---|---|\n| Wayne | Releases and versioning |\n| Priya | Image processing |' }],
  ['/Meeting notes', { version: 1, content: '# Meeting notes\n\nOne page per meeting, named `YYYY-MM-DD Topic`.' }],
  ['/Meeting notes/2026-10-20 Sprint planning', { version: 3, content: '# Sprint planning – 20 Oct 2026\n\n**Attendees:** Wayne, Priya, Tom\n\n## Agenda\n- Upload reliability (#1171)\n- Pose check retake flow (#1182)\n\n## Decisions\n- Resume uploads instead of restarting them (see [0002](/Decision-log/0002-Resumable-uploads)).\n\n## Actions\n- [ ] Priya: spike resumable uploads – #1164\n- [ ] Tom: retake button design' }],
  ['/Decision log', { version: 1, content: '# Decision log\n\nShort records of decisions: what, why, who, and what it affects.' }],
  ['/Decision log/0001 Use Git Flow', { version: 1, content: '# 0001 Use Git Flow\n\n**Status:** Accepted · **Decided by:** Wayne · 2026-09-02\n\nFeature branches go to `develop`; only release and hotfix branches go to `main`. CI bumps versions from Conventional Commit titles.' }],
  ['/Decision log/0002 Resumable uploads', { version: 2, content: '# 0002 Resumable uploads\n\n**Status:** Accepted · 2026-10-20\n\nUploads on a flaky network restart from zero today (#1171). We will upload in 1 MB chunks and resume from the last one. Affects #1164.' }],
  ['/Collaborator feedback', { version: 1, content: '# Collaborator feedback\n\nWhat clinics and partners told us, with a link to the requirement it became.' }],
  ['/Collaborator feedback/2026-10 Clinic pilot', { version: 1, content: '# Clinic pilot – October 2026\n\n> "Patients do not notice the pose warning and keep taking the same photo." – Dr. Lee\n\nBecame #1182.' }],
])
const attachments = new Map<string, string>()

function tree(): WikiPageNode {
  const root: WikiPageNode = { path: '/', subPages: [] }
  const byPath = new Map<string, WikiPageNode>([['/', root]])
  ;[...pages.keys()].sort((a, b) => a.split('/').length - b.split('/').length).forEach((p, i) => {
    const node: WikiPageNode = { path: p, order: i, subPages: [] }
    byPath.set(p, node)
    const parent = byPath.get(parentPath(p)) ?? root
    parent.subPages = [...(parent.subPages ?? []), node]
    parent.isParentPage = true
  })
  return structuredClone(root)
}

const snippet = (content: string, word: string) => {
  const i = content.toLowerCase().indexOf(word)
  return i < 0 ? '' : `${i > 40 ? '…' : ''}${content.slice(Math.max(0, i - 40), i + 80).replace(/\n/g, ' ')}…`
}

export const mockWiki: Pick<Api, 'wikiList' | 'wikiCreate' | 'wikiTree' | 'wikiPage' | 'wikiSave' | 'wikiCreatePage' | 'wikiUploadAttachment' | 'wikiAttachment' | 'wikiSearch'> = {
  wikiList: async (_o, project) => { await delay(); return structuredClone(wikis[project] ?? []) },
  wikiCreate: async (_o, project, projectId) => {
    await delay(400)
    const w: Wiki = { id: `w-${projectId}`, name: `${project}.wiki`, type: 'projectWiki', projectId, repositoryId: `wr-${projectId}`, versions: [{ version: 'wikiMaster' }] }
    wikis[project] = [w]
    return structuredClone(w)
  },
  wikiTree: async () => { await delay(); return tree() },
  wikiPage: async (_o, _p, _w, path) => {
    await delay()
    const page = pages.get(path)
    if (!page) throw fail('Page not found.', 404)
    return { path, content: page.content, version: `"v${page.version}"`, remoteUrl: null }
  },
  wikiSave: async (_o, _p, _w, path, content, pageVersion) => {
    await delay(300)
    const page = pages.get(path)
    if (!page) throw fail('Page not found.', 404)
    if (pageVersion !== `"v${page.version}"`) throw fail('Someone else saved this page while you were editing it. Copy your text, reload the page, and add your changes again.', 412)
    page.content = content
    page.version += 1
    return { path, version: `"v${page.version}"` }
  },
  wikiCreatePage: async (_o, _p, _w, parent, name, content) => {
    await delay(300)
    const path = `${parent === '/' ? '' : parent}/${name.trim()}`
    if (pages.has(path)) throw fail('A page with that name is already there. Pick another name.', 409)
    pages.set(path, { content, version: 1 })
    return { path, version: '"v1"' }
  },
  wikiUploadAttachment: async (_o, _p, _w, fileName, dataBase64) => {
    await delay(300)
    const path = `/.attachments/${fileName.replace(/\.(\w+)$/, `-${Date.now()}.$1`)}`
    attachments.set(path, `data:image/png;base64,${dataBase64}`)
    return { name: fileName, path }
  },
  wikiAttachment: async (_o, _p, _r, _b, path, _root) => attachments.get(decodeURIComponent(path)) ?? '',
  wikiSearch: async (_o, _p, text) => {
    await delay()
    const word = text.trim().toLowerCase()
    const results = [...pages.entries()]
      .filter(([path, p]) => path.toLowerCase().includes(word) || p.content.toLowerCase().includes(word))
      .map(([path, p]) => ({ wikiId: 'w1', wikiName: 'Contoso Mobile.wiki', path, title: pageTitle(path), snippet: snippet(p.content, word) }))
    return { fullText: true, results }
  },
}
