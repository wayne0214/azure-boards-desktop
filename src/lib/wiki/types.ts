/** An Azure DevOps wiki: the project wiki, or a code wiki published from a repository folder. */
export interface Wiki {
  id: string
  name: string
  type: 'projectWiki' | 'codeWiki'
  projectId: string
  repositoryId: string
  /** Code wikis: the branch they are published from. */
  versions?: { version: string }[]
  remoteUrl?: string
  /** Code wikis: the repository folder the wiki is published from, e.g. "/docs". */
  mappedPath?: string
}

/** A page in the tree; the root page has path "/". */
export interface WikiPageNode {
  path: string
  order?: number
  isParentPage?: boolean
  subPages?: WikiPageNode[]
}

export interface WikiPage {
  path: string
  content: string
  /** The page's ETag: sent back when saving, so a save never overwrites someone else's. */
  version: string | null
  remoteUrl?: string | null
}

export interface WikiSearchHit {
  wikiId: string | null
  wikiName: string | null
  path: string
  title: string
  snippet: string
}

export interface WikiSearchResult {
  /** False when only page titles were matched (Azure DevOps search was not available). */
  fullText: boolean
  results: WikiSearchHit[]
}

/** A page changed on the wiki's branch: the latest change to it, newest first. */
export interface WikiChange {
  path: string
  /** ISO time. */
  date: string
  author: string | null
  authorEmail: string | null
}

/** Filters for a live list of work items; the same as the AI tools' find_work_items. */
export interface ItemFilter {
  types?: string[]
  states?: string[]
  /** "current" for the team's current sprint, or an iteration path. */
  iteration?: string
  assignedToMe?: boolean
  text?: string
  /** YYYY-MM-DD */
  changedSince?: string
  limit?: number
}

export interface FoundItem {
  id: number
  type: string | null
  title: string | null
  state: string | null
  assignedTo: string | { displayName?: string } | null
  iteration: string | null
  key: string | null
  changed: string | null
}

export interface FoundItems {
  count: number
  truncated: boolean
  items: FoundItem[]
}
