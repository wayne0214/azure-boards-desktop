import { describe, expect, it } from 'vitest'
import { parseSteps } from '../testcases/steps'
import { rowState, stepRows } from './stepResults'

// As the portal stores them: HTML escaped inside the XML.
const XML = '<steps id="0" last="4"><step id="1" type="ActionStep"><parameterizedString isformatted="true">&lt;P&gt;Open the app&lt;/P&gt;</parameterizedString><parameterizedString isformatted="true"></parameterizedString></step>'
  + '<step id="2" type="ValidateStep"><parameterizedString isformatted="true">&lt;P&gt;Sign in as &amp;amp;QA admin&lt;/P&gt;</parameterizedString><parameterizedString isformatted="true">&lt;P&gt;Profile shows the email&lt;/P&gt;</parameterizedString></step>'
  + '<step id="3" type="ActionStep"><parameterizedString isformatted="true">Sign out</parameterizedString><parameterizedString isformatted="true"></parameterizedString></step>'
  + '<compref id="4" ref="812" /></steps>'

describe('stepRows', () => {
  const items = parseSteps(XML)

  it('matches results to steps by id and decodes the step text', () => {
    const rows = stepRows(items, [
      { stepId: '2', outcome: 'failed', errorMessage: 'expected value "QA Administrator" to be "qa-admin@example.com"', durationMs: 5000 },
      { stepId: '3', outcome: 'notExecuted' },
    ])
    expect(rows.map((r) => r.label)).toEqual(['1', '2', '3', '4'])
    expect(rows[1]).toMatchObject({ action: 'Sign in as &QA admin', expected: 'Profile shows the email', result: { outcome: 'failed' } })
    expect(rows[0].result).toBeUndefined()
    expect(rows[3]).toMatchObject({ kind: 'shared', sharedRef: 812, unresolved: true })
    expect(rows.map((r) => rowState(r, rows))).toEqual(['none', 'failed', 'notRun', 'notRun'])
  })

  it('lists steps inside shared steps when the shared steps are known', () => {
    const inner = parseSteps('<steps><step id="1"><parameterizedString>Log in</parameterizedString><parameterizedString>Dashboard</parameterizedString></step></steps>')
    const rows = stepRows(items, [{ stepId: '4;1', outcome: 'passed' }], (ref) => (ref === 812 ? inner : undefined))
    expect(rows.slice(-2)).toMatchObject([{ kind: 'shared', unresolved: false }, { label: '4.1', depth: 1, action: 'Log in', result: { outcome: 'passed' } }])
  })

  it('keeps results the test case no longer has', () => {
    const rows = stepRows(items, [{ stepId: '9', outcome: 'passed' }, { stepId: '4;1', outcome: 'failed' }])
    expect(rows.filter((r) => r.kind === 'extra').map((r) => r.result?.stepId)).toEqual(['9', '4;1'])
  })
})
