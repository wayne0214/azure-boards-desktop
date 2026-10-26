// Demo mode: used when the UI runs in a plain browser (no Tauri runtime).
// Lets the app be exercised without an Azure DevOps organization.
import type { Api } from './api'
import { addMockBranch, mockPr } from './api.mock.pr'
import { mockVersioning } from './api.mock.versioning'
import { mockWiki } from './api.mock.wiki'
import { mockRooms } from './api.mock.rooms'
import { mockPlans } from './api.mock.plans'
import { serializeSteps, type StepItem } from './testcases/steps'
import type { Board, Comment, Identity, Iteration, Project, Settings, Team, WorkItem, WorkItemType } from './types'

const delay = (ms = 220) => new Promise((r) => setTimeout(r, ms))

const people: Identity[] = [
  { id: 'u1', displayName: 'Wayne Lai', uniqueName: 'wayne@example.com' },
  { id: 'u2', displayName: 'Priya Natarajan', uniqueName: 'priya@example.com' },
  { id: 'u3', displayName: 'Marcus Oyelaran', uniqueName: 'marcus@example.com' },
  { id: 'u4', displayName: 'Hana Kobayashi', uniqueName: 'hana@example.com' },
  { id: 'u5', displayName: 'Tomás Ferreira', uniqueName: 'tomas@example.com' },
]

const projects: Project[] = [
  { id: 'p1', name: 'Contoso Mobile', description: 'Mobile and web apps for the Contoso health service.' },
  { id: 'p2', name: 'Fabrikam Web', description: 'Customer web portal.' },
  { id: 'p3', name: 'Internal Tools', description: 'Shared tooling and infrastructure.' },
]

const teams: Record<string, Team[]> = {
  p1: [
    { id: 't1', name: 'Contoso Mobile Team', projectId: 'p1' },
    { id: 't1b', name: 'Mobile Squad', projectId: 'p1' },
  ],
  p2: [{ id: 't2', name: 'Fabrikam Web Team', projectId: 'p2' }],
  p3: [{ id: 't3', name: 'Internal Tools Team', projectId: 'p3' }],
}

const idField = (ref: string, name: string) => ({ referenceName: ref, name, alwaysRequired: true })
const riskField = { referenceName: 'Custom.RiskLevel', name: 'Risk level', allowedValues: ['Low', 'Medium', 'High'] }

const methodField = { referenceName: 'Custom.VerificationMethod', name: 'Verification Method', allowedValues: ['Test', 'Inspection', 'Analysis', 'Demonstration'] }
const tcStates = [
  { name: 'Design', color: 'b2b2b2', category: 'Proposed' as const },
  { name: 'Ready', color: '007acc', category: 'InProgress' as const },
  { name: 'Closed', color: '339933', category: 'Completed' as const },
]

const types: WorkItemType[] = [
  {
    name: 'Epic', referenceName: 'Microsoft.VSTS.WorkItemTypes.Epic', color: 'E06C00', fieldDefs: [idField('Custom.UNID', 'UN ID')],
    states: [
      { name: 'New', color: 'b2b2b2', category: 'Proposed' },
      { name: 'Active', color: '007acc', category: 'InProgress' },
      { name: 'Resolved', color: 'ff9d00', category: 'Resolved' },
      { name: 'Closed', color: '339933', category: 'Completed' },
    ],
  },
  {
    name: 'Feature', referenceName: 'Microsoft.VSTS.WorkItemTypes.Feature', color: '773B93', fieldDefs: [idField('Custom.DIID', 'DI ID')],
    states: [
      { name: 'New', color: 'b2b2b2', category: 'Proposed' },
      { name: 'Active', color: '007acc', category: 'InProgress' },
      { name: 'Resolved', color: 'ff9d00', category: 'Resolved' },
      { name: 'Closed', color: '339933', category: 'Completed' },
    ],
  },
  {
    name: 'User Story', referenceName: 'Microsoft.VSTS.WorkItemTypes.UserStory', color: '0098C7', fieldDefs: [idField('Custom.SRSID', 'SRS ID'), { referenceName: 'Custom.SRSSpec', name: 'Software Requirement Specification' }, { referenceName: 'Custom.Rationale', name: 'Rationale' }, { referenceName: 'Microsoft.VSTS.Common.AcceptanceCriteria', name: 'Acceptance Criteria' }, riskField, methodField],
    states: [
      { name: 'New', color: 'b2b2b2', category: 'Proposed' },
      { name: 'Active', color: '007acc', category: 'InProgress' },
      { name: 'Resolved', color: 'ff9d00', category: 'Resolved' },
      { name: 'Closed', color: '339933', category: 'Completed' },
    ],
  },
  {
    name: 'Bug', referenceName: 'Microsoft.VSTS.WorkItemTypes.Bug', color: 'CC293D',
    fieldDefs: [{ referenceName: 'Microsoft.VSTS.TCM.ReproSteps', name: 'Repro Steps' }, { referenceName: 'Microsoft.VSTS.CMMI.Symptom', name: 'Symptom' }],
    states: [
      { name: 'New', color: 'b2b2b2', category: 'Proposed' },
      { name: 'Active', color: '007acc', category: 'InProgress' },
      { name: 'Resolved', color: 'ff9d00', category: 'Resolved' },
      { name: 'Closed', color: '339933', category: 'Completed' },
    ],
  },
  {
    name: 'Task', referenceName: 'Microsoft.VSTS.WorkItemTypes.Task', color: 'F2CB1D',
    states: [
      { name: 'New', color: 'b2b2b2', category: 'Proposed' },
      { name: 'Active', color: '007acc', category: 'InProgress' },
      { name: 'Closed', color: '339933', category: 'Completed' },
    ],
  },
  {
    name: 'Test Case', referenceName: 'Microsoft.VSTS.WorkItemTypes.TestCase', color: '004B50', states: tcStates,
    fieldDefs: [
      { referenceName: 'Custom.SDVID', name: 'SDV ID' },
      { referenceName: 'Custom.LastOutcome', name: 'Last Outcome', allowedValues: ['Passed', 'Failed'] },
      { referenceName: 'Custom.LastTestedRelease', name: 'Last Tested Release' },
      { referenceName: 'Microsoft.VSTS.TCM.Steps', name: 'Steps' },
      { referenceName: 'Microsoft.VSTS.TCM.Parameters', name: 'Parameters' },
      { referenceName: 'Microsoft.VSTS.TCM.LocalDataSource', name: 'Local Data Source' },
    ],
  },
  { name: 'Shared Steps', referenceName: 'Microsoft.VSTS.WorkItemTypes.SharedStep', color: '004B50', states: tcStates, fieldDefs: [{ referenceName: 'Microsoft.VSTS.TCM.Steps', name: 'Steps' }] },
  ...(['Change Request', 'Issue'] as const).map((name) => ({
    name, referenceName: `Microsoft.VSTS.WorkItemTypes.${name.replace(' ', '')}`, color: 'B4009E',
    states: [
      { name: 'Proposed', color: 'b2b2b2', category: 'Proposed' as const },
      { name: 'Active', color: '007acc', category: 'InProgress' as const },
      { name: 'Resolved', color: 'ff9d00', category: 'Resolved' as const },
      { name: 'Closed', color: '339933', category: 'Completed' as const },
    ],
  })),
]

