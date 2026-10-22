import { describe, expect, it } from 'vitest'
import { branchNameProblem, branchSlug, devLinks, startState, suggestBranchName } from './startWork'
import type { WorkItem, WorkItemType } from './types'

describe('suggestBranchName', () => {
  it('uses feature/ for stories and bugfix/ for bugs', () => {
    expect(suggestBranchName(1164, 'User Story', 'Secure upload resumes after network drop')).toBe('feature/1164-secure-upload-resumes-after-network-drop')
    expect(suggestBranchName(1183, 'Bug', 'Angle overlay drifts after device rotation on Android 14')).toBe('bugfix/1183-angle-overlay-drifts-after-device')
  })

  it('does not end on a filler word', () => {
    expect(suggestBranchName(1192, 'Feature', 'Camera guides the patient into the correct pose')).toBe('feature/1192-camera-guides-the-patient')
  })

  it('strips accents and punctuation', () => {
    expect(branchSlug('Café: “résumé” upload — v2!')).toBe('cafe-resume-upload-v2')
  })

  it('falls back to the id alone when the title has no usable characters', () => {
    expect(suggestBranchName(7, 'Task', '!!!')).toBe('feature/7')
  })

  it('always produces a valid name', () => {
    for (const t of ['..hidden', 'a/b\\c', 'x.lock', '-dash', 'emoji 🚀 title']) {
      expect(branchNameProblem(suggestBranchName(1, 'Task', t))).toBeNull()
    }
  })
})

describe('branchNameProblem', () => {
  it.each(['', 'has space', 'a..b', 'end/', 'x.lock', '-x', 'a:b', 'a/.hidden', 'a@{b', 'a//b'])('rejects %j', (n) => {
    expect(branchNameProblem(n)).not.toBeNull()
  })
  it('accepts normal names', () => {
    expect(branchNameProblem('feature/12-login')).toBeNull()
  })
})

describe('startState', () => {
  const wit: WorkItemType = { name: 'User Story', referenceName: 'x', color: '0', states: [
    { name: 'New', color: '0', category: 'Proposed' },
    { name: 'Active', color: '0', category: 'InProgress' },
    { name: 'Closed', color: '0', category: 'Completed' },
  ] }
  it('moves a new item to the first in-progress state', () => expect(startState(wit, 'New')).toBe('Active'))
  it('leaves started items alone', () => {
    expect(startState(wit, 'Active')).toBeNull()
    expect(startState(wit, 'Closed')).toBeNull()
  })
})

describe('devLinks', () => {
  it('reads branch and pull request links', () => {
    const item: WorkItem = { id: 1, rev: 1, fields: {}, relations: [
      { rel: 'ArtifactLink', url: 'vstfs:///Git/Ref/p1%2Fr1%2FGBfeature%2F1-login', attributes: { name: 'Branch' } },
      { rel: 'ArtifactLink', url: 'vstfs:///Git/PullRequestId/p1%2Fr1%2F42', attributes: { name: 'Pull Request' } },
      { rel: 'System.LinkTypes.Related', url: 'https://x/_apis/wit/workItems/5' },
    ] }
    expect(devLinks(item)).toEqual([
      { kind: 'branch', projectId: 'p1', repoId: 'r1', name: 'feature/1-login' },
      { kind: 'pr', projectId: 'p1', repoId: 'r1', prId: 42 },
    ])
  })
})
