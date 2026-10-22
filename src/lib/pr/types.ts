import type { IdentityRef } from '../types'

export interface Repo {
  id: string
  name: string
  defaultBranch?: string
  isDisabled?: boolean
  project?: { id: string; name: string }
  webUrl?: string
}

export interface Reviewer extends IdentityRef {
  id: string
  vote: number // 10 approved, 5 approved with suggestions, 0 none, -5 waiting, -10 rejected
  isRequired?: boolean
  isContainer?: boolean
  hasDeclined?: boolean
}

export interface PullRequest {
  pullRequestId: number
  codeReviewId?: number
  title: string
  description?: string
  status: 'active' | 'completed' | 'abandoned' | 'notSet'
  isDraft?: boolean
  createdBy: IdentityRef & { id: string }
  creationDate: string
  closedDate?: string
  sourceRefName: string
  targetRefName: string
  mergeStatus?: 'succeeded' | 'conflicts' | 'queued' | 'rejectedByPolicy' | 'failure' | 'notSet'
  repository: Repo
  reviewers: Reviewer[]
  lastMergeSourceCommit?: { commitId: string }
  lastMergeTargetCommit?: { commitId: string }
  lastMergeCommit?: { commitId: string }
  autoCompleteSetBy?: IdentityRef | null
  completionOptions?: CompletionOptions
  workItemRefs?: { id: string; url: string }[]
  url?: string
  supportsIterations?: boolean
  labels?: { name: string }[]
}

export interface CompletionOptions {
  mergeStrategy?: 'noFastForward' | 'squash' | 'rebase' | 'rebaseMerge'
  deleteSourceBranch?: boolean
  transitionWorkItems?: boolean
  mergeCommitMessage?: string
  bypassPolicy?: boolean
  bypassReason?: string
}

export interface Iteration {
  id: number
  description?: string
  createdDate: string
  sourceRefCommit: { commitId: string }
  targetRefCommit: { commitId: string }
  commonRefCommit?: { commitId: string }
  author?: IdentityRef
}

export interface ChangeEntry {
  changeTrackingId: number
  changeId: number
  changeType: string
  item: { path?: string; objectId?: string; originalObjectId?: string; gitObjectType?: string; isFolder?: boolean }
  originalPath?: string
}

export interface Comment {
  id: number
  parentCommentId?: number
  content?: string
  author: IdentityRef & { id?: string }
  publishedDate: string
  lastUpdatedDate?: string
  commentType: 'text' | 'system' | 'codeChange' | 'unknown'
  isDeleted?: boolean
  usersLiked?: IdentityRef[]
}

export interface Thread {
  id: number
  status?: 'active' | 'fixed' | 'wontFix' | 'closed' | 'byDesign' | 'pending' | 'unknown'
  publishedDate: string
  lastUpdatedDate?: string
  comments: Comment[]
  isDeleted?: boolean
  threadContext?: {
    filePath: string
    leftFileStart?: { line: number; offset: number }
    leftFileEnd?: { line: number; offset: number }
    rightFileStart?: { line: number; offset: number }
    rightFileEnd?: { line: number; offset: number }
  } | null
  pullRequestThreadContext?: { iterationContext?: { firstComparingIteration: number; secondComparingIteration: number }; changeTrackingId?: number } | null
  properties?: Record<string, { $type: string; $value: unknown }>
}

export interface PrDetail {
  pr: PullRequest
  iterations: Iteration[]
  threads: Thread[]
  commits: { commitId: string; comment: string; author?: { name: string; date: string }; committer?: { name: string; date: string } }[]
  workItems: { id: string; url: string }[]
  statuses: { id: number; state: string; description?: string; context: { name: string; genre?: string }; targetUrl?: string; creationDate: string }[]
  policies: { evaluationId: string; status: string; configuration?: { type?: { displayName?: string }; settings?: Record<string, unknown>; isBlocking?: boolean } }[]
}

/** A work item found for a new pull request, and how it was found. */
export type BranchWorkItem = import('../types').WorkItem & { linkedVia: ('branch' | 'commit' | 'mention')[] }

export const VOTE_LABEL: Record<number, string> = {
  10: 'Approved',
  5: 'Approved with suggestions',
  0: 'No vote',
  [-5]: 'Waiting for author',
  [-10]: 'Rejected',
}

export function branchName(ref: string | undefined): string {
  return (ref ?? '').replace(/^refs\/heads\//, '')
}