const board: Board = {
  id: 'b1',
  name: 'Stories',
  columns: [
    { id: 'c1', name: 'New', itemLimit: 0, columnType: 'incoming', stateMappings: { 'User Story': 'New', Bug: 'New' } },
    { id: 'c2', name: 'Ready', itemLimit: 6, columnType: 'inProgress', stateMappings: { 'User Story': 'New', Bug: 'New' } },
    { id: 'c3', name: 'In Progress', itemLimit: 5, columnType: 'inProgress', isSplit: true, stateMappings: { 'User Story': 'Active', Bug: 'Active' } },
    { id: 'c4', name: 'Review', itemLimit: 4, columnType: 'inProgress', stateMappings: { 'User Story': 'Resolved', Bug: 'Resolved' } },
    { id: 'c5', name: 'Done', itemLimit: 0, columnType: 'outgoing', stateMappings: { 'User Story': 'Closed', Bug: 'Closed' } },
  ],
  rows: [{ id: null, name: null }],
  fields: {
    columnField: { referenceName: 'WEF_demo_Kanban.Column' },
    rowField: { referenceName: 'WEF_demo_Kanban.Lane' },
    doneField: { referenceName: 'WEF_demo_Kanban.Column.Done' },
  },
  allowedMappings: {},
  canEdit: true,
}

const featureBoard: Board = {
  ...board,
  id: 'b2',
  name: 'Features',
  columns: [
    { id: 'f1', name: 'New', itemLimit: 0, columnType: 'incoming', stateMappings: { Feature: 'New' } },
    { id: 'f2', name: 'Active', itemLimit: 0, columnType: 'inProgress', stateMappings: { Feature: 'Active' } },
    { id: 'f3', name: 'Closed', itemLimit: 0, columnType: 'outgoing', stateMappings: { Feature: 'Closed' } },
  ],
}

const iterations: Iteration[] = [
  { id: 'i1', name: 'Sprint 11', path: 'Contoso Mobile\\Sprint 11', attributes: { startDate: '2026-09-22', finishDate: '2026-10-05', timeFrame: 'past' } },
  { id: 'i2', name: 'Sprint 12', path: 'Contoso Mobile\\Sprint 12', attributes: { startDate: '2026-10-06', finishDate: '2026-10-19', timeFrame: 'past' } },
  { id: 'i3', name: 'Sprint 13', path: 'Contoso Mobile\\Sprint 13', attributes: { startDate: '2026-10-20', finishDate: '2026-11-02', timeFrame: 'current' } },
  { id: 'i4', name: 'Sprint 14', path: 'Contoso Mobile\\Sprint 14', attributes: { startDate: '2026-11-03', finishDate: '2026-11-16', timeFrame: 'future' } },
]

let nextId = 1200
const areaTrees = new Map<string, import('./api').AreaNode>()
function mockAreas(project: string) {
  if (!areaTrees.has(project)) areaTrees.set(project, { name: project, path: `\\${project}\\Area`, children: [{ name: 'Capture', path: `\\${project}\\Area\\Capture` }] })
  return areaTrees.get(project)!
}
// Demo git-tools run, stopped by cancelGitTools.
let mockToolCancelled = false
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()

function mk(
  id: number,
  type: string,
  title: string,
  column: string,
  assignee: Identity | null,
  extra: Partial<Record<string, unknown>> = {},
): WorkItem {
  const col = board.columns.find((c) => c.name === column)
  const state = col?.stateMappings[type] ?? 'New'
  return {
    id,
    rev: 3,
    fields: {
      'System.Id': id,
      'System.Title': title,
      'System.State': state,
      'System.WorkItemType': type,
      'System.AssignedTo': assignee ? { id: assignee.id, displayName: assignee.displayName, uniqueName: assignee.uniqueName ?? '' } : undefined,
      'System.CreatedBy': { id: 'u1', displayName: 'Wayne Lai', uniqueName: 'wayne@example.com' },
      'System.CreatedDate': daysAgo(12),
      'System.ChangedDate': daysAgo(Math.floor(Math.random() * 6)),
      'System.IterationPath': 'Contoso Mobile\\Sprint 13',
      'System.AreaPath': 'Contoso Mobile',
      'System.TeamProject': 'Contoso Mobile',
      'System.CommentCount': Math.floor(Math.random() * 4),
      'WEF_demo_Kanban.Column': column,
      'WEF_demo_Kanban.Column.Done': false,
      'Microsoft.VSTS.Common.Priority': 2,
      ...(type === 'User Story' ? { 'Custom.SRSID': `SRS-${id - 1000}`, 'Custom.RiskLevel': 'Medium' } : type === 'Feature' ? { 'Custom.DIID': `DI-${id - 1100}` } : {}),
      'System.Description': `<p>${title}.</p><p>Covers the happy path and the main failure cases. See the design notes linked from the parent feature.</p><ul><li>Acceptance criteria agreed with clinical team</li><li>Telemetry events added</li></ul>`,
      ...extra,
    },
    relations: [],
  }
}

