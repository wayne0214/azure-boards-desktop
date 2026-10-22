import { htmlToText, shortDate } from './format'
import type { WorkItemType } from './types'

export interface FieldChange {
  field: string
  label: string
  from: string
  to: string
  /** Long text (description, repro steps…) is summarised as "edited" rather than shown in full. */
  longText?: boolean
}

export interface LinkChange {
  added: boolean
  label: string
}

export interface HistoryEntry {
  rev: number
  by: { displayName?: string; uniqueName?: string }
  date: string
  created: boolean
  commented: boolean
  changes: FieldChange[]
  links: LinkChange[]
}

// Bookkeeping fields that change with every revision and tell the reader nothing.
const NOISE = new Set([
  'System.Rev', 'System.AuthorizedDate', 'System.RevisedDate', 'System.ChangedDate', 'System.ChangedBy',
  'System.AuthorizedAs', 'System.PersonId', 'System.Watermark', 'System.CommentCount', 'System.History',
  'System.Id', 'System.AreaId', 'System.IterationId', 'System.NodeName', 'System.TeamProject',
  'System.AreaLevel1', 'System.AreaLevel2', 'System.AreaLevel3', 'System.AreaLevel4', 'System.AreaLevel5',
  'System.IterationLevel1', 'System.IterationLevel2', 'System.IterationLevel3', 'System.IterationLevel4',
  'Microsoft.VSTS.Common.StateChangeDate', 'Microsoft.VSTS.Common.ActivatedDate', 'Microsoft.VSTS.Common.ResolvedDate',
  'Microsoft.VSTS.Common.ClosedDate', 'System.BoardColumnDone', 'System.ExternalLinkCount', 'System.HyperLinkCount',
  'System.AttachedFileCount', 'System.RelatedLinkCount', 'System.RemoteLinkCount', 'System.Parent',
])

const LABELS: Record<string, string> = {
  'System.Title': 'Title',
  'System.State': 'State',
  'System.Reason': 'Reason',
  'System.AssignedTo': 'Assigned to',
  'System.IterationPath': 'Iteration',
  'System.AreaPath': 'Module',
  'System.Tags': 'Tags',
  'System.Description': 'Description',
  'System.BoardColumn': 'Board column',
  'System.BoardLane': 'Swimlane',
  'System.WorkItemType': 'Type',
  'Microsoft.VSTS.Common.Priority': 'Priority',
  'Microsoft.VSTS.Common.Severity': 'Severity',
  'Microsoft.VSTS.Common.AcceptanceCriteria': 'Acceptance criteria',
  'Microsoft.VSTS.TCM.ReproSteps': 'Repro steps',
  'Microsoft.VSTS.TCM.Steps': 'Steps',
  'Microsoft.VSTS.Scheduling.StoryPoints': 'Story points',
  'Microsoft.VSTS.Scheduling.Effort': 'Effort',
  'Microsoft.VSTS.Scheduling.RemainingWork': 'Remaining work',
  'Microsoft.VSTS.Scheduling.CompletedWork': 'Completed work',
  'Microsoft.VSTS.Scheduling.OriginalEstimate': 'Original estimate',
  'Microsoft.VSTS.Common.ActivatedBy': 'Activated by',
  'Microsoft.VSTS.Common.ResolvedBy': 'Resolved by',
  'Microsoft.VSTS.Common.ClosedBy': 'Closed by',
}

// Fields that skip the generic text path because their values say little on their own.
const QUIET = new Set(['Microsoft.VSTS.Common.ActivatedBy', 'Microsoft.VSTS.Common.ResolvedBy', 'Microsoft.VSTS.Common.ClosedBy'])

const ARTIFACT_LABELS: Record<string, string> = { Branch: 'branch', 'Pull Request': 'pull request', 'Fixed in Commit': 'commit', Build: 'build' }

/** A readable label for a field, from the process's own names first. */
export function fieldLabel(ref: string, types: WorkItemType[]): string {
  if (LABELS[ref]) return LABELS[ref]
  for (const t of types) {
    const d = t.fieldDefs?.find((x) => x.referenceName === ref)
    if (d) return d.name
  }
  const last = ref.split('.').pop() ?? ref
  return last.replace(/([a-z])([A-Z])/g, '$1 $2')
}

