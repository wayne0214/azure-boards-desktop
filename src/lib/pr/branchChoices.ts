/** Which branches a branch picker offers, and in what order. */

export interface BranchInfo {
  name: string
  objectId: string
  /** Commits not yet in the default branch; 0 means everything on it is merged. Missing when Azure DevOps did not say. */
  aheadCount?: number
  behindCount?: number
  /** True for the default branch. */
  isBaseVersion?: boolean
  lastCommitDate?: string
}

// Long-lived branches stay listed even when they have nothing the default branch lacks (develop right after a back-merge).
const LONG_LIVED = /^refs\/heads\/(main|master|develop|dev)$/

const isMerged = (b: BranchInfo) => b.aheadCount === 0 && !b.isBaseVersion && !LONG_LIVED.test(b.name)

/**
 * The default branch, then main/master/develop, then the rest with the newest commit first. Branches already merged
 * into the default branch are left out unless `showMerged`, apart from those in `keep` (the current choices).
 */
export function branchChoices(branches: BranchInfo[], opts: { showMerged: boolean; keep?: string[] }): { names: string[]; mergedCount: number } {
  const keep = new Set((opts.keep ?? []).filter(Boolean))
  const merged = branches.filter(isMerged)
  const shown = opts.showMerged ? branches : branches.filter((b) => !isMerged(b) || keep.has(b.name))
  const rank = (b: BranchInfo) => (b.isBaseVersion ? 0 : LONG_LIVED.test(b.name) ? 1 : 2)
  const time = (b: BranchInfo) => (b.lastCommitDate ? Date.parse(b.lastCommitDate) || 0 : 0)
  const names = [...shown]
    .sort((a, b) => rank(a) - rank(b) || time(b) - time(a) || a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    .map((b) => b.name)
  return { names, mergedCount: merged.length }
}
