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