let items: WorkItem[] = [
  mk(1182, 'User Story', 'Patient can retake a photo when the pose check fails', 'New', null, { 'Microsoft.VSTS.Scheduling.StoryPoints': 3, 'System.Tags': 'capture; ux' }),
  mk(1183, 'Bug', 'Angle overlay drifts after device rotation on Android 14', 'New', people[2], { 'Microsoft.VSTS.Common.Priority': 1, 'System.Tags': 'android' }),
  mk(1171, 'User Story', 'Clinician dashboard shows pending reviews grouped by clinic', 'Ready', people[1], { 'Microsoft.VSTS.Scheduling.StoryPoints': 5, 'System.Tags': 'dashboard' }),
  mk(1176, 'User Story', 'Export screening report as PDF with clinic letterhead', 'Ready', people[3], { 'Microsoft.VSTS.Scheduling.StoryPoints': 8 }),
  mk(1164, 'User Story', 'Secure upload resumes after network drop', 'In Progress', people[0], { 'Microsoft.VSTS.Scheduling.StoryPoints': 5, 'System.Tags': 'reliability; upload' }),
  mk(1168, 'Bug', 'Cobb angle rounding differs between app and report', 'In Progress', people[4], { 'Microsoft.VSTS.Common.Priority': 1, 'WEF_demo_Kanban.Column.Done': true, 'System.Tags': 'clinical' }),
  mk(1159, 'User Story', 'Parents receive a follow-up reminder 6 months after screening', 'In Progress', people[1], { 'Microsoft.VSTS.Scheduling.StoryPoints': 3 }),
  mk(1150, 'User Story', 'Onboarding explains what the camera needs to see', 'Review', people[3], { 'Microsoft.VSTS.Scheduling.StoryPoints': 2, 'System.Tags': 'ux' }),
  mk(1141, 'Bug', 'Crash when opening a report with no images attached', 'Done', people[2], { 'Microsoft.VSTS.Common.Priority': 1 }),
  mk(1138, 'User Story', 'Clinic admins can invite staff by email', 'Done', people[0], { 'Microsoft.VSTS.Scheduling.StoryPoints': 3 }),
  mk(1133, 'User Story', 'Screening history list supports search by patient ID', 'Done', people[4], { 'Microsoft.VSTS.Scheduling.StoryPoints': 2 }),
  mk(1190, 'Feature', 'Clinic reporting', 'New', people[1]),
  mk(1191, 'Feature', 'Offline capture', 'Active', people[0]),
  mk(1195, 'Task', 'Write upload resume unit tests', 'New', people[0], { 'System.Parent': 1164, 'Microsoft.VSTS.Scheduling.RemainingWork': 4 }),
  mk(1196, 'Task', 'Keychain storage for resume token', 'New', people[1], { 'System.Parent': 1164, 'Microsoft.VSTS.Scheduling.RemainingWork': 6 }),
  mk(1197, 'Bug', 'Pose check accepts a photo with the patient partly out of frame', 'New', people[2], { 'System.State': 'Resolved', 'Microsoft.VSTS.Common.Priority': 2, 'System.Tags': 'capture' }),
]
items.find((i) => i.id === 1164)!.fields['System.Parent'] = 1191

