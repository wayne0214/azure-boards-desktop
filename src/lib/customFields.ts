import type { FieldDef, TeamContext, WorkItemType } from './types'

/** Fields the standard inspector already renders, so they are not repeated as custom fields. */
const handled = new Set([
  'System.Title', 'System.State', 'System.Reason', 'System.AssignedTo', 'System.IterationPath', 'System.AreaPath', 'System.Tags',
  'System.Description', 'System.WorkItemType', 'System.TeamProject', 'System.Id', 'System.Rev', 'System.CreatedBy', 'System.CreatedDate',
  'System.ChangedBy', 'System.ChangedDate', 'System.History', 'System.Parent', 'System.BoardColumn', 'System.BoardColumnDone', 'System.BoardLane',
  'Microsoft.VSTS.Common.Priority', 'Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.Effort', 'Microsoft.VSTS.Scheduling.Size',
  'Microsoft.VSTS.Scheduling.RemainingWork', 'Microsoft.VSTS.Common.AcceptanceCriteria', 'Microsoft.VSTS.TCM.ReproSteps',
])

/**
 * Fields worth showing for a type beyond the standard set: anything the process added
 * (reference names starting with "Custom."), plus any other field the process marks as required.
 */
export function customFieldsFor(type: WorkItemType | undefined): FieldDef[] {
  if (!type?.fieldDefs) return []
  return type.fieldDefs.filter((f) => {
    if (handled.has(f.referenceName)) return false
    if (f.referenceName.startsWith('Custom.')) return true
    if (f.alwaysRequired && !f.referenceName.startsWith('System.') && !f.referenceName.startsWith('Microsoft.VSTS.')) return true
    return false
  })
}

export function allCustomFieldRefs(ctx: TeamContext | null, typeNames: string[]): string[] {
  if (!ctx) return []
  const out = new Set<string>()
  for (const t of ctx.workItemTypes) {
    if (!typeNames.includes(t.name)) continue
    for (const f of customFieldsFor(t)) out.add(f.referenceName)
  }
  return [...out]
}

export type FieldKind = 'text' | 'number' | 'picklist' | 'bool' | 'date' | 'html' | 'identity'

export function fieldKind(ctx: TeamContext | null, def: FieldDef): FieldKind {
  if (def.allowedValues && def.allowedValues.length > 0) return 'picklist'
  if (def.isIdentity) return 'identity'
  const t = ctx?.fieldTypes?.[def.referenceName] ?? 'string'
  switch (t) {
    case 'integer':
    case 'double':
      return 'number'
    case 'boolean':
      return 'bool'
    case 'dateTime':
      return 'date'
    case 'html':
      return 'html'
    case 'identity':
      return 'identity'
    default:
      return 'text'
  }
}

export function isIdLike(f: FieldDef): boolean {
  return /\b(id|no|number|ref|code)\b/i.test(f.name) && !/description/i.test(f.name) && !(f.allowedValues && f.allowedValues.length > 0)
}

/** Key fields that win when a type still carries an older ID field next to them (same list as fields.rs). */
const KEY_NAMES = ['needs id', 'system requirement specification id', 'subsystem requirement specification id']

/** The type's key: a short identifier-like field (e.g. "Needs ID", "SRS ID") shown on cards and used to find items. */
export function idLikeField(type: WorkItemType | undefined): FieldDef | undefined {
  const ids = customFieldsFor(type).filter(isIdLike)
  return ids.find((f) => KEY_NAMES.includes(f.name.trim().toLowerCase())) ?? ids[0]
}

export interface InspectorFields {
  /** The type's key (e.g. "Needs ID"), shown with the write-up it identifies rather than in the property grid. */
  key?: FieldDef
  /** Short fields for the property grid: required fields and those with a value. */
  rows: FieldDef[]
  /** Plain-text write-ups, shown full width like Description. */
  text: FieldDef[]
  /** Rich-text fields, each with its own section. */
  rich: FieldDef[]
  /** Empty optional fields, kept out of the way until asked for. */
  hidden: FieldDef[]
}

