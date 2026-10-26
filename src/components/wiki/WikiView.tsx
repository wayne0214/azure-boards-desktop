import { BookOpen, ChevronRight, ExternalLink, FilePlus, Pencil, RefreshCw, Search, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Empty } from '@/components/ui/Empty'
import { api } from '@/lib/api'
import { renderMarkdown } from '@/lib/pr/markdown'
import { errorMessage } from '@/lib/types'
import { attachmentSrc, safeDecode, filterTree, flattenPages, imageMarkdown, linkToPath, mentionedIds, pageTitle, wikiBranch, wikiVersion } from '@/lib/wiki/pages'
import type { Wiki, WikiPageNode } from '@/lib/wiki/types'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useUiStore } from '@/store/useUiStore'
import { useWikiStore, type MentionedItem } from '@/store/useWikiStore'

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
  const s = useWikiStore(useShallow((st) => ({ wikis: st.wikis, wikiId: st.wikiId, tree: st.tree, path: st.path, loading: st.loading, search: st.search, selectWiki: st.selectWiki, open: st.open, runSearch: st.runSearch, clearSearch: st.clearSearch, createPage: st.createPage })))
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState<string | null>(null)
  const paths = useMemo(() => flattenPages(s.tree), [s.tree])
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
        <button type="button" className="icon-btn" title="New page" onClick={() => setAdding('/')}><FilePlus size={16} /></button>
      </div>
      {adding !== null && <NewPage parent={adding} onDone={() => setAdding(null)} onCreate={(name) => s.createPage(adding, name)} />}
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
            <TreeNode key={n.path} node={n} depth={0} current={s.path} shown={shown} onOpen={(p) => void s.open(p)} onAdd={setAdding} />
          ))
        )}
      </div>
    </div>
  )
}

const byOrder = (a: WikiPageNode, b: WikiPageNode) => (a.order ?? 0) - (b.order ?? 0)

function TreeNode({ node, depth, current, shown, onOpen, onAdd }: { node: WikiPageNode; depth: number; current: string | null; shown: Set<string> | null; onOpen: (p: string) => void; onAdd: (parent: string) => void }) {
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
        <button type="button" className="wiki-node-add" title="New page under this one" onClick={(e) => { e.stopPropagation(); setOpen(true); onAdd(node.path) }}><FilePlus size={13} /></button>
      </div>
      {expanded && kids.map((k) => <TreeNode key={k.path} node={k} depth={depth + 1} current={current} shown={shown} onOpen={onOpen} onAdd={onAdd} />)}
    </>
  )
}

function NewPage({ parent, onDone, onCreate }: { parent: string; onDone: () => void; onCreate: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!name.trim() || busy) return
    setBusy(true)
    const ok = await onCreate(name)
    setBusy(false)
    if (ok) onDone()
  }
  return (
    <div className="wiki-new">
      <div className="faint">New page {parent === '/' ? 'at the top' : <>under <b>{pageTitle(parent)}</b></>}</div>
      <div className="form-inline">
        <input className="input" autoFocus value={name} placeholder="Page name" onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void submit(); if (e.key === 'Escape') onDone() }} />
        <button type="button" className="btn sm primary" disabled={!name.trim() || busy} onClick={() => void submit()}>{busy ? <span className="spinner" /> : 'Add'}</button>
        <button type="button" className="icon-btn" title="Cancel" onClick={onDone}><X size={14} /></button>
      </div>
    </div>
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
  const s = useWikiStore(useShallow((st) => ({ path: st.path, page: st.page, pageLoading: st.pageLoading, pageError: st.pageError, draft: st.draft, wikis: st.wikis, wikiId: st.wikiId, edit: st.edit, open: st.open, reloadTree: st.reloadTree })))
  const [adding, setAdding] = useState(false)
  const createPage = useWikiStore((st) => st.createPage)
  const w = s.wikis.find((x) => x.id === s.wikiId) ?? null
  if (!s.path) return <div className="wiki-main"><Empty title="No page open">Pick a page on the left, or add one.</Empty></div>
  const crumbs = s.path.split('/').filter(Boolean)
  const editing = s.draft !== null
  return (
    <div className="wiki-main">
      <div className="wiki-head">
        <div className="wiki-crumbs">
          {crumbs.map((c, i) => {
            const p = `/${crumbs.slice(0, i + 1).join('/')}`
            return <span key={p}>{i > 0 && <span className="crumb-sep">/</span>}<button type="button" className={`wiki-crumb ${i === crumbs.length - 1 ? 'last' : ''}`} onClick={() => void s.open(p)}>{c}</button></span>
          })}
        </div>
        <span className="grow" />
        {!editing && (
          <>
            <button type="button" className="icon-btn" title="Reload" onClick={() => { void s.reloadTree(); void s.open(s.path!) }}><RefreshCw size={15} className={s.pageLoading ? 'spin' : ''} /></button>
            {(s.page?.remoteUrl ?? w?.remoteUrl) && <button type="button" className="icon-btn" title="Open in Azure DevOps" onClick={() => void api().openUrl(s.page?.remoteUrl ?? w!.remoteUrl!)}><ExternalLink size={15} /></button>}
            <button type="button" className="btn" onClick={() => setAdding(true)}><FilePlus size={14} /> New subpage</button>
            <button type="button" className="btn primary" disabled={!s.page} onClick={s.edit}><Pencil size={14} /> Edit</button>
          </>
        )}
      </div>
      {adding && <div className="wiki-head-new"><NewPage parent={s.path} onDone={() => setAdding(false)} onCreate={(name) => createPage(s.path!, name)} /></div>}
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

const imageCache = new Map<string, Promise<string>>()

/** A page's markdown, with work item numbers as links, wiki links that open pages, and its images loaded. */
function Markdown({ text, wiki, path }: { text: string; wiki: Wiki | null; path: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const org = useAppStore((s) => s.activeOrg) ?? ''
  const project = useWikiStore((s) => s.project)
  const mentions = useWikiStore((s) => s.mentions)
  const loadMentions = useWikiStore((s) => s.loadMentions)
  const html = useMemo(() => renderMarkdown(text).replace(/<p>\s*\[\[_TOC_\]\]\s*<\/p>/i, '<nav class="wiki-toc"></nav>'), [text])
  useEffect(() => loadMentions(mentionedIds(text)), [text, loadMentions])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.innerHTML = html
    linkMentions(el, mentions)
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
  }, [html, mentions, wiki, project, org])

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
  return <div ref={ref} className="wiki-md md selectable" data-own-links onClick={onClick} />
}

