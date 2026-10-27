import { BookOpen, ChevronRight, ExternalLink, FilePlus, Link2, ListChecks, Pencil, RefreshCw, Search, Zap } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useShallow } from 'zustand/react/shallow'
import { Empty } from '@/components/ui/Empty'
import { MentionTextarea } from '@/components/ui/MentionTextarea'
import { api } from '@/lib/api'
import { renderMarkdown } from '@/lib/pr/markdown'
import { errorMessage, type WorkItem } from '@/lib/types'
import { newActions } from '@/lib/wiki/actions'
import { BLOCK_EXAMPLES, BLOCK_LANG } from '@/lib/wiki/blocks'
import { attachmentSrc, safeDecode, filterTree, flattenPages, imageMarkdown, linkToPath, mentionedIds, pageTitle, wikiBranch, wikiVersion } from '@/lib/wiki/pages'
import { renderWikiMentions } from '@/lib/wiki/people'
import { FEEDBACK } from '@/lib/wiki/templates'
import type { Wiki, WikiPageNode } from '@/lib/wiki/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useUiStore } from '@/store/useUiStore'
import { unseenChanges, useWikiStore, type MentionedItem } from '@/store/useWikiStore'
import { LiveBlock } from './LiveBlock'
import { NewPageForm } from './NewPageForm'
import { WikiUpdatesSide } from './WikiUpdates'

/** The project's Azure DevOps wiki: pages in a tree, read and edited in place. */
export function WikiView() {
  const project = useAppStore((s) => s.selectedProject)
  const s = useWikiStore(useShallow((st) => ({ load: st.load, wikis: st.wikis, wikiId: st.wikiId, tree: st.tree, loading: st.loading, error: st.error, createWiki: st.createWiki })))
  useEffect(() => { if (project) void s.load(project) }, [project, s.load])

  if (!project) return <Empty title="Choose a project">Pick a project in the sidebar to open its wiki.</Empty>
  if (s.error) {
    return (
      <Empty title="Could not open the wiki" action={<button type="button" className="btn" onClick={() => { useWikiStore.setState({ project: null }); void s.load(project) }}>Try again</button>}>
        {s.error} The token needs <b>Wiki: Read &amp; write</b>.
      </Empty>
    )
  }
  if (!s.loading && s.wikis.length === 0 && !s.tree) {
    return (
      <Empty title={`${project.name} has no wiki yet`} action={<button type="button" className="btn primary" onClick={() => void s.createWiki()}><BookOpen size={15} /> Create wiki</button>}>
        This creates the project wiki in Azure DevOps. Everyone in the project can read it there too.
      </Empty>
    )
  }
  return (
    <div className="wiki-view">
      <PagesPane />
      <PagePane />
    </div>
  )
}

// ---------------------------------------------------------------- pages

