import { create } from 'zustand'
import { api } from '@/lib/api'
import { confirmAsync } from '@/lib/confirm'
import { errorMessage, type Project } from '@/lib/types'
import { flattenPages, pageNameProblem, wikiVersion } from '@/lib/wiki/pages'
import type { Wiki, WikiPage, WikiPageNode, WikiSearchResult } from '@/lib/wiki/types'
import { useAppStore } from './useAppStore'
import { useUiStore } from './useUiStore'

const read = (key: string): string | null => { try { return localStorage.getItem(key) } catch { return null } }
const write = (key: string, v: string) => { try { localStorage.setItem(key, v) } catch { /* ignore */ } }

/** A work item named as "#123" on a page, as its link shows it. */
export interface MentionedItem { title: string; type: string; state: string }

interface WikiState {
  project: Project | null
  wikis: Wiki[]
  wikiId: string | null
  tree: WikiPageNode | null
  loading: boolean
  error: string | null
  path: string | null
  page: WikiPage | null
  pageLoading: boolean
  pageError: string | null
  /** The text being edited; null when not editing. Kept when leaving the view, so nothing typed is lost. */
  draft: string | null
  saving: boolean
  search: { text: string; result: WikiSearchResult | null; loading: boolean } | null
  /** Work items mentioned on pages; null while loading or when not found. */
  mentions: Record<number, MentionedItem | null>

  load(project: Project): Promise<void>
  selectWiki(id: string): Promise<void>
  reloadTree(): Promise<void>
  open(path: string): Promise<void>
  edit(): void
  setDraft(text: string): void
  cancelEdit(): Promise<void>
  save(): Promise<boolean>
  createPage(parent: string, name: string): Promise<boolean>
  createWiki(): Promise<void>
  runSearch(text: string): Promise<void>
  clearSearch(): void
  loadMentions(ids: number[]): void
}

const wiki = (s: WikiState) => s.wikis.find((w) => w.id === s.wikiId) ?? null
const org = () => useAppStore.getState().activeOrg ?? ''
const toast = (t: Parameters<ReturnType<typeof useUiStore.getState>['toast']>[0]) => useUiStore.getState().toast(t)

