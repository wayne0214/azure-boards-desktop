import { linkedIds, type ReqNode, type ReqTree } from '../requirements'
import type { WorkItem, WorkItemType } from '../types'
import { needsTest, STEPS, TESTS_LINK, type TcConfig } from './config'
import { parseSteps } from './steps'

export interface SrsCoverage { node: ReqNode; method: string | null; needsTest: boolean; tests: WorkItem[]; removed: boolean }
export interface Coverage {
  /** Every SRS in the requirement tree. */
  bySrs: Map<number, SrsCoverage>
  /** Test cases with no live SRS link. */
  unlinked: WorkItem[]
  stats: { needingTest: number; covered: number; noMethod: number }
}
export type TcFilter = 'all' | 'uncovered' | 'review' | 'nosteps' | 'mine'

/** SRS ids a test case is linked to. */
export const srsLinks = (t: WorkItem): number[] => linkedIds(t, [TESTS_LINK])

export const hasSteps = (t: WorkItem): boolean => parseSteps(t.fields[STEPS] as string | undefined).length > 0

function isRemoved(types: WorkItemType[], item: WorkItem): boolean {
  const st = types.find((x) => x.name === item.fields['System.WorkItemType'])?.states.find((s) => s.name === item.fields['System.State'])
  return st ? st.category === 'Removed' : /^removed$/i.test(String(item.fields['System.State']))
}

/** Which SRS are covered by which test cases; Removed SRS never need a test, Removed test cases are left out. */
export function buildCoverage(cfg: TcConfig, types: WorkItemType[], tree: ReqTree, tests: WorkItem[]): Coverage {
  const bySrs = new Map<number, SrsCoverage>()
  for (const node of tree.byId.values()) {
    if (node.tier.level !== 2) continue
    const raw = cfg.methodField ? String(node.item.fields[cfg.methodField.referenceName] ?? '').trim() : ''
    const removed = isRemoved(types, node.item)
    bySrs.set(node.item.id, { node, method: raw || null, needsTest: !removed && needsTest(cfg, node.item), tests: [], removed })
  }
  const unlinked: WorkItem[] = []
  // A removed test case verifies nothing.
  for (const t of tests.filter((x) => !isRemoved(types, x))) {
    const live = [...new Set(srsLinks(t))].map((id) => bySrs.get(id)).filter((c): c is SrsCoverage => !!c && !c.removed)
    if (live.length === 0) unlinked.push(t)
    for (const c of live) c.tests.push(t)
  }
  const all = [...bySrs.values()]
  const needing = all.filter((c) => c.needsTest)
  return {
    bySrs,
    unlinked,
    stats: {
      needingTest: needing.length,
      covered: needing.filter((c) => c.tests.length > 0).length,
      noMethod: cfg.methodField ? all.filter((c) => !c.removed && !c.method).length : 0,
    },
  }
}
