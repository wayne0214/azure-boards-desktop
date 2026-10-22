import { describe, expect, it } from 'vitest'
import { buildTree, reqConfig } from '../requirements'
import type { FieldDef, TeamContext, WorkItem, WorkItemType } from '../types'
import { STEPS, tcConfig } from './config'
import { buildCoverage } from './coverage'
import { buildMatrix, buildTestCsv, buildTestDocument } from './document'

const method: FieldDef = { referenceName: 'Custom.VerificationMethod', name: 'Verification Method', allowedValues: ['Test', 'Inspection'] }
const srsId: FieldDef = { referenceName: 'Custom.SRSID', name: 'SRS ID' }
const diId: FieldDef = { referenceName: 'Custom.DIID', name: 'DI ID' }
const sdv: FieldDef = { referenceName: 'Custom.SDVID', name: 'SDV ID' }
const ac: FieldDef = { referenceName: 'Custom.AcceptanceCriteria', name: 'Acceptance Criteria' }
const states = [{ name: 'New', color: '000000', category: 'Proposed' as const }]
const type = (name: string, fieldDefs: FieldDef[] = []): WorkItemType => ({ name, referenceName: `T.${name}`, color: '000000', states, fieldDefs })
const types = [type('Epic'), type('Feature', [diId]), type('Requirement', [srsId, method]), type('Test Case', [sdv, ac]), type('Shared Steps')]
const ctx: TeamContext = { iterations: [], settings: null, members: [], tags: [], workItemTypes: types, fieldTypes: { 'Custom.AcceptanceCriteria': 'html' } }

const link = (ids: number[]) => ids.map((t) => ({ rel: 'Microsoft.VSTS.Common.TestedBy-Reverse', url: `https://x/_apis/wit/workItems/${t}` }))
const wi = (id: number, wit: string, fields: Record<string, unknown>, links: number[] = []): WorkItem => ({ id, rev: 1, fields: { 'System.WorkItemType': wit, 'System.State': 'New', ...fields }, relations: link(links) })
const step = (id: number, a: string, e: string) => `<step id="${id}" type="ValidateStep"><parameterizedString isformatted="true">&lt;P&gt;${a}&lt;/P&gt;</parameterizedString><parameterizedString isformatted="true">&lt;P&gt;${e}&lt;/P&gt;</parameterizedString><description/></step>`

const rc = reqConfig(ctx)!
const cfg = tcConfig(ctx)!
const tree = buildTree(rc, types, [
  wi(10, 'Epic', { 'System.Title': 'Screening' }),
  wi(11, 'Feature', { 'System.Title': 'Offline capture', 'System.Parent': 10, [diId.referenceName]: 'DI-01' }),
  wi(1, 'Requirement', { 'System.Title': 'Resume upload', 'System.Parent': 11, [srsId.referenceName]: 'SRS-041', [method.referenceName]: 'Test' }),
  wi(2, 'Requirement', { 'System.Title': 'Retake photo', 'System.Parent': 11, [srsId.referenceName]: 'SRS-052', [method.referenceName]: 'Test' }),
  wi(3, 'Requirement', { 'System.Title': 'Letterhead', 'System.Parent': 11, [srsId.referenceName]: 'SRS-060', [method.referenceName]: 'Inspection' }),
], [])
const shared = wi(500, 'Shared Steps', { 'System.Title': 'Login as Clinician', [STEPS]: `<steps id="0" last="2">${step(2, 'Sign in as clinician', 'Home shown')}</steps>` })
const t1 = wi(101, 'Test Case', {
  'System.Title': 'Upload survives a retake', [sdv.referenceName]: 'SDV-0001',
  [ac.referenceName]: '<ul><li>[SRS-041] Upload resumes</li><li>Retake kept</li></ul>',
  [STEPS]: `<steps id="0" last="3"><compref id="2" ref="500"/>${step(3, 'Toggle airplane mode', 'Upload resumes')}</steps>`,
}, [1, 2])
const cov = buildCoverage(cfg, types, tree, [t1])
const opts = { projectName: 'Contoso Mobile' }