export const useWikiStore = create<WikiState>((set, get) => {
  /** Unsaved edits are only dropped when the user says so. */
  const canLeave = async () => {
    const { draft, page } = get()
    if (draft === null || draft === page?.content) return true
    return confirmAsync('Your changes to this page are not saved. Discard them?', { title: 'Discard changes?', okLabel: 'Discard', danger: true })
  }

  return {
    project: null,
    wikis: [],
    wikiId: null,
    tree: null,
    loading: false,
    error: null,
    path: null,
    page: null,
    pageLoading: false,
    pageError: null,
    draft: null,
    saving: false,
    search: null,
    mentions: {},

    load: async (project) => {
      if (get().project?.id === project.id && get().tree) return
      if (get().project && get().project?.id !== project.id && !(await canLeave())) return
      set({ project, wikis: [], wikiId: null, tree: null, loading: true, error: null, path: null, page: null, pageError: null, draft: null, search: null, mentions: {} })
      try {
        const wikis = await api().wikiList(org(), project.name)
        if (get().project?.id !== project.id) return
        const remembered = read(`wiki.id.${project.id}`)
        const wikiId = wikis.find((w) => w.id === remembered)?.id ?? wikis[0]?.id ?? null
        set({ wikis, wikiId })
        if (wikiId) await get().reloadTree()
      } catch (e) {
        set({ error: errorMessage(e) })
      } finally {
        set({ loading: false })
      }
    },

    selectWiki: async (id) => {
      if (!(await canLeave())) return
      const p = get().project
      if (p) write(`wiki.id.${p.id}`, id)
      set({ wikiId: id, tree: null, path: null, page: null, draft: null, search: null })
      await get().reloadTree()
    },

    reloadTree: async () => {
      const { project } = get()
      const w = wiki(get())
      if (!project || !w) return
      set({ loading: true, error: null })
      try {
        const tree = await api().wikiTree(org(), project.name, w.id, wikiVersion(w))
        set({ tree })
        const paths = flattenPages(tree)
        const cur = get().path
        const want = cur && paths.includes(cur) ? cur : read(`wiki.page.${w.id}`)
        const start = want && paths.includes(want) ? want : paths.find((p) => p === '/Home') ?? paths[0]
        if (start && start !== cur) await get().open(start)
      } catch (e) {
        set({ error: errorMessage(e) })
      } finally {
        set({ loading: false })
      }
    },

    open: async (path) => {
      const { project } = get()
      const w = wiki(get())
      if (!project || !w) return
      if (path === get().path && get().draft !== null) return
      if (path !== get().path && get().draft !== null && !(await canLeave())) return
      // The old page goes at once: an edit started now must not begin from it, or save it here.
      set({ path, page: path === get().path ? get().page : null, pageLoading: true, pageError: null, draft: null })
      write(`wiki.page.${w.id}`, path)
      try {
        const page = await api().wikiPage(org(), project.name, w.id, path, wikiVersion(w))
        if (get().path === path) set({ page })
      } catch (e) {
        if (get().path === path) set({ page: null, pageError: errorMessage(e) })
      } finally {
        if (get().path === path) set({ pageLoading: false })
      }
    },

    edit: () => { const { page } = get(); if (page) set({ draft: page.content }) },
    setDraft: (draft) => set({ draft }),
    cancelEdit: async () => { if (await canLeave()) set({ draft: null }) },

    save: async () => {
      const { project, page, draft } = get()
      const w = wiki(get())
      if (!project || !w || !page || draft === null) return false
      if (draft === page.content) { set({ draft: null }); return true }
      set({ saving: true })
      try {
        const res = await api().wikiSave(org(), project.name, w.id, page.path, draft, page.version ?? '', wikiVersion(w))
        set({ page: { ...page, content: draft, version: res.version }, draft: null })
        toast({ kind: 'success', title: 'Page saved' })
        return true
      } catch (e) {
        toast({
          kind: 'error',
          title: 'Could not save the page',
          detail: errorMessage(e),
          sticky: true,
          action: { label: 'Copy my text', onClick: () => void navigator.clipboard.writeText(draft) },
        })
        return false
      } finally {
        set({ saving: false })
      }
    },

    createPage: async (parent, name) => {
      const { project } = get()
      const w = wiki(get())
      const problem = pageNameProblem(name)
      if (!project || !w) return false
      if (problem) { toast({ kind: 'error', title: problem }); return false }
      if (!(await canLeave())) return false
      try {
        const res = await api().wikiCreatePage(org(), project.name, w.id, parent, name.trim(), `# ${name.trim()}\n\n`, wikiVersion(w))
        set({ draft: null })
        await get().reloadTree()
        await get().open(res.path)
        get().edit()
        return true
      } catch (e) {
        toast({ kind: 'error', title: 'Could not create the page', detail: errorMessage(e) })
        return false
      }
    },

    createWiki: async () => {
      const { project } = get()
      if (!project) return
      set({ loading: true, error: null })
      try {
        const w = await api().wikiCreate(org(), project.name, project.id)
        set({ wikis: [w], wikiId: w.id })
        await get().reloadTree()
      } catch (e) {
        set({ error: errorMessage(e) })
      } finally {
        set({ loading: false })
      }
    },

    runSearch: async (text) => {
      const { project } = get()
      if (!project || !text.trim()) return
      set({ search: { text, result: null, loading: true } })
      try {
        const result = await api().wikiSearch(org(), project.name, text.trim())
        if (get().search?.text === text) set({ search: { text, result, loading: false } })
      } catch (e) {
        if (get().search?.text === text) set({ search: null })
        toast({ kind: 'error', title: 'Could not search the wiki', detail: errorMessage(e) })
      }
    },
    clearSearch: () => set({ search: null }),

    loadMentions: (ids) => {
      const { project, mentions } = get()
      const todo = ids.filter((id) => !(id in mentions)).slice(0, 40)
      if (!project || todo.length === 0) return
      set({ mentions: { ...mentions, ...Object.fromEntries(todo.map((id) => [id, null])) } })
      for (const id of todo) {
        api().getWorkItem(org(), project.name, id).then((w) => {
          const item = { title: String(w.fields['System.Title'] ?? ''), type: String(w.fields['System.WorkItemType'] ?? ''), state: String(w.fields['System.State'] ?? '') }
          set((s) => ({ mentions: { ...s.mentions, [id]: item } }))
        }).catch(() => { /* stays a plain #id link */ })
      }
    },
  }
})
