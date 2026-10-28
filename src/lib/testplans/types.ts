/** Azure Test Plans, as the backend trims it (see src-tauri/src/ado/plans.rs). */

export interface TpPlan {
  id: number
  name: string
  /** "Active" or "Inactive". */
  state: string
  iteration: string
  areaPath: string
  rootSuiteId: number
  startDate?: string
  endDate?: string
  owner?: string
  updatedDate?: string
}

export type SuiteType = 'staticTestSuite' | 'requirementTestSuite' | 'dynamicTestSuite'

export interface TpSuite {
  id: number
  name: string
  parentId?: number
  suiteType: SuiteType
  requirementId?: number
  /** A tag-based suite's tag. */
  tag?: string
}

export interface TpConfiguration {
  id: number
  name: string
  isDefault: boolean
}

export interface TpPerson {
  id: string
  displayName: string
  uniqueName?: string
}

export interface TpPoint {
  id: number
  suiteId: number
  testCaseId: number
  testCaseTitle: string
  configurationId: number
  configurationName: string
  tester?: TpPerson
  /** As Azure DevOps sends it: "passed", "failed", "blocked", "notApplicable", "unspecified"… */
  outcome: string
  isAutomated: boolean
  lastRunId?: number
  lastResultId?: number
  lastRunDate?: string
  lastRunBy?: string
}

export interface TpRun {
  id: number
  name: string
  /** The version the run tested (its build number). */
  buildNumber?: string
  state: string
  isAutomated: boolean
  completedDate?: string
  totalTests: number
  passedTests: number
}

export interface TpResult {
  runId: number
  resultId: number
  pointId: number
  /** Lower camel case like a point's outcome. */
  outcome: string
  completedDate?: string
  runBy?: string
  errorMessage?: string
}

/** One recorded test result, from any run (automated or manual), as Azure Test Plans keeps it. */
export interface TestResultSummary {
  runId: number
  runName: string
  resultId: number
  testCaseId: number
  testCaseTitle: string
  pointId?: number
  planId?: number
  /** Lower camel case as recorded: "passed", "failed", "notExecuted"… */
  outcome: string
  completedDate?: string
  durationMs?: number
  configuration?: string
  isAutomated: boolean
  runBy?: string
  errorMessage?: string
}

/** A step's result; `stepId` is the test case step's id ("2"), or "compref id;step id" inside shared steps. */
export interface StepResult {
  stepId: string
  outcome: string
  durationMs?: number
  errorMessage?: string
  comment?: string
}

export interface ResultAttachment {
  id: number
  fileName: string
  size: number
  comment?: string
  /** How the app can show it, from the file name. */
  kind: 'image' | 'text' | 'file'
}

export interface TestResultDetail extends TestResultSummary {
  stackTrace?: string
  comment?: string
  automatedTestName?: string
  startedDate?: string
  /** Step results of the first iteration. */
  steps: StepResult[]
  iterations: number
  attachments: ResultAttachment[]
  attachmentsError?: string
  runUrl?: string
}

export interface ResultQuery {
  testCaseId?: number
  planId?: number
  runId?: number
  outcome?: string
  limit?: number
}

/** Outcomes a person can set on a point; "reset" makes it not run again. */
export type Markable = 'passed' | 'failed' | 'blocked' | 'notApplicable' | 'reset'

/** Outcome of a published result, as the test results API spells it. */
export type ResultOutcome = 'Passed' | 'Failed' | 'Blocked' | 'NotApplicable' | 'NotExecuted' | 'Inconclusive'

export interface PointResultInput {
  pointId: number
  outcome: ResultOutcome
  comment?: string
  errorMessage?: string
  stackTrace?: string
  durationMs?: number
  automatedTestName?: string
  automatedTestStorage?: string
  attachments?: { name: string; dataBase64: string }[]
  /** Each step's outcome by step id ("2", or "3;2" inside shared steps), recorded as step results. */
  stepResults?: { stepId: string; outcome: 'Passed' | 'Failed' }[]
}

export interface RunInput {
  planId: number
  name: string
  automated: boolean
  buildNumber?: string
  results: PointResultInput[]
}

export interface NewPlanInput {
  name: string
  iteration: string
  areaPath: string
  startDate?: string
  endDate?: string
  configurationIds: number[]
}

/** The four buckets every count and chart in the app uses. */
export type Bucket = 'passed' | 'failed' | 'blocked' | 'notRun' | 'na'

export function bucketOf(outcome: string): Bucket {
  switch (outcome) {
    case 'passed': return 'passed'
    case 'failed': case 'error': case 'timeout': case 'aborted': return 'failed'
    case 'blocked': case 'paused': return 'blocked'
    case 'notApplicable': return 'na'
    default: return 'notRun'
  }
}

export const BUCKET_LABEL: Record<Bucket, string> = { passed: 'Passed', failed: 'Failed', blocked: 'Blocked', notRun: 'Not run', na: 'N/A' }

/** "Release 1.2.0" → "1.2.0", so a plan and Run mode in Test Cases agree on the release. */
export const releaseOf = (plan: Pick<TpPlan, 'name'>): string => plan.name.replace(/^release\s+/i, '').trim() || plan.name

export const planUrl = (org: string, project: string, planId: number, suiteId?: number): string =>
  `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_testPlans/execute?planId=${planId}${suiteId ? `&suiteId=${suiteId}` : ''}`

export const runUrl = (org: string, project: string, runId: number): string =>
  `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_testManagement/runs?_a=runCharts&runId=${runId}`
