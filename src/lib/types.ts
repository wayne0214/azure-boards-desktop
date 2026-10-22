export interface Account {
  org: string
  userId: string
  userName: string
  addedAt?: string
}

export interface RecentTarget {
  org: string
  projectId: string
  projectName: string
  teamId: string | null
  teamName: string | null
  boardId: string | null
}

export interface Settings {
  accounts: Account[]
  activeOrg: string | null
  recent: RecentTarget[]
  pinnedProjects: string[]
}

export interface ConnectionInfo {
  userId: string
  userName: string
}

export interface Project {
  id: string
  name: string
  description?: string | null
  state?: string | null
  lastUpdateTime?: string | null
}

export interface Team {
  id: string
  name: string
  description?: string | null
  projectId?: string | null
}

export interface BoardRef {
  id: string
  name: string
}

export interface BoardColumn {
  id: string
  name: string
  itemLimit: number
  stateMappings: Record<string, string>
  columnType: 'incoming' | 'inProgress' | 'outgoing'
  isSplit?: boolean
  description?: string
}

export interface Board {
  id: string
  name: string
  columns: BoardColumn[]
  rows: { id: string | null; name: string | null }[]
  fields: {
    columnField?: { referenceName: string }
    rowField?: { referenceName: string }
    doneField?: { referenceName: string }
  }
  allowedMappings: Record<string, Record<string, string[]>>
  canEdit?: boolean
  /** Built by the app for a type that has no Kanban board (Bug, Task, Issue...). Columns are states. */
  virtual?: boolean
}

export interface Iteration {
  id: string
  name: string
  path: string
  attributes?: { startDate?: string | null; finishDate?: string | null; timeFrame?: 'past' | 'current' | 'future' }
}

export interface WorkItemTypeState {
  name: string
  color: string
  category: 'Proposed' | 'InProgress' | 'Resolved' | 'Completed' | 'Removed'
}

export interface FieldDef {
  referenceName: string
  name: string
  alwaysRequired?: boolean
  allowedValues?: string[]
  defaultValue?: string | null
  helpText?: string
  isIdentity?: boolean
}

export interface WorkItemType {
  name: string
  referenceName: string
  description?: string
  color: string
  icon?: { id: string; url: string }
  states: WorkItemTypeState[]
  isDisabled?: boolean
  fieldDefs?: FieldDef[]
}

export interface Identity {
  id: string
  displayName: string
  uniqueName?: string | null
  imageUrl?: string | null
}

export interface IdentityRef {
  id?: string
  displayName: string
  uniqueName?: string
  imageUrl?: string
  descriptor?: string
}

export interface WorkItemRelation {
  rel: string
  url: string
  attributes?: Record<string, unknown>
}

export interface WorkItem {
  id: number
  rev: number
  url?: string
  fields: Record<string, unknown> & {
    'System.Title'?: string
    'System.State'?: string
    'System.WorkItemType'?: string
    'System.AssignedTo'?: IdentityRef
    'System.CreatedBy'?: IdentityRef
    'System.ChangedBy'?: IdentityRef
    'System.CreatedDate'?: string
    'System.ChangedDate'?: string
    'System.IterationPath'?: string
    'System.AreaPath'?: string
    'System.Tags'?: string
    'System.TeamProject'?: string
    'System.BoardColumn'?: string
    'System.BoardColumnDone'?: boolean
    'System.Parent'?: number
    'System.Description'?: string
    'System.CommentCount'?: number
    'Microsoft.VSTS.Common.Priority'?: number
    'Microsoft.VSTS.Scheduling.StoryPoints'?: number
    'Microsoft.VSTS.Scheduling.Effort'?: number
    'Microsoft.VSTS.Scheduling.RemainingWork'?: number
    'Microsoft.VSTS.Common.AcceptanceCriteria'?: string
    'Microsoft.VSTS.TCM.ReproSteps'?: string
  }
  relations?: WorkItemRelation[]
}

export interface Comment {
  id: number
  text: string
  createdBy: IdentityRef
  createdDate: string
  modifiedDate?: string
}

export interface TeamContext {
  iterations: Iteration[]
  settings: { backlogIteration?: { id: string; name: string; path: string }; defaultIteration?: { id: string; name: string; path: string } | null } | null
  workItemTypes: WorkItemType[]
  members: Identity[]
  tags: string[]
  fieldTypes: Record<string, string>
}

export interface BoardQuery {
  project: string
  team: string
  types: string[]
  doneStates: string[]
  doneDays: number
  extraFields: string[]
  iterationPath?: string | null
}

export interface AppError {
  kind:
    | 'unauthorized'
    | 'forbidden'
    | 'not_found'
    | 'conflict'
    | 'rate_limited'
    | 'network'
    | 'validation'
    | 'storage'
    | 'internal'
  message: string
  status?: number
}

export interface CsvData {
  headers: string[]
  rows: string[][]
}

export interface ImportRow {
  work_item_type: string
  fields: Record<string, unknown>
  parent_id: number | null
}

export interface ImportResult {
  index: number
  id: number | null
  error: string | null
}

export interface CacheEntry<T = unknown> {
  value: T
  updatedAt: number
}

export function isAppError(e: unknown): e is AppError {
  return typeof e === 'object' && e !== null && 'kind' in e && 'message' in e
}

export function errorMessage(e: unknown): string {
  if (isAppError(e)) return e.message
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  return 'Something went wrong.'
}