const LONG_VALUE = 60
const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')

/** Where each of the type's custom fields goes in the inspector, given the item's values. */
export function inspectorFields(ctx: TeamContext | null, type: WorkItemType | undefined, values: Record<string, unknown>): InspectorFields {
  const key = idLikeField(type)
  const out: InspectorFields = { key, rows: [], text: [], rich: [], hidden: [] }
  for (const d of customFieldsFor(type)) {
    const kind = fieldKind(ctx, d)
    const v = values[d.referenceName]
    if (d === key) continue
    if (kind === 'html') out.rich.push(d)
    else if (kind === 'text' && !isIdLike(d) && isWriteUp(ctx, d, v)) out.text.push(d)
    else if (d.alwaysRequired || !isEmpty(v)) out.rows.push(d)
    else out.hidden.push(d)
  }
  return out
}

/** A text field that holds prose: named like one, or carrying a long or multi-line value. */
function isWriteUp(ctx: TeamContext | null, d: FieldDef, v: unknown): boolean {
  if (/description|specification|\bspec\b|statements?/i.test(d.name)) return true
  if (isEmpty(v)) return false
  const s = String(v)
  return ctx?.fieldTypes?.[d.referenceName] === 'plainText' || s.length > LONG_VALUE || s.includes('\n')
}

/** Main text fields that win when a type still carries an older one next to them; these may be plain text. */
const TEXT_NAMES = ['user needs and stakeholder needs statements', 'system requirement specification', 'subsystem and component level requirement specification']

/** The type's own long-text field (e.g. "Software Requirement Specification", "User Need Description"). */
export function descriptionField(ctx: TeamContext | null, type: WorkItemType | undefined): FieldDef | undefined {
  const defs = customFieldsFor(type)
  const kindOf = (f: FieldDef) => fieldKind(ctx, f)
  const current = defs.find((f) => TEXT_NAMES.includes(f.name.trim().toLowerCase()) && (kindOf(f) === 'html' || kindOf(f) === 'text'))
  if (current) return current
  const html = defs.filter((f) => kindOf(f) === 'html')
  return html.find((f) => /description|specification|\bspec\b/i.test(f.name)) ?? html[0]
}

export const REPRO_STEPS = 'Microsoft.VSTS.TCM.ReproSteps'

/** Bugs (and any type with Repro Steps) keep their write-up there; Azure DevOps hides Description on their form. */
export function usesReproSteps(type: WorkItemType | undefined): boolean {
  if (!type) return false
  return type.name === 'Bug' || !!type.fieldDefs?.some((f) => f.referenceName === REPRO_STEPS)
}

export const ACCEPTANCE_CRITERIA = 'Microsoft.VSTS.Common.AcceptanceCriteria'

/**
 * The type's Acceptance Criteria field, as the process names it (e.g. "User Acceptance Criteria").
 * Azure DevOps leaves empty fields out of a work item, so this comes from the type, not the item.
 */
export function acceptanceField(type: WorkItemType | undefined): FieldDef | undefined {
  const own = type?.fieldDefs?.find((f) => f.referenceName === ACCEPTANCE_CRITERIA)
  if (own) return own
  return type && ['User Story', 'Product Backlog Item'].includes(type.name) ? { referenceName: ACCEPTANCE_CRITERIA, name: 'Acceptance Criteria' } : undefined
}

/** The type's "Symptom" field: CMMI's Microsoft.VSTS.CMMI.Symptom or a custom one with that name. */
export function symptomField(type: WorkItemType | undefined): FieldDef | undefined {
  return type?.fieldDefs?.find((f) => f.referenceName === 'Microsoft.VSTS.CMMI.Symptom' || /^symptoms?$/i.test(f.name.trim()))
}

/** The requirement type's "Verification Method" picklist (Test, Inspection, Analysis, Demonstration). */
export function verificationMethodField(type: WorkItemType | undefined): FieldDef | undefined {
  return type?.fieldDefs?.find((f) => /verification method/i.test(f.name) && !!f.allowedValues?.length)
}
