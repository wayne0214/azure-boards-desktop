import { create } from 'zustand'
import { isTauri } from '@/lib/api'
import { mcpImportApply, mcpImportDiscard, mcpImportReview, mcpImports, type ImportInfo, type ImportPick } from '@/lib/mcp'
import { demoImportCalls } from './demo'

/** Staged imports from the app, or sample ones in the browser demo. Calls resolve lazily (mcp.ts imports this store). */
export const importCalls = {
  list: () => (isTauri ? mcpImports() : demoImportCalls.list()),
  review: (id: string) => (isTauri ? mcpImportReview(id) : demoImportCalls.review(id)),
  apply: (id: string, picks: ImportPick[]) => (isTauri ? mcpImportApply(id, picks) : demoImportCalls.apply(id, picks)),
  discard: (id: string) => (isTauri ? mcpImportDiscard(id) : demoImportCalls.discard(id)),
}

interface ImportState {
  list: ImportInfo[]
  selectedId: string | null
  load: () => Promise<void>
  select: (id: string | null) => void
}

export const pendingImports = (list: ImportInfo[]) => list.filter((i) => i.status === 'pending').length

export const useImportStore = create<ImportState>((set, get) => ({
  list: [],
  selectedId: null,
  load: async () => {
    try {
      const list = await importCalls.list()
      const sel = get().selectedId
      set({ list, selectedId: sel && list.some((i) => i.id === sel) ? sel : list.find((i) => i.status === 'pending')?.id ?? null })
    } catch {
      // The list is a convenience; the MCP server reports its own errors.
    }
  },
  select: (selectedId) => set({ selectedId }),
}))