/** "#123" in text (not in code or links) becomes a link to the work item, with its title once loaded. */
function linkMentions(root: HTMLElement, mentions: Record<number, MentionedItem | null>) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest('a, code, pre') ? NodeFilter.FILTER_REJECT : /#\d/.test(n.nodeValue ?? '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
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
      const item = mentions[id]
      const a = document.createElement('a')
      a.href = '#'
      a.className = `wiki-wi${item ? '' : ' plain'}`
      a.setAttribute('data-wi', String(id))
      a.textContent = item ? `#${id} ${item.title}` : `#${id}`
      if (item) a.title = `${item.type} · ${item.state}`
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
  const s = useWikiStore(useShallow((st) => ({ draft: st.draft, page: st.page, saving: st.saving, setDraft: st.setDraft, save: st.save, cancelEdit: st.cancelEdit, project: st.project })))
  const org = useAppStore((st) => st.activeOrg) ?? ''
  const toast = useUiStore((st) => st.toast)
  const [tab, setTab] = useState<'write' | 'preview'>('write')
  const [uploading, setUploading] = useState(0)
  const ta = useRef<HTMLTextAreaElement>(null)
  const draft = s.draft ?? ''
  const dirty = draft !== s.page?.content

  /** Uploads images and puts their markdown where the caret is. */
  const addImages = async (files: File[]) => {
    if (!s.project) return
    const el = ta.current
    const at = el ? el.selectionStart : draft.length
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
    const cur = now.draft
    const before = cur.slice(0, at)
    // Each image on a line of its own.
    s.setDraft(`${before}${before && !before.endsWith('\n') ? '\n' : ''}${lines.join('\n')}\n${cur.slice(at)}`)
  }

  return (
    <div className="wiki-editor">
      <div className="wiki-editor-bar">
        <div className="segmented small">
          <button type="button" className={tab === 'write' ? 'on' : ''} onClick={() => setTab('write')}>Write</button>
          <button type="button" className={tab === 'preview' ? 'on' : ''} onClick={() => setTab('preview')}>Preview</button>
        </div>
        <span className="faint wiki-hint">Markdown · #123 links a work item · paste or drop images{uploading > 0 && <> · <span className="spinner" /> uploading</>}</span>
        <span className="grow" />
        <button type="button" className="btn" onClick={() => void s.cancelEdit()} disabled={s.saving}>Cancel</button>
        <button type="button" className="btn primary" onClick={() => void s.save()} disabled={s.saving || uploading > 0 || !dirty} title="Save (⌘S)">{s.saving && <span className="spinner" />} Save</button>
      </div>
      {tab === 'write' ? (
        <textarea
          ref={ta}
          className="wiki-textarea"
          value={draft}
          autoFocus
          spellCheck
          aria-label="Page text"
          onChange={(e) => s.setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); if (dirty) void s.save() } }}
          onPaste={(e) => { const files = images(e.clipboardData); if (files.length) { e.preventDefault(); void addImages(files) } }}
          onDrop={(e) => { const files = images(e.dataTransfer); if (files.length) { e.preventDefault(); void addImages(files) } }}
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
