import { useMemo } from 'react'
import { buildTree, idOf, plainText, type ReqTree } from '@/lib/requirements'
import { srsLinks } from '@/lib/testcases/coverage'
import type { CaseInfo, ReqInfo } from '@/lib/testplans/report'
import type { WorkItem } from '@/lib/types'
import { useBoardStore } from '@/store/useBoardStore'
import { useReqStore } from '@/store/useReqStore'
import { useTcStore } from '@/store/useTcStore'

const EMPTY_TREE: ReqTree = { roots: [], orphanDis: [], orphanSrs: [], byId: new Map() }

export interface PlanLookups {
  tree: ReqTree
  /** Test cases loaded for the project, by id. */
  tests: Map<number, WorkItem>
  cases: Map<number, CaseInfo>
  reqs: Map<number, ReqInfo>
  /** SDV ID (upper case) → test case id, for matching automated results. */
  keyToId: Map<string, number>
  /** "SDV-0001" or "#1301". */
  label: (testCaseId: number) => string
}

/** What the Test Plans view knows about the project's test cases and requirements, from the Test Cases and Requirements stores. */
export function usePlanLookups(): PlanLookups {
  const ctx = useBoardStore((s) => s.ctx)
  const req = useReqStore()
  const tcCfg = useTcStore((s) => s.cfg)
  const tcTests = useTcStore((s) => s.tests)
  const tree = useMemo(() => (req.cfg ? buildTree(req.cfg, ctx?.workItemTypes ?? [], req.items, req.bugs, req.tasks, req.changes) : EMPTY_TREE), [req.cfg, ctx, req.items, req.bugs, req.tasks, req.changes])
  return useMemo(() => {
    const sdvRef = tcCfg?.sdvField?.referenceName
    const tests = new Map(tcTests.map((t) => [t.id, t]))
    const cases = new Map<number, CaseInfo>()
    const keyToId = new Map<string, number>()
    for (const t of tcTests) {
      const sdv = sdvRef ? plainText(t.fields[sdvRef]).trim() : ''
      cases.set(t.id, { label: sdv || `#${t.id}`, srsIds: srsLinks(t) })
      if (sdv) keyToId.set(sdv.toUpperCase(), t.id)
    }
    const reqs = new Map<number, ReqInfo>()
    for (const [id, n] of tree.byId) reqs.set(id, { label: idOf(n) || `#${id}`, title: String(n.item.fields['System.Title'] ?? '') })
    return { tree, tests, cases, reqs, keyToId, label: (id: number) => cases.get(id)?.label ?? `#${id}` }
  }, [tcCfg, tcTests, tree])
}
