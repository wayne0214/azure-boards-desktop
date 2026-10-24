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

/** A short identifier-like field (e.g. "UN ID", "SRS ID") suitable for showing on a card. */
export function idLikeField(type: WorkItemType | undefined): FieldDef | undefined {
  return customFieldsFor(type).find(isIdLike)
}

/** The type's own long-text field (e.g. "Software Requirement Specification", "User Need Description"). */
export function descriptionField(ctx: TeamContext | null, type: WorkItemType | undefined): FieldDef | undefined {
  const html = customFieldsFor(type).filter((f) => fieldKind(ctx, f) === 'html')
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