// A small UN > DI > SRS tree for the Requirements view.
items.push(
  mk(1101, 'Epic', 'Patient can complete a check-up at home', 'Active', people[1], { 'Custom.UNID': 'UN-001' }),
  mk(1102, 'Epic', 'Clinicians can review screenings remotely', 'New', people[3], { 'Custom.UNID': 'UN-002' }),
  mk(1192, 'Feature', 'Camera guides the patient into the correct pose', 'Active', people[0], { 'Custom.DIID': 'DI-092', 'System.Parent': 1101 }),
  mk(1193, 'Feature', 'Screening results are sent securely', 'New', people[4], { 'Custom.DIID': 'DI-093', 'System.Parent': 1102 }),
)
const spec = (id: number, text: string, ac: string) => Object.assign(items.find((i) => i.id === id)!.fields, {
  'Custom.SRSSpec': `<p>The application shall ${text}.</p>`,
  'Microsoft.VSTS.Common.AcceptanceCriteria': ac ? `<ul>${ac.split('|').map((x) => `<li>${x}</li>`).join('')}</ul>` : '',
})
Object.assign(items.find((i) => i.id === 1191)!.fields, { 'System.Parent': 1101 })
Object.assign(items.find((i) => i.id === 1190)!.fields, { 'System.Parent': 1102 })
for (const [id, parent] of [[1164, 1191], [1182, 1192], [1150, 1192], [1171, 1190], [1176, 1190], [1133, 1190]] as const) items.find((i) => i.id === id)!.fields['System.Parent'] = parent
spec(1164, 'resume an interrupted upload from the last confirmed chunk', 'Upload continues after airplane mode is toggled|No duplicate images are stored')
spec(1182, 'let the patient retake a photo when the pose check fails', 'Retake button shown on failure|Previous photo is discarded')
spec(1150, 'explain on first launch what the camera needs to see', '')
spec(1171, 'group pending reviews by clinic on the clinician dashboard', 'Groups sorted by oldest pending review')
spec(1176, 'export a screening report as PDF with the clinic letterhead', 'PDF/A output|Letterhead from clinic settings')
spec(1133, 'search the screening history by patient ID', 'Partial IDs match')
items.find((i) => i.id === 1197)!.fields['System.Parent'] = 1182
items.find((i) => i.id === 1195)!.fields['System.Tags'] = 'BE'
items.find((i) => i.id === 1196)!.fields['System.Title'] = '[FE] Keychain storage for resume token'
items.push(
  mk(1210, 'Task', '[QA] Test resume after airplane mode', 'New', people[3], { 'System.Parent': 1164 }),
  mk(1211, 'Task', 'Pose overlay warning when out of frame', 'Active', people[3], { 'System.Parent': 1182, 'System.Tags': 'FE', 'System.State': 'Active', 'Microsoft.VSTS.Scheduling.RemainingWork': 4 }),
  mk(1212, 'Task', 'Validate keypoints server-side', 'Done', people[2], { 'System.Parent': 1182, 'System.Tags': 'BE', 'System.State': 'Closed' }),
  mk(1213, 'Task', 'Test with partial-body photos', 'New', people[1], { 'System.Parent': 1182, 'System.Tags': 'QA' }),
  mk(1214, 'Task', 'Clinic grouping query', 'Done', people[4], { 'System.Parent': 1171, 'System.Tags': 'BE', 'System.State': 'Closed' }),
  mk(1215, 'Task', 'Dashboard grouping UI', 'Done', people[0], { 'System.Parent': 1171, 'System.Tags': 'FE', 'System.State': 'Closed' }),
)

// Change requests and issues: real ones linked the right way, and a few that are really tasks.
const link = (rel: string, id: number) => ({ rel, url: `https://dev.azure.com/demo-org/_apis/wit/workItems/${id}` })
items.push(
  mk(1220, 'Change Request', 'Allow two photo retakes instead of one (clinic request)', 'New', people[1], { 'System.State': 'Proposed' }),
  mk(1221, 'Change Request', '[FE] Update retake button copy', 'New', people[3], { 'System.State': 'Active', 'System.Parent': 1182, 'Microsoft.VSTS.Scheduling.RemainingWork': 2 }),
  mk(1222, 'Issue', 'Android 14 test devices not delivered yet', 'New', people[1], { 'System.State': 'Active' }),
  mk(1223, 'Issue', '[BE] Fix flaky upload integration test', 'New', people[2], { 'System.State': 'Active', 'System.Parent': 1164, 'Microsoft.VSTS.Scheduling.RemainingWork': 3 }),
)
items.find((i) => i.id === 1220)!.relations = [link('Microsoft.VSTS.Common.Affects-Forward', 1182)]
items.find((i) => i.id === 1222)!.relations = [link('System.LinkTypes.Related', 1213)]
items.find((i) => i.id === 1221)!.relations = [link('System.LinkTypes.Hierarchy-Reverse', 1182)]
items.find((i) => i.id === 1223)!.relations = [link('System.LinkTypes.Hierarchy-Reverse', 1164)]

// Verification methods on the SRS items: Test, one Inspection, one left empty.
for (const [id, m] of [[1164, 'Test'], [1182, 'Test'], [1171, 'Test'], [1133, 'Test'], [1176, 'Inspection']] as const) items.find((i) => i.id === id)!.fields['Custom.VerificationMethod'] = m