describe('buildTestDocument', () => {
  const html = buildTestDocument(cfg, rc, tree, cov, new Map([[500, shared]]), opts)
  it('keeps the UN and DI headings of the SRS document', () => {
    expect(html).toContain('1&ensp;Screening')
    expect(html).toContain('1.1&ensp;DI-01 Offline capture')
  })
  it('puts the test cases in a table with the team\'s columns', () => {
    expect(html).toContain('<tr><th>SDV ID</th><th>SRS ID</th><th>Test Steps</th><th>Acceptance Criteria</th><th>Test Outcome</th></tr>')
  })
  it('writes each test case once, with every SRS it verifies', () => {
    expect(html.match(/<td class="c-id">SDV-0001<\/td>/g)).toHaveLength(1)
    expect(html).toContain('SRS-041, SRS-052')
  })
  it('numbers the actions in Test Steps, with shared steps written out', () => {
    expect(html).toMatch(/<td class="c-steps"><ol><li value="1">Sign in as clinician.*<\/li><li value="2">Toggle airplane mode<\/li><\/ol><\/td>/)
    expect(html).not.toContain('Expected:')
  })
  it('puts the expected results in Acceptance Criteria, numbered to match the steps', () => {
    expect(html).toContain('<td class="c-ac"><ol><li value="1">Home shown</li><li value="2">Upload resumes</li></ol></td>')
  })
  it('skips steps with no expected result, keeping the numbers aligned', () => {
    const t = wi(103, 'Test Case', { 'System.Title': 'Gap', [sdv.referenceName]: 'SDV-0003',
      [STEPS]: `<steps id="0" last="3"><step id="2" type="ActionStep"><parameterizedString isformatted="true">&lt;P&gt;Open&lt;/P&gt;</parameterizedString><parameterizedString isformatted="true"></parameterizedString><description/></step>${step(3, 'Save', 'Saved')}</steps>` }, [1])
    const out = buildTestDocument(cfg, rc, tree, buildCoverage(cfg, types, tree, [t]), new Map(), opts)
    expect(out).toContain('<td class="c-ac"><ol><li value="2">Saved</li></ol></td>')
  })
})

describe('buildMatrix', () => {
  it('lists each SRS with its test cases, method or gap', () => {
    const html = buildMatrix(rc, tree, cov, cfg)
    expect(html).toContain('SRS-041')
    expect(html).toContain('Inspection')
  })
})

describe('buildTestCsv', () => {
  const csv = buildTestCsv(cfg, rc, tree, cov, new Map([[500, shared]]))
  it('uses the team\'s Excel columns', () => {
    expect(csv.split('\r\n')[0]).toBe('SDV ID,SRS ID,Test Steps,Acceptance Criteria,Test Outcome')
  })
  it('puts actions in Test Steps and expected results in Acceptance Criteria, numbered alike', () => {
    expect(csv.split('\r\n')[1]).toBe('SDV-0001,"SRS-041, SRS-052","1. Sign in as clinician\n2. Toggle airplane mode","1. Home shown\n2. Upload resumes",')
  })
  it('joins several SRS IDs in one cell', () => {
    expect(csv).toContain('"SRS-041, SRS-052"')
  })
})

describe('with run results for a release', () => {
  const runs = new Map([[101, { outcome: 'pass' as const, release: 'v2.1', date: '2026-10-21', by: 'Mei Ling', criteria: [], steps: [], note: '', images: [{ url: 'https://x/att/1', caption: 'upload.png' }] }]])
  const withRuns = { ...opts, release: 'v2.1', runs }
  it('fills the Test Outcome column', () => {
    const html = buildTestDocument(cfg, rc, tree, cov, new Map([[500, shared]]), withRuns)
    expect(html).toMatch(/<td class="c-outcome"><span class="doc-outcome pass">Pass<\/span><br><small>v2\.1 · 2026-10-21 · Mei Ling<\/small><\/td>/)
  })
  it('collects the screenshots in an evidence appendix', () => {
    const html = buildTestDocument(cfg, rc, tree, cov, new Map([[500, shared]]), withRuns)
    expect(html).toContain('Evidence')
    expect(html).toContain('src="https://x/att/1"')
  })
  it('fills the Test Outcome column', () => {
    expect(buildTestCsv(cfg, rc, tree, cov, new Map([[500, shared]]), runs).split('\r\n')[1]).toMatch(/,Pass$/)
  })
})

describe('test data in the document', () => {
  it('lists the parameter values', () => {
    const t = wi(102, 'Test Case', {
      'System.Title': 'Rates', [sdv.referenceName]: 'SDV-0002',
      'Microsoft.VSTS.TCM.Parameters': '<parameters><param name="rate" bind="default"/></parameters>',
      'Microsoft.VSTS.TCM.LocalDataSource': '<NewDataSet><Table1><rate>0.1</rate></Table1><Table1><rate>999</rate></Table1></NewDataSet>',
    }, [1])
    const html = buildTestDocument(cfg, rc, tree, buildCoverage(cfg, types, tree, [t]), new Map(), opts)
    expect(html).toContain('Test data')
    expect(html).toContain('@rate = 0.1; 999')
  })
})