function isLongText(ref: string, fieldTypes: Record<string, string>, v: unknown): boolean {
  if (fieldTypes[ref] === 'html' || ref === 'Microsoft.VSTS.TCM.Steps') return true
  return typeof v === 'string' && (v.length > 120 || /<\/?[a-z][^>]*>/i.test(v))
}

/** One field value as short text. */
export function valueText(ref: string, v: unknown): string {
  if (v === undefined || v === null || v === '') return ''
  if (typeof v === 'object') {
    const o = v as { displayName?: string; uniqueName?: string }
    return o.displayName ?? o.uniqueName ?? ''
  }
  if (ref === 'System.IterationPath' || ref === 'System.AreaPath') {
    const parts = String(v).split('\\')
    return parts.length > 1 ? parts.slice(1).join(' › ') : String(v)
  }
  if (ref === 'Microsoft.VSTS.Common.Priority') return `P${v}`
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return shortDate(v)
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  return htmlToText(String(v))
}

function linkLabel(r: { rel?: string; url?: string; attributes?: { name?: string } }): string | null {
  const id = r.url?.split('/').pop()
  switch (r.rel) {
    case 'System.LinkTypes.Hierarchy-Forward': return `child #${id}`
    case 'System.LinkTypes.Hierarchy-Reverse': return `parent #${id}`
    case 'System.LinkTypes.Related': return `related #${id}`
    case 'AttachedFile': return `attachment ${r.attributes?.name ?? ''}`.trim()
    case 'Hyperlink': return `link ${r.url ?? ''}`.trim()
    case 'ArtifactLink': {
      const kind = ARTIFACT_LABELS[r.attributes?.name ?? ''] ?? 'development link'
      if (kind === 'branch') return `branch ${safeDecode((r.url ?? '').replace(/^.*%2FGB/i, ''))}`
      if (kind === 'pull request') return `pull request !${r.url?.split('%2F').pop() ?? ''}`
      return kind
    }
    default: {
      if (!r.rel || !id || !/^\d+$/.test(id)) return null
      // Affects, Tested By and the like: "Microsoft.VSTS.Common.TestedBy-Forward" → "tested by #12".
      const name = (r.rel.split('.').pop() ?? r.rel).replace(/-(Forward|Reverse)$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
      return `${name} #${id}`
    }
  }
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

type RawUpdate = {
  id?: number
  rev?: number
  revisedBy?: { displayName?: string; uniqueName?: string }
  revisedDate?: string
  fields?: Record<string, { oldValue?: unknown; newValue?: unknown }>
  relations?: { added?: unknown[]; removed?: unknown[] }
}

/** Turn Azure DevOps' raw update list into readable entries, newest first, leaving out revisions with nothing to show. */
export function buildHistory(raw: unknown[], types: WorkItemType[], fieldTypes: Record<string, string> = {}): HistoryEntry[] {
  const out: HistoryEntry[] = []
  for (const u of raw as RawUpdate[]) {
    const fields = u.fields ?? {}
    const rev = u.rev ?? u.id ?? 0
    // The newest update's revisedDate is the far-future sentinel; the change date is the real time.
    const changed = fields['System.ChangedDate']?.newValue
    const date = typeof changed === 'string' ? changed : (u.revisedDate && !u.revisedDate.startsWith('9999') ? u.revisedDate : '')
    const created = rev === 1
    const changes: FieldChange[] = []
    if (!created) {
      for (const [ref, ch] of Object.entries(fields)) {
        if (NOISE.has(ref) || QUIET.has(ref)) continue
        const longText = isLongText(ref, fieldTypes, ch.newValue ?? ch.oldValue)
        const from = longText ? '' : valueText(ref, ch.oldValue)
        const to = longText ? '' : valueText(ref, ch.newValue)
        if (!longText && from === to) continue
        changes.push({ field: ref, label: fieldLabel(ref, types), from, to, longText: longText || undefined })
      }
    }
    const links: LinkChange[] = []
    for (const [list, added] of [[u.relations?.added, true], [u.relations?.removed, false]] as const) {
      for (const r of list ?? []) {
        const label = linkLabel(r as Parameters<typeof linkLabel>[0])
        if (label) links.push({ added, label })
      }
    }
    const commented = 'System.History' in fields && !!fields['System.History']?.newValue
    if (!created && changes.length === 0 && links.length === 0 && !commented) continue
    out.push({ rev, by: u.revisedBy ?? {}, date, created, commented, changes, links })
  }
  return out.reverse()
}