function PagesPane() {
  const s = useWikiStore(useShallow((st) => ({ wikis: st.wikis, wikiId: st.wikiId, tree: st.tree, path: st.path, loading: st.loading, search: st.search, selectWiki: st.selectWiki, open: st.open, runSearch: st.runSearch, clearSearch: st.clearSearch, changes: st.changes, seen: st.seen, since: st.since })))
  const [filter, setFilter] = useState('')
  // null: closed; '': from the + at the top (templates pick where the page goes); a path: under that page.
  const [adding, setAdding] = useState<string | null>(null)
  const paths = useMemo(() => flattenPages(s.tree), [s.tree])
  const unseen = useMemo(() => new Set(unseenChanges(s).map((c) => c.path)), [s])
  const shown = useMemo(() => (filter.trim() ? filterTree(paths, filter) : null), [paths, filter])

  return (
    <div className="wiki-side">
      {s.wikis.length > 1 && (
        <select className="input" value={s.wikiId ?? ''} onChange={(e) => void s.selectWiki(e.target.value)}>
          {s.wikis.map((w) => <option key={w.id} value={w.id}>{w.name}{w.type === 'codeWiki' ? ' (code)' : ''}</option>)}
        </select>
      )}
      <div className="wiki-find">
        <div className="search-box">
          <Search size={14} />
          <input
            value={filter}
            placeholder="Filter pages" title="Type to filter page titles; press Enter to search the text of every page"
            onChange={(e) => { setFilter(e.target.value); if (!e.target.value) s.clearSearch() }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filter.trim()) void s.runSearch(filter)
              if (e.key === 'Escape') { setFilter(''); s.clearSearch() }
            }}
          />
        </div>
        <button type="button" className="icon-btn" title="New page: blank, meeting notes, a decision, feedback, or a drafted sprint review or release notes" onClick={() => setAdding('')}><FilePlus size={16} /></button>
      </div>
      {adding !== null && <NewPageForm parent={adding || null} onDone={() => setAdding(null)} />}
      {!s.search && !filter && <WikiUpdatesSide />}
      <div className="wiki-tree">
        {s.search ? (
          <SearchResults onClose={() => { setFilter(''); s.clearSearch() }} />
        ) : !s.tree ? (
          s.loading && <div className="faint wiki-pad"><span className="spinner" /> Loading pages…</div>
        ) : paths.length === 0 ? (
          <div className="faint wiki-pad">No pages yet. Add the first one with +.</div>
        ) : shown && shown.size === 0 ? (
          <div className="faint wiki-pad">No page titles match. Press Enter to search their text.</div>
        ) : (
          (s.tree.subPages ?? []).slice().sort(byOrder).filter((n) => !shown || shown.has(n.path)).map((n) => (
            <TreeNode key={n.path} node={n} depth={0} current={s.path} shown={shown} unseen={unseen} onOpen={(p) => void s.open(p)} onAdd={setAdding} />
          ))
        )}
      </div>
    </div>
  )
}

const byOrder = (a: WikiPageNode, b: WikiPageNode) => (a.order ?? 0) - (b.order ?? 0)

function TreeNode({ node, depth, current, shown, unseen, onOpen, onAdd }: { node: WikiPageNode; depth: number; current: string | null; shown: Set<string> | null; unseen: Set<string>; onOpen: (p: string) => void; onAdd: (parent: string) => void }) {
  const kids = (node.subPages ?? []).slice().sort(byOrder).filter((n) => !shown || shown.has(n.path))
  const onPath = !!current && (current === node.path || current.startsWith(`${node.path}/`))
  const [open, setOpen] = useState(onPath)
  useEffect(() => { if (onPath) setOpen(true) }, [onPath])
  const expanded = open || !!shown
  return (
    <>
      <div className={`wiki-node ${current === node.path ? 'on' : ''}`} style={{ paddingLeft: 6 + depth * 14 }} onClick={() => onOpen(node.path)} title={node.path}>
        <span className={`wiki-twisty ${kids.length ? '' : 'none'} ${expanded ? 'open' : ''}`} onClick={(e) => { e.stopPropagation(); setOpen(!open) }}><ChevronRight size={13} /></span>
        <span className="wiki-node-t">{pageTitle(node.path)}</span>
        {unseen.has(node.path) && <span className="wiki-dot" title="Changed since you last looked" />}
        <button type="button" className="wiki-node-add" title="New page under this one" onClick={(e) => { e.stopPropagation(); setOpen(true); onAdd(node.path) }}><FilePlus size={13} /></button>
      </div>
      {expanded && kids.map((k) => <TreeNode key={k.path} node={k} depth={depth + 1} current={current} shown={shown} unseen={unseen} onOpen={onOpen} onAdd={onAdd} />)}
    </>
  )
}