// Test cases: SRS 1133 (Test) and 1150 (no method) have none; 1305 tests nothing; 1302 tests two SRS.
const step = (n: number, action: string, expected: string): StepItem => ({ kind: 'step', id: n, action: `<P>${action}</P>`, expected: expected ? `<P>${expected}</P>` : '' })
const loginSteps: StepItem[] = [
  step(2, 'Open the clinician portal login page', 'Login form is shown'),
  step(3, 'Enter a valid clinician email and password', ''),
  step(4, 'Select Sign in', 'The dashboard opens'),
]
const tcRel = (...srs: number[]) => srs.map((n) => link('Microsoft.VSTS.Common.TestedBy-Reverse', n))
const tc = (id: number, sdv: number, title: string, srs: number[], steps: StepItem[], extra: Record<string, unknown> = {}) => {
  const it = mk(id, 'Test Case', title, 'New', null, {
    'System.State': 'Ready', 'Custom.SDVID': `SDV-${String(sdv).padStart(4, '0')}`,
    'Microsoft.VSTS.TCM.Steps': serializeSteps(steps), ...extra,
  })
  it.relations = tcRel(...srs)
  return it
}
const shared = mk(1300, 'Shared Steps', 'Login as Clinician', 'New', null, { 'System.State': 'Ready', 'Microsoft.VSTS.TCM.Steps': serializeSteps(loginSteps) })
const useLogin: StepItem = { kind: 'shared', id: 2, ref: 1300 }
items.push(
  shared,
  tc(1301, 1, 'Upload resumes after airplane mode is toggled', [1164], [useLogin, step(3, 'Start uploading a 20 MB screening set', 'Progress bar advances'), step(4, 'Turn on airplane mode, wait 10 seconds, then turn it off', 'Upload continues from the last confirmed chunk')], { 'Custom.LastOutcome': 'Passed', 'Custom.LastTestedRelease': 'v2.0.0', 'System.Tags': 'Smoke' }),
  tc(1302, 2, 'Interrupted upload does not lose the pose-check retake', [1164, 1182], [step(2, 'Take a photo that fails the pose check', 'Retake prompt is shown'), step(3, 'Lose the network connection and select Retake', 'A new photo is captured and queued'), step(4, 'Restore the connection', 'Only the new photo is uploaded')]),
  tc(1303, 3, 'Retake button appears when the pose check fails', [1182], [useLogin, step(3, 'Capture a photo with the patient partly out of frame', 'Pose check fails'), step(4, 'Select Retake', 'The camera preview returns')], { 'Custom.LastOutcome': 'Passed', 'Custom.LastTestedRelease': 'v2.0.0', 'System.Tags': 'Smoke; Regression' }),
  tc(1304, 4, 'Dashboard groups pending reviews by clinic', [1171], [useLogin, step(3, 'Open the pending reviews panel', 'Reviews are grouped by clinic'), step(4, 'Compare group order with the review dates', 'Groups are sorted by oldest pending review')]),
  tc(1305, 5, 'Exploratory check of the report footer', [], [step(2, 'Open any exported report', 'Footer shows the report version')]),
  tc(1306, 6, 'Clinic grouping handles clinics with no pending reviews', [1171], [step(2, 'Open the dashboard for a clinic with no pending reviews', 'The clinic is hidden from the list'), step(3, 'Add a pending review to that clinic', 'The clinic appears with one review')], { 'Custom.LastOutcome': 'Failed', 'Custom.LastTestedRelease': 'v2.0.0' }),
  tc(1307, 7, 'Report PDF carries the clinic letterhead', [1176], [step(2, 'Export a screening report as PDF', 'A PDF file is saved'), step(3, 'Open the PDF', 'Letterhead from clinic settings is on every page')]),
  tc(1308, 8, 'Retake keeps the previous photo until the new one passes', [1182], [step(2, 'Select Retake and take a photo that also fails', 'Pose check fails again'), step(3, 'Review the capture history', 'No discarded photos are attached')]),
)
const mirrorTests = () => {
  for (const t of items.filter((i) => i.fields['System.WorkItemType'] === 'Test Case')) {
    for (const r of t.relations ?? []) {
      const srs = items.find((i) => r.url.endsWith(`/${i.id}`))
      if (srs && !srs.relations?.some((x) => x.url.endsWith(`/${t.id}`))) srs.relations = [...(srs.relations ?? []), link('Microsoft.VSTS.Common.TestedBy-Forward', t.id)]
    }
  }
}
mirrorTests()

const comments: Record<number, Comment[]> = {
  1303: [
    { id: 10, text: '<p><b>Test run</b> · PASS · Release v2.0.0 · 2026-10-14 · Mei Ling</p><ul><li>Retake button shown on failure: met</li><li>Previous photo is discarded: met</li></ul>', createdBy: { displayName: 'Mei Ling', uniqueName: 'mei@example.com' }, createdDate: daysAgo(7) },
  ],
  1164: [
    { id: 1, text: '<p>Chunked upload is in. Still need the resume token to survive an app restart.</p>', createdBy: { displayName: 'Wayne Lai', uniqueName: 'wayne@example.com' }, createdDate: daysAgo(2) },
    { id: 2, text: '<p>Can we keep the token in the keychain rather than prefs?</p>', createdBy: { displayName: 'Priya Natarajan', uniqueName: 'priya@example.com' }, createdDate: daysAgo(1) },
  ],
}

const settings: Settings = {
  accounts: [{ org: 'demo-org', userId: 'u1', userName: 'Wayne Lai' }],
  activeOrg: 'demo-org',
  recent: [],
  pinnedProjects: ['demo-org/p1'],
}

const cache = new Map<string, { value: unknown; updatedAt: number }>()

