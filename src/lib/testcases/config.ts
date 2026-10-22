import { customFieldsFor, fieldKind, idLikeField, verificationMethodField } from '../customFields'
import { reqConfig } from '../requirements'
import type { FieldDef, TeamContext, WorkItem, WorkItemType } from '../types'

export interface TcConfig {
  type: WorkItemType
  sharedStepsType?: WorkItemType
  sdvField?: FieldDef
  /** Custom html "Preconditions" field, else System.Description. */
  preconditionsField: FieldDef
  lastOutcomeField?: FieldDef
  lastReleaseField?: FieldDef
  /** "Verification Method" picklist on the SRS type. */
  methodField?: FieldDef
  /** Fields to fetch beyond the standard set. */
  extraFields: string[]
}

export const STEPS = 'Microsoft.VSTS.TCM.Steps'
const PARAMETERS = 'Microsoft.VSTS.TCM.Parameters'
const LOCAL_DATA = 'Microsoft.VSTS.TCM.LocalDataSource'
/** Test case → SRS. */
export const TESTS_LINK = 'Microsoft.VSTS.Common.TestedBy-Reverse'
/** SRS → test case. */
export const TESTED_BY_LINK = 'Microsoft.VSTS.Common.TestedBy-Forward'

/** Work out the Test Case fields from the project's process; null if it has no enabled Test Case type. */
export function tcConfig(ctx: TeamContext | null): TcConfig | null {
  if (!ctx) return null
  const byName = (n: string) => ctx.workItemTypes.find((t) => t.name === n && !t.isDisabled)
  const type = byName('Test Case')
  if (!type) return null
  const fields = customFieldsFor(type)
  const named = (re: RegExp, html = false) => fields.find((f) => re.test(f.name) && (!html || fieldKind(ctx, f) === 'html'))
  const sdvField = idLikeField(type)
  const preconditionsField = named(/precondition/i, true) ?? { referenceName: 'System.Description', name: 'Description' }
  const lastOutcomeField = named(/last outcome/i)
  const lastReleaseField = named(/last tested release|last release/i)
  const methodField = verificationMethodField(reqConfig(ctx)?.tiers[2].type)
  const extraFields = [...new Set([
    sdvField?.referenceName, preconditionsField.referenceName,
    lastOutcomeField?.referenceName, lastReleaseField?.referenceName, methodField?.referenceName,
    STEPS, PARAMETERS, LOCAL_DATA,
  ].filter((x): x is string => !!x))]
  return { type, sharedStepsType: byName('Shared Steps'), sdvField, preconditionsField, lastOutcomeField, lastReleaseField, methodField, extraFields }
}

/** Whether an SRS counts toward test coverage: no Verification Method field, an empty value, or "Test". */
export function needsTest(cfg: TcConfig, srs: WorkItem): boolean {
  if (!cfg.methodField) return true
  const v = srs.fields[cfg.methodField.referenceName]
  return v == null || v === '' || v === 'Test'
}