function SearchResults({ onClose }: { onClose: () => void }) {
  const s = useWikiStore(useShallow((st) => ({ search: st.search, open: st.open, wikiId: st.wikiId, selectWiki: st.selectWiki })))
  const r = s.search?.result
  return (
    <div className="wiki-results">
      <div className="wiki-results-h">
        <span className="faint">{s.search?.loading ? 'Searching…' : `${r?.results.length ?? 0} found${r && !r.fullText ? ' (titles only: text search is not available)' : ''}`}</span>
        <span className="grow" />
        <button type="button" className="btn sm ghost" onClick={onClose}>Back to pages</button>
      </div>
      {s.search?.loading && <div className="wiki-pad"><span className="spinner" /></div>}
      {r?.results.map((h) => (
        <button key={`${h.wikiId}${h.path}`} type="button" className="wiki-hit" onClick={async () => { if (h.wikiId && h.wikiId !== s.wikiId) await s.selectWiki(h.wikiId); void s.open(h.path) }}>
          <span className="wiki-hit-t">{h.title}</span>
          <span className="faint wiki-hit-p">{h.path}</span>
          {h.snippet && <span className="wiki-hit-s">{h.snippet}</span>}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- page

function PagePane() {
  const s = useWikiStore(useShallow((st) => ({ path: st.path, page: st.page, pageLoading: st.pageLoading, pageError: st.pageError, draft: st.draft, creating: st.creating, wikis: st.wikis, wikiId: st.wikiId, people: st.people, makingTasks: st.makingTasks, edit: st.edit, open: st.open, reloadTree: st.reloadTree, loadChanges: st.loadChanges, createTasks: st.createTasks })))
  const [adding, setAdding] = useState(false)
  const [linking, setLinking] = useState(false)
  const w = s.wikis.find((x) => x.id === s.wikiId) ?? null
  const actions = useMemo(() => (s.page && s.draft === null ? newActions(s.page.content, s.people).length : 0), [s.page, s.draft, s.people])
  useEffect(() => { setLinking(false); setAdding(false) }, [s.path])
  if (!s.path) return <div className="wiki-main"><Empty title="No page open">Pick a page on the left, or add one.</Empty></div>
  const crumbs = s.path.split('/').filter(Boolean)
  const editing = s.draft !== null
  const feedback = !!s.page && (s.path.startsWith(`${FEEDBACK}/`) || /^##\s+Became\s*$/im.test(s.page.content))
  return (
    <div className="wiki-main">
      <div className="wiki-head">
        <div className="wiki-crumbs">
          {crumbs.map((c, i) => {
            const p = `/${crumbs.slice(0, i + 1).join('/')}`
            const last = i === crumbs.length - 1
            return <span key={p}>{i > 0 && <span className="crumb-sep">/</span>}<button type="button" className={`wiki-crumb ${last ? 'last' : ''}`} disabled={!!s.creating && last} onClick={() => void s.open(p)}>{c}</button></span>
          })}
          {s.creating && <span className="wiki-new-badge" title="Nothing is in the wiki until you save">New · not saved</span>}
        </div>
        <span className="grow" />
        {!editing && (
          <>
            <button type="button" className="icon-btn" title="Reload" onClick={() => { void s.reloadTree(); void s.open(s.path!); void s.loadChanges() }}><RefreshCw size={15} className={s.pageLoading ? 'spin' : ''} /></button>
            {(s.page?.remoteUrl ?? w?.remoteUrl) && <button type="button" className="icon-btn" title="Open in Azure DevOps" onClick={() => void api().openUrl(s.page?.remoteUrl ?? w!.remoteUrl!)}><ExternalLink size={15} /></button>}
            {actions > 0 && <button type="button" className="btn" disabled={s.makingTasks} title="Open actions (- [ ] @Name what to do) with no work item yet become Tasks, linked back on their lines" onClick={() => void s.createTasks()}>{s.makingTasks ? <span className="spinner" /> : <ListChecks size={14} />} Create tasks · {actions}</button>}
            {feedback && <button type="button" className="btn" title="Link the User Need or Requirement this feedback became" onClick={() => setLinking(!linking)}><Link2 size={14} /> Link requirement</button>}
            <button type="button" className="btn" onClick={() => setAdding(true)}><FilePlus size={14} /> New subpage</button>
            <button type="button" className="btn primary" disabled={!s.page} onClick={s.edit}><Pencil size={14} /> Edit</button>
          </>
        )}
      </div>
      {adding && <div className="wiki-head-new"><NewPageForm parent={s.path} onDone={() => setAdding(false)} /></div>}
      {linking && <div className="wiki-head-new"><LinkItem onDone={() => setLinking(false)} /></div>}
      {s.pageError ? (
        <Empty title="Could not open this page">{s.pageError}</Empty>
      ) : editing && w ? (
        <Editor wiki={w} />
      ) : s.page ? (
        <div className="wiki-scroll"><Markdown text={s.page.content} wiki={w} path={s.page.path} /></div>
      ) : (
        <div className="empty-state"><span className="spinner lg" /></div>
      )}
    </div>
  )
}

/** Find a work item and add it under the page's "## Became". */
function LinkItem({ onDone }: { onDone: () => void }) {
  const org = useAppStore((st) => st.activeOrg) ?? ''
  const project = useWikiStore((st) => st.project)
  const linkItem = useWikiStore((st) => st.linkItem)
  const [text, setText] = useState('')
  const [hits, setHits] = useState<WorkItem[]>([])
  useEffect(() => {
    const q = text.trim().replace(/^#/, '')
    if (!q || !project) { setHits([]); return }
    let live = true
    const t = setTimeout(() => { api().searchWorkItems(org, project.name, q).then((r) => { if (live) setHits(r.slice(0, 8)) }).catch(() => undefined) }, 250)
    return () => { live = false; clearTimeout(t) }
  }, [text, org, project])
  const pick = async (id: number) => { if (await linkItem(id)) onDone() }
  return (
    <div className="wiki-new">
      <div className="faint">Link the User Need or Requirement this feedback became. It goes under <b>Became</b>.</div>
      <input className="input" autoFocus value={text} placeholder="Search by title or #number" onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') onDone(); if (e.key === 'Enter' && /^#?\d+$/.test(text.trim())) void pick(Number(text.trim().replace('#', ''))) }} />
      {hits.map((h) => (
        <button key={h.id} type="button" className="wiki-hit" onClick={() => void pick(h.id)}>
          <span className="wiki-hit-t">#{h.id} {String(h.fields['System.Title'] ?? '')}</span>
          <span className="faint wiki-hit-p">{String(h.fields['System.WorkItemType'] ?? '')} · {String(h.fields['System.State'] ?? '')}</span>
        </button>
      ))}
    </div>
  )
}

const imageCache = new Map<string, Promise<string>>()

/** A page's markdown, with work item numbers as links, wiki links that open pages, live blocks, and its images loaded. */
function Markdown({ text, wiki, path }: { text: string; wiki: Wiki | null; path: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const org = useAppStore((s) => s.activeOrg) ?? ''
  const myId = useAppStore((s) => s.account()?.userId ?? null)
  const project = useWikiStore((s) => s.project)
  const people = useWikiStore((s) => s.people)
  const mentions = useWikiStore((s) => s.mentions)
  const loadMentions = useWikiStore((s) => s.loadMentions)
  const [live, setLive] = useState<{ el: HTMLElement; text: string; key: string }[]>([])
  const html = useMemo(() => renderMarkdown(renderWikiMentions(text, people, myId)).replace(/<p>\s*\[\[_TOC_\]\]\s*<\/p>/i, '<nav class="wiki-toc"></nav>'), [text, people, myId])
  useEffect(() => loadMentions(mentionedIds(text)), [text, loadMentions])

  // Titles of #123 links arrive one by one; they update the links in place, so live blocks are not rebuilt each time.
  const mentionsNow = useRef(mentions)
  useLayoutEffect(() => { mentionsNow.current = mentions })
  useEffect(() => { if (ref.current) linkMentions(ref.current, mentions) }, [mentions, html])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = html
    // ```boards blocks become live blocks, filled in by React below.
    const blocks = Array.from(el.querySelectorAll<HTMLElement>(`pre > code.language-${BLOCK_LANG}`)).map((code, i) => {
      const box = document.createElement('div')
      box.className = 'wiki-live'
      code.parentElement!.replaceWith(box)
      return { el: box, text: code.textContent ?? '', key: `${i}:${code.textContent}` }
    })
    setLive(blocks)
    linkMentions(el, mentionsNow.current)
    fillToc(el)
    if (!wiki || !project) return
    for (const img of Array.from(el.querySelectorAll('img'))) {
      const p = attachmentSrc(img.getAttribute('src') ?? '')
      if (!p) continue
      img.removeAttribute('src')
      const key = `${wiki.id}${p}`
      if (!imageCache.has(key)) imageCache.set(key, api().wikiAttachment(org, project.name, wiki.repositoryId, wikiBranch(wiki), p, wiki.mappedPath ?? null))
      imageCache.get(key)!.then((src) => { if (src) img.src = src }).catch(() => { img.alt = `${img.alt} (could not load)` })
    }
  }, [html, wiki, project, org])

  const onClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    e.preventDefault()
    const wi = a.getAttribute('data-wi')
    if (wi) { void useBoardStore.getState().openItem(Number(wi), { project: project?.name }); return }
    const href = a.getAttribute('href') ?? ''
    if (href.startsWith('#')) { ref.current?.querySelector(`[id="${CSS.escape(safeDecode(href.slice(1)))}"]`)?.scrollIntoView({ behavior: 'smooth' }); return }
    const page = linkToPath(href, path)
    if (page) void useWikiStore.getState().open(page)
    else if (/^(https?|mailto):/i.test(href)) void api().openUrl(href)
  }
  return (
    <>
      <div ref={ref} className="wiki-md md selectable" data-own-links onClick={onClick} />
      {live.map((b) => createPortal(<LiveBlock text={b.text} />, b.el, b.key))}
    </>
  )
}

/** "#123" in text (not in code or links) becomes a link to the work item; links already made get the titles known now. */
function linkMentions(root: HTMLElement, mentions: Record<number, MentionedItem | null>) {
  const show = (a: HTMLElement, id: number) => {
    const item = mentions[id]
    a.className = `wiki-wi${item ? '' : ' plain'}${item?.done ? ' done' : ''}`
    a.textContent = item ? `#${id} ${item.title}` : `#${id}`
    if (item) a.title = `${item.type} · ${item.state}`
  }
  for (const a of Array.from(root.querySelectorAll<HTMLElement>('a[data-wi]'))) if (!a.closest('.wiki-live')) show(a, Number(a.dataset.wi))
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('a, code, pre, .wiki-live') ? NodeFilter.FILTER_REJECT : /#\d/.test(n.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  })
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    const text = node.nodeValue ?? ''
    const re = /(^|[^\w&/#])#(\d{1,7})\b/g
    const frag = document.createDocumentFragment()
    let last = 0
    for (const m of text.matchAll(re)) {
      const start = (m.index ?? 0) + m[1].length
      frag.append(text.slice(last, start))
      const id = Number(m[2])
      const a = document.createElement('a')
      a.href = '#'
      a.setAttribute('data-wi', String(id))
      show(a, id)
      frag.append(a)
      last = start + m[2].length + 1
    }
    if (last === 0) continue
    frag.append(text.slice(last))
    node.replaceWith(frag)
  }
}

/** [[_TOC_]]: the page's headings, linked. */
function fillToc(root: HTMLElement) {
  const toc = root.querySelector('nav.wiki-toc')
  const heads = Array.from(root.querySelectorAll('h1, h2, h3'))
  if (!toc) return
  heads.forEach((h, i) => { if (!h.id) h.id = `h-${i}-${(h.textContent ?? '').toLowerCase().replace(/[^\w]+/g, '-')}` })
  toc.innerHTML = ''
  const ul = document.createElement('ul')
  for (const h of heads) {
    const li = document.createElement('li')
    li.className = `lvl-${h.tagName.toLowerCase()}`
    const a = document.createElement('a')
    a.href = `#${encodeURIComponent(h.id)}`
    a.textContent = h.textContent
    li.append(a)
    ul.append(li)
  }
  toc.append(ul)
}

// ---------------------------------------------------------------- edit

function Editor({ wiki }: { wiki: Wiki }) {
  const s = useWikiStore(useShallow((st) => ({ draft: st.draft, clean: st.clean, page: st.page, creating: st.creating, saving: st.saving, people: st.people, makingTasks: st.makingTasks, setDraft: st.setDraft, save: st.save, cancelEdit: st.cancelEdit, createTasks: st.createTasks, project: st.project })))
  const org = useAppStore((st) => st.activeOrg) ?? ''
  const toast = useUiStore((st) => st.toast)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [uploading, setUploading] = useState(0)
  // Where the caret was, for what the toolbar inserts: the textarea loses focus when a button is clicked.
  const caret = useRef<number | null>(null)
  const draft = s.draft ?? ''
  const dirty = s.creating !== null || draft !== s.clean
  const actions = useMemo(() => newActions(draft, s.people).length, [draft, s.people])

  /** Puts text on lines of its own at `at` in the draft as it is now. */
  const insertAt = (at: number, text: string) => {
    const cur = useWikiStore.getState().draft ?? ''
    const before = cur.slice(0, Math.min(at, cur.length))
    const after = cur.slice(Math.min(at, cur.length))
    s.setDraft(`${before}${before && !before.endsWith('\n') ? '\n' : ''}${text}\n${after.startsWith('\n') ? after.slice(1) : after}`)
  }

  /** Uploads images and puts their markdown where the caret was. */
  const addImages = async (files: File[], at: number) => {
    if (!s.project) return
    const forPath = s.page?.path
    setUploading((n) => n + files.length)
    const lines: string[] = []
    for (const f of files) {
      try {
        const data = await readBase64(f)
        const ext = (f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')
        const name = f.name && f.name !== 'image.png' ? f.name : `screenshot-${Date.now()}.${ext}`
        const res = await api().wikiUploadAttachment(org, s.project.name, wiki.id, name, data, wikiVersion(wiki))
        lines.push(imageMarkdown(res.name ?? name, res.path))
      } catch (e) {
        toast({ kind: 'error', title: 'Could not add the image', detail: errorMessage(e) })
      } finally {
        setUploading((n) => n - 1)
      }
    }
    // The user may have left the editor or the page while uploading: the images are not for this one.
    const now = useWikiStore.getState()
    if (lines.length === 0 || now.draft === null || now.page?.path !== forPath) return
    insertAt(at, lines.join('\n'))
  }

  const insertBlock = () => void api().showContextMenu(BLOCK_EXAMPLES.map((b) => ({
    label: b.label,
    action: () => { setTab('write'); insertAt(caret.current ?? draft.length, `\`\`\`${BLOCK_LANG}\n${b.text}\n\`\`\``) },
  })))

  return (
    <div className="wiki-editor">
      <div className="wiki-editor-bar">
        <div className="segmented small">
          <button type="button" className={tab === 'write' ? 'on' : ''} onClick={() => setTab('write')}>Write</button>
          <button type="button" className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>Preview</button>
        </div>
        <button type="button" className="btn sm ghost" title="Insert a block that shows work items, a requirement, pull requests, decisions or feedback as they are now" onClick={insertBlock}><Zap size={13} /> Live block</button>
        {actions > 0 && <button type="button" className="btn sm ghost" disabled={s.makingTasks} title="Open actions with no work item yet become Tasks" onClick={() => void s.createTasks()}><ListChecks size={13} /> Create tasks · {actions}</button>}
        <span className="faint wiki-hint">@ person · #123 work item · - [ ] action · paste images{uploading > 0 && <> · <span className="spinner" /> uploading</>}</span>
        <span className="grow" />
        <button type="button" className="btn" onClick={() => void s.cancelEdit()} disabled={s.saving}>Cancel</button>
        <button type="button" className="btn primary" onClick={() => void s.save()} disabled={s.saving || uploading > 0 || !dirty} title="Save (⌘S)">{s.saving && <span className="spinner" />} {s.creating ? 'Add page' : 'Save'}</button>
      </div>
      {tab === 'write' ? (
        <MentionTextarea
          className="wiki-textarea"
          value={draft}
          people={s.people}
          org={org}
          project={s.project?.name ?? null}
          autoFocus
          spellCheck
          aria-label="Page text"
          onChange={s.setDraft}
          onSelect={(e) => { caret.current = e.currentTarget.selectionStart }}
          onKeyDown={(e) => { if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (dirty) void s.save() } }}
          onPaste={(e) => { const files = images(e.clipboardData); if (files.length) { e.preventDefault(); void addImages(files, e.currentTarget.selectionStart) } }}
          onDrop={(e) => { const files = images(e.dataTransfer); if (files.length) { e.preventDefault(); void addImages(files, e.currentTarget.selectionStart) } }}
        />
      ) : (
        <div className="wiki-scroll"><Markdown text={draft} wiki={wiki} path={s.page?.path ?? '/'} /></div>
      )}
    </div>
  )
}

const images = (d: DataTransfer | null) => Array.from(d?.files ?? []).filter((f) => f.type.startsWith('image/'))

function readBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)) }
    r.onerror = () => reject(r.error)
    r.readAsDataURL(f)
  })
}
