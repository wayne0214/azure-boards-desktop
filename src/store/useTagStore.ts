import { create } from 'zustand'
import { api } from '@/lib/api'
import type { Repo } from '@/lib/pr/types'
import { defaultRepo, tagVersions, type TagVersion } from '@/lib/testplans/tags'
import { useAppStore } from './useAppStore'

const errorText = (e: unknown) => String((e as { message?: string })?.message ?? e)
const repoKey = (org: string, project: string) => `versions.repo.${org}/${project}`
const PRERELEASE_KEY = 'versions.prerelease'

const read = (key: string): string | null => { try { return localStorage.getItem(key) } catch { return null } }
const write = (key: string, value: string | null) => { try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value) } catch { /* ignore */ } }

interface TagState {
  /** "org/project" the repos and tags belong to. */
  scope: string | null
  repos: Repo[] | null
  repoId: string | null
  /** Newest first; null until read, or when they cannot be (e.g. the token has no Code access). */
  tags: TagVersion[] | null
  error: string | null
  loading: boolean
  /** Offer pre-release tags (1.5.0-rc.0) as well as releases. */
  prerelease: boolean
  /** Read the project's repositories and the chosen one's tags, once per project. */
  ensure(org: string, project: string): Promise<void>
  setRepo(repoId: string | null): Promise<void>
  setPrerelease(on: boolean): void
}

export const useTagStore = create<TagState>((set, get) => ({
  scope: null,
  repos: null,
  repoId: null,
  tags: null,
  error: null,
  loading: false,
  prerelease: read(PRERELEASE_KEY) === '1',

  ensure: async (org, project) => {
    const scope = `${org}/${project}`
    if (get().scope === scope) return
    set({ scope, repos: null, repoId: null, tags: null, error: null, loading: true })
    try {
      const repos = (await api().prListRepos(org, project)).filter((r) => !r.isDisabled)
      if (get().scope !== scope) return
      const repo = defaultRepo(repos, project, read(repoKey(org, project)))
      set({ repos, repoId: repo?.id ?? null })
      await get().setRepo(repo?.id ?? null)
    } catch (e) {
      if (get().scope === scope) set({ loading: false, error: errorText(e) })
    }
  },

  setRepo: async (repoId) => {
    const scope = get().scope
    const org = useAppStore.getState().activeOrg
    if (!scope || !org) return
    write(repoKey(org, scope.slice(org.length + 1)), repoId)
    set({ repoId, tags: null, error: null, loading: !!repoId })
    if (!repoId) return
    try {
      const tags = tagVersions(await api().gitTags(org, repoId))
      if (get().scope === scope && get().repoId === repoId) set({ tags, loading: false })
    } catch (e) {
      if (get().scope === scope && get().repoId === repoId) set({ loading: false, error: errorText(e) })
    }
  },

  setPrerelease: (on) => {
    write(PRERELEASE_KEY, on ? '1' : null)
    set({ prerelease: on })
  },
}))

/** Tag versions to offer, following the pre-release switch. */
export const offeredTags = (s: Pick<TagState, 'tags' | 'prerelease'>): TagVersion[] => (s.tags ?? []).filter((t) => s.prerelease || !t.prerelease)
