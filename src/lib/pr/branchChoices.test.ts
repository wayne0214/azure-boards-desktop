import { describe, expect, it } from 'vitest'
import { branchChoices, type BranchInfo } from './branchChoices'

const b = (name: string, extra: Partial<BranchInfo> = {}): BranchInfo => ({ name: `refs/heads/${name}`, objectId: name, ...extra })
const branches = [
  b('feature/old', { aheadCount: 0, lastCommitDate: '2026-01-01T00:00:00Z' }),
  b('feature/new', { aheadCount: 3, lastCommitDate: '2026-11-03T00:00:00Z' }),
  b('develop', { aheadCount: 0, lastCommitDate: '2026-11-02T00:00:00Z' }),
  b('master', { aheadCount: 0, isBaseVersion: true, lastCommitDate: '2026-10-30T00:00:00Z' }),
  b('bugfix/mid', { aheadCount: 1, lastCommitDate: '2026-10-15T00:00:00Z' }),
  b('release/1.5.0', { aheadCount: 0, lastCommitDate: '2026-09-01T00:00:00Z' }),
]
const short = (names: string[]) => names.map((n) => n.replace('refs/heads/', ''))

describe('branchChoices', () => {
  it('hides merged branches and lists the default, long-lived, then newest first', () => {
    const r = branchChoices(branches, { showMerged: false })
    expect(short(r.names)).toEqual(['master', 'develop', 'feature/new', 'bugfix/mid'])
    expect(r.mergedCount).toBe(2)
  })

  it('shows merged branches when asked', () => {
    expect(short(branchChoices(branches, { showMerged: true }).names)).toEqual(['master', 'develop', 'feature/new', 'bugfix/mid', 'release/1.5.0', 'feature/old'])
  })

  it('keeps a merged branch that is already chosen', () => {
    expect(short(branchChoices(branches, { showMerged: false, keep: ['refs/heads/feature/old'] }).names)).toContain('feature/old')
  })

  it('hides nothing when Azure DevOps gave no figures', () => {
    const plain = [b('zeta'), b('alpha'), b('main')]
    const r = branchChoices(plain, { showMerged: false })
    expect(short(r.names)).toEqual(['main', 'alpha', 'zeta'])
    expect(r.mergedCount).toBe(0)
  })
})