export const mockApi: Api = {
  ...mockPr,
  ...mockVersioning,
  ...mockWiki,
  ...mockRooms,
  ...mockPlans({
    title: (id) => String(items.find((i) => i.id === id)?.fields['System.Title'] ?? `Test case ${id}`),
    tagged: (tag) => items.filter((i) => i.fields['System.WorkItemType'] === 'Test Case' && String(i.fields['System.Tags'] ?? '').split(';').some((t) => t.trim().toLowerCase() === tag.trim().toLowerCase())).map((i) => i.id),
    testedBy: (req) => items.filter((i) => i.fields['System.WorkItemType'] === 'Test Case' && (i.relations ?? []).some((r) => r.rel === 'Microsoft.VSTS.Common.TestedBy-Reverse' && r.url.endsWith(`/${req}`))).map((i) => i.id),
  }),
  getSettings: async () => structuredClone(settings),
  testConnection: async (org) => {
    await delay(600)
    if (!org) throw { kind: 'validation', message: 'Enter your organization name.' }
    return { userId: 'u1', userName: 'Wayne Lai' }
  },
  addAccount: async (org) => {
    await delay(600)
    if (!settings.accounts.some((a) => a.org === org)) settings.accounts.push({ org, userId: 'u1', userName: 'Wayne Lai' })
    settings.activeOrg = org
    return structuredClone(settings)
  },
  removeAccount: async (org) => {
    settings.accounts = settings.accounts.filter((a) => a.org !== org)
    settings.activeOrg = settings.accounts[0]?.org ?? null
    return structuredClone(settings)
  },
  setActiveOrg: async (org) => {
    settings.activeOrg = org
    return structuredClone(settings)
  },
  rememberTarget: async (t) => {
    settings.recent = [t, ...settings.recent.filter((r) => r.projectId !== t.projectId)].slice(0, 12)
    return structuredClone(settings)
  },
  togglePinnedProject: async (key) => {
    settings.pinnedProjects = settings.pinnedProjects.includes(key)
      ? settings.pinnedProjects.filter((k) => k !== key)
      : [...settings.pinnedProjects, key]
    return structuredClone(settings)
  },

  listProjects: async () => {
    await delay()
    return structuredClone(projects)
  },
  listTeams: async (_o, projectId) => {
    await delay()
    return structuredClone(teams[projectId] ?? [])
  },
  defaultTeam: async (_o, projectId) => structuredClone(teams[projectId]?.[0] ?? null),
  listBoards: async () => {
    await delay()
    return [
      { id: 'b1', name: 'Stories' },
      { id: 'b2', name: 'Features' },
    ]
  },
  getBoard: async (_o, _p, _t, boardId) => {
    await delay()
    return structuredClone(boardId === 'b2' ? featureBoard : board)
  },
  getTeamContext: async () => {
    await delay(300)
    return {
      iterations: structuredClone(iterations),
      settings: { defaultIteration: iterations[2] },
      workItemTypes: structuredClone(types),
      members: structuredClone(people),
      tags: ['android', 'capture', 'clinical', 'dashboard', 'ios', 'reliability', 'upload', 'ux'],
      fieldTypes: { 'Custom.UNID': 'string', 'Custom.DIID': 'string', 'Custom.SRSID': 'string', 'Custom.RiskLevel': 'string', 'Custom.SRSSpec': 'html', 'Custom.Rationale': 'html', 'Custom.VerificationMethod': 'string', 'Custom.SDVID': 'string', 'Custom.LastOutcome': 'string', 'Custom.LastTestedRelease': 'string' },
    }
  },
  queryBoardItems: async (_o, q) => {
    await delay(400)
    return structuredClone(
      items.filter((i) => q.types.includes(String(i.fields['System.WorkItemType'])) && (!q.iterationPath || String(i.fields['System.IterationPath']).startsWith(q.iterationPath))),
    )
  },
  projectItems: async (_o, _p, wanted, exclude) => {
    await delay(300)
    return structuredClone(items.filter((i) => wanted.includes(String(i.fields['System.WorkItemType'])) && !exclude.includes(String(i.fields['System.State']))))
  },
  // Demo: two items mention the user.
  mentionedItems: async () => structuredClone(items.filter((i) => [1164, 1191].includes(i.id))),
  myWork: async () => {
    await delay(300)
    const hidden = (i: WorkItem) => ['Test Case', 'Shared Steps'].includes(String(i.fields['System.WorkItemType']))
    const createdByMe = (i: WorkItem) => (i.fields['System.CreatedBy'] as { id?: string } | undefined)?.id === 'u1'
    const mine = (i: WorkItem) => !hidden(i) && (i.fields['System.AssignedTo'] as { id?: string } | undefined)?.id === 'u1' && i.fields['System.State'] !== 'Closed' && (i.fields['System.State'] !== 'Resolved' || createdByMe(i))
    const toVerify = (i: WorkItem) => (i.fields['System.CreatedBy'] as { id?: string } | undefined)?.id === 'u1' && i.fields['System.State'] === 'Resolved'
    return structuredClone(items.filter((i) => mine(i) || toVerify(i)))
  },
  workItemTypes: async () => { await delay(150); return structuredClone(types) },
  searchWorkItems: async (_o, _p, text) => {
    await delay(200)
    const t = text.toLowerCase()
    return structuredClone(items.filter((i) => String(i.id).includes(t) || String(i.fields['System.Title']).toLowerCase().includes(t)))
  },
  getWorkItem: async (_o, _p, id) => {
    await delay(150)
    const it = items.find((i) => i.id === id)
    if (!it) throw { kind: 'not_found', message: `Work item ${id} was not found.` }
    return structuredClone(it)
  },
  getChildren: async (_o, _p, id) => structuredClone(items.filter((i) => i.fields['System.Parent'] === id)),
  // Demo: one module already exists; the team board includes sub-areas.
  getAreaTree: async (_o, project) => { await delay(150); return structuredClone(mockAreas(project)) },
  createArea: async (_o, project, _parent, name) => {
    await delay(300)
    const root = mockAreas(project)
    if (root.children?.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw { kind: 'conflict', message: `"${name}" already exists.` }
    const node = { name, path: `\\${project}\\Area\\${name}` }
    root.children = [...(root.children ?? []), node]
    return structuredClone(node)
  },
  teamAreas: async (_o, project) => [{ path: project, includeChildren: true }],
  getComments: async (_o, _p, id) => structuredClone(comments[id] ?? []),

  createWorkItem: async (_o, _p, type, fields, parentId) => {
    await delay(350)
    const it = mk(nextId++, type, String(fields['System.Title']), 'New', null, { ...fields, ...(parentId ? { 'System.Parent': parentId } : {}) })
    if (typeof fields['System.AssignedTo'] === 'string') {
      const p = people.find((x) => x.uniqueName === fields['System.AssignedTo'] || x.displayName === fields['System.AssignedTo'])
      if (p) it.fields['System.AssignedTo'] = { id: p.id, displayName: p.displayName, uniqueName: p.uniqueName ?? '' }
    }
    items = [it, ...items]
    return structuredClone(it)
  },
  updateWorkItem: async (_o, _p, id, rev, fields) => {
    await delay(300)
    const it = items.find((i) => i.id === id)
    if (!it) throw { kind: 'not_found', message: `Work item ${id} was not found.` }
    // Like Azure DevOps: an update made against an older revision is refused.
    if (rev != null && rev !== it.rev) throw { kind: 'conflict', status: 412, message: `Work item ${id} was changed (revision ${it.rev}, not ${rev}).` }
    for (const [k, v] of Object.entries(fields)) {
      if (v === null) delete it.fields[k]
      else if (k === 'System.AssignedTo' && typeof v === 'string') {
        const p = people.find((x) => x.uniqueName === v || x.displayName === v)
        it.fields[k] = p ? { id: p.id, displayName: p.displayName, uniqueName: p.uniqueName ?? '' } : { displayName: v }
      } else it.fields[k] = v
    }
    const colName = it.fields['WEF_demo_Kanban.Column'] as string | undefined
    const col = board.columns.find((c) => c.name === colName)
    if (col && fields['WEF_demo_Kanban.Column']) it.fields['System.State'] = col.stateMappings[String(it.fields['System.WorkItemType'])] ?? it.fields['System.State']
    it.rev += 1
    it.fields['System.ChangedDate'] = new Date().toISOString()
    return structuredClone(it)
  },
  setParent: async (_o, _p, id, parentId) => {
    await delay(200)
    const it = items.find((i) => i.id === id)!
    it.relations = (it.relations ?? []).filter((r) => r.rel !== 'System.LinkTypes.Hierarchy-Reverse')
    if (parentId) { it.fields['System.Parent'] = parentId; it.relations.push(link('System.LinkTypes.Hierarchy-Reverse', parentId)) }
    else delete it.fields['System.Parent']
    it.rev = (it.rev ?? 1) + 1
    return structuredClone(it)
  },
  addLink: async (_o, _p, id, targetId, rel) => {
    await delay(200)
    const it = items.find((i) => i.id === id)!
    it.relations = [...(it.relations ?? []).filter((r) => !(r.rel === rel && r.url.endsWith(`/${targetId}`))), link(rel, targetId)]
    it.rev = (it.rev ?? 1) + 1
    // A link is a change to both ends.
    const target = items.find((i) => i.id === targetId)
    if (target) target.rev = (target.rev ?? 1) + 1
    mirrorTests()
    return structuredClone(it)
  },
  // The demo user has no Test Plans access, like most of the team.
  tpMirrorResult: async () => { await delay(150); return { mirrored: false, reason: 'No Test Plans access' } },
  removeLink: async (_o, _p, id, targetId, rel) => {
    await delay(200)
    const it = items.find((i) => i.id === id)!
    it.relations = (it.relations ?? []).filter((r) => !(r.rel === rel && r.url.endsWith(`/${targetId}`)))
    const target = items.find((i) => i.id === targetId)
    if (target && rel === 'Microsoft.VSTS.Common.TestedBy-Reverse') target.relations = (target.relations ?? []).filter((r) => !(r.rel === 'Microsoft.VSTS.Common.TestedBy-Forward' && r.url.endsWith(`/${id}`)))
    if (target) target.rev = (target.rev ?? 1) + 1
    it.rev = (it.rev ?? 1) + 1
    return structuredClone(it)
  },
  // Demo: SRS 1171 changed its specification after test case SDV-0004 was created.
  getUpdates: async (_o, _p, id) => (id === 1171 ? [{ id: 2, rev: 4, revisedDate: daysAgo(3), fields: { 'Custom.SRSSpec': { oldValue: '<p>The application shall group pending reviews on the clinician dashboard.</p>', newValue: '<p>The application shall group pending reviews by clinic on the clinician dashboard.</p>' } } }] : [
    { id: 1, rev: 1, revisedBy: people[1], revisedDate: daysAgo(12), fields: { 'System.State': { newValue: 'New' } } },
    { id: 2, rev: 2, revisedBy: people[1], revisedDate: daysAgo(9), fields: { 'System.AssignedTo': { newValue: people[0] }, 'System.IterationPath': { oldValue: 'Contoso Mobile', newValue: 'Contoso Mobile\\Sprint 14' } } },
    { id: 3, rev: 3, revisedBy: people[0], revisedDate: daysAgo(4), fields: { 'System.State': { oldValue: 'New', newValue: 'Active' }, 'System.Description': { oldValue: '<p>a</p>', newValue: '<p>b</p>' } }, relations: { added: [{ rel: 'ArtifactLink', url: `vstfs:///Git/Ref/p%2Fr%2FGBfeature%2F${id}-demo`, attributes: { name: 'Branch' } }] } },
  ]),
  deleteWorkItem: async (_o, _p, id) => {
    await delay(200)
    items = items.filter((i) => i.id !== id)
  },
  addComment: async (_o, _p, id, text) => {
    await delay(200)
    const c: Comment = { id: Date.now(), text: `<p>${text}</p>`, createdBy: { displayName: 'Wayne Lai', uniqueName: 'wayne@example.com' }, createdDate: new Date().toISOString() }
    comments[id] = [...(comments[id] ?? []), c]
    // A comment is a new revision of the work item.
    const it = items.find((i) => i.id === id)
    if (it) it.rev = (it.rev ?? 1) + 1
    return c
  },

  fetchAttachment: async (_o, url) => url,
  uploadAttachment: async (_o, _p, _name, data) => { await delay(300); return { id: `att${Date.now()}`, url: `data:image/png;base64,${data}` } },
  cacheGet: async (key) => (cache.get(key) as never) ?? null,
  cacheSet: async (key, value) => {
    cache.set(key, { value, updatedAt: Math.floor(Date.now() / 1000) })
  },
  cacheClear: async () => cache.clear(),

  readCsv: async () => {
    // Importing from the Test Cases section gets a sheet shaped like QA's spreadsheet.
    const { useUiStore } = await import('@/store/useUiStore')
    if (useUiStore.getState().view === 'tests') return {
      headers: ['SDV ID', 'SRS ID', 'Test Steps', 'Acceptance Criteria', 'Test Outcome'],
      rows: [
        ['SDV-0003', 'SRS-182', '1. Fail the pose check => Retake button is shown\n2. Select Retake => Camera reopens', 'Retake button shown on failure', 'Pass'],
        ['SDV-0010', 'SRS-133', '1. Open screening history => List is shown\n2. Search by patient ID - Expected: Only that patient is listed', 'Search matches the full patient ID', ''],
        ['SDV-0010', 'SRS-133', '3. Clear the search => Full list returns', 'Clearing restores the list', ''],
        ['SDV-0011', 'SRS-150, SRS-999', '1. Install and open the app => Onboarding starts', 'Camera guidance is shown before the first photo', ''],
      ],
    }
    return {
    headers: ['Title', 'Type', 'Assigned To', 'Priority', 'Tags'],
    rows: [
      ['Add dark mode to clinician portal', 'User Story', 'priya@example.com', '2', 'ux'],
      ['Login button unresponsive on Safari 17', 'Bug', 'marcus@example.com', '1', 'web'],
      ['Write release notes for 2.4', 'Task', '', '3', ''],
    ],
  }
  },
  writeTextFile: async () => {},
  importWorkItems: async (o, p, rows) => {
    const out = []
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]
      const created = await mockApi.createWorkItem(o, p, r.work_item_type, r.fields, r.parent_id)
      out.push({ index: i, id: created.id, error: null })
    }
    return out
  },

  gitCurrentBranch: async () => 'feature/upload-resume',
  gitCheckoutBranch: async (_p, branch) => { await delay(400); return branch },
  prStartBranch: async (_o, projectId, repoId, name, _base, workItemId) => {
    await delay(300)
    const full = addMockBranch(name)
    const it = items.find((i) => i.id === workItemId)
    if (it) {
      it.relations = [...(it.relations ?? []), { rel: 'ArtifactLink', url: `vstfs:///Git/Ref/${projectId}%2F${repoId}%2FGB${encodeURIComponent(full.replace(/^refs\/heads\//, ''))}`, attributes: { name: 'Branch' } }]
      it.rev = (it.rev ?? 1) + 1
    }
    return { name: full, linked: true }
  },
  runGitTools: async (_p, _b, args, onOutput) => {
    mockToolCancelled = false
    const say = async (text: string, stream: 'stdout' | 'stderr' = 'stdout') => {
      await delay(450)
      if (mockToolCancelled) throw { kind: 'validation', message: 'cancelled' }
      onOutput?.({ stream, text })
    }
    await say(`\x1b[1mgit-tools ${args.join(' ')}\x1b[0m`)
    await say('Collecting commits on feature/upload-resume since main… 6 commits')
    await say('Reading diff (14 files, +412 −96)')
    await say('⠋ Asking the model\r⠙ Asking the model\r✔ Asking the model', 'stderr')
    await say('Copied the pull request text to the clipboard')
    return { code: 0, stdout: '', stderr: '', clipboard: 'Resume chunked uploads after a network drop\n\n## Summary\n- Store the resume token in the keychain\n- Retry each chunk with exponential backoff\n\n## Testing\n- Throttled 3G profile, forced disconnects mid-upload' }
  },
  cancelGitTools: async () => { mockToolCancelled = true; return true },
  pickFolder: async () => '/Users/demo/code/contoso-mobile',
  pickCsvFile: async () => '/demo/import.csv',
  pickOpenFile: async () => '/demo/test-results/results.json',
  readTextFile: async () => { await delay(150); return JSON.stringify(demoPlaywrightReport) },
  pickSavePath: async (name) => `/demo/${name}`,
  openUrl: async (url) => {
    window.open(url, '_blank')
  },
  onMenu: () => () => {},
  onImportProgress: () => () => {},
  showContextMenu: async (menuItems) => {
    // Browser fallback: render a simple popup menu.
    const { showFallbackContextMenu } = await import('../components/ui/FallbackMenu')
    showFallbackContextMenu(menuItems)
  },
}

/** A Playwright JSON report for the demo: two projects named after the demo configurations. */
const demoPlaywrightReport = {
  suites: [{
    title: 'e2e/upload.spec.ts', file: 'e2e/upload.spec.ts',
    specs: [],
    suites: [{
      title: 'Uploads', file: 'e2e/upload.spec.ts',
      specs: [
        { title: '[1301] resumes after airplane mode', file: 'e2e/upload.spec.ts', tags: [], tests: ['macOS', 'Windows 11'].map((projectName) => ({ projectName, status: 'expected', annotations: [], results: [{ status: 'passed', duration: 4210 }] })) },
        { title: 'keeps the retake when the network drops', file: 'e2e/upload.spec.ts', tags: ['@TC1302'], tests: [
          { projectName: 'macOS', status: 'expected', annotations: [], results: [{ status: 'passed', duration: 3120 }] },
          { projectName: 'Windows 11', status: 'unexpected', annotations: [], results: [{ status: 'failed', duration: 5003, error: { message: 'Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole(\'button\', { name: \'Retake\' })', stack: 'at e2e/upload.spec.ts:41:7' } }] },
        ] },
      ],
    }],
  }, {
    title: 'e2e/dashboard.spec.ts', file: 'e2e/dashboard.spec.ts',
    specs: [
      { title: 'groups pending reviews by clinic SDV-0004', file: 'e2e/dashboard.spec.ts', tags: [], tests: ['macOS', 'Windows 11'].map((projectName) => ({ projectName, status: 'flaky', annotations: [], results: [{ status: 'failed', duration: 2000 }, { status: 'passed', duration: 1800 }] })) },
      { title: 'shows the clinic letterhead', file: 'e2e/dashboard.spec.ts', tags: [], tests: [{ projectName: 'macOS', status: 'expected', annotations: [{ type: 'TestCase', description: '1307' }], results: [{ status: 'passed', duration: 900 }] }] },
      { title: 'renders the empty state', file: 'e2e/dashboard.spec.ts', tags: [], tests: [{ projectName: 'macOS', status: 'expected', annotations: [], results: [{ status: 'passed', duration: 700 }] }] },
    ],
  }],
}
