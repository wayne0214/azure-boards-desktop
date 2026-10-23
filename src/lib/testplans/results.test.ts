import { describe, expect, it } from 'vitest'
import { configurationFor, detectFormat, matchResults, parseJunit, parsePlaywright, parseReport, refsIn, refsInAnnotation, resultsForPoints, type AutoResult } from './results'
import type { TpConfiguration, TpPoint } from './types'

describe('test case references', () => {
  it('are found in brackets, tags and prefixed IDs', () => {
    expect(refsIn('[1234] signs in')).toEqual(['id:1234'])
    expect(refsIn('signs in @TC1234 @tc-1240')).toEqual(['id:1234', 'id:1240'])
    expect(refsIn('[TC-77] works (TC:78)')).toEqual(['id:77', 'id:78'])
    expect(refsIn('[SDV-0012] retake')).toEqual(['key:SDV-0012'])
    expect(refsIn('groups reviews sdv-0004')).toEqual(['word:SDV-0004'])
  })
  it('treat short bracketed numbers and ID-like words as maybes', () => {
    expect(refsIn('retries [2] times')).toEqual(['num:2'])
    expect(refsIn('reads UTF-8 files')).toEqual(['word:UTF-8'])
  })
  it('are not taken from ordinary words or numbers', () => {
    expect(refsIn('uploads 20 MB in 3 tries')).toEqual([])
    expect(refsIn('attaches photo1234')).toEqual([])
  })
  it('come from TestCase annotations, one or several', () => {
    expect(refsInAnnotation('TestCase', '1241')).toEqual(['id:1241'])
    expect(refsInAnnotation('testcase', '1241, 1242')).toEqual(['id:1241', 'id:1242'])
    expect(refsInAnnotation('issue', '1241')).toEqual([])
  })
})

const pwReport = {
  suites: [{
    title: 'e2e/login.spec.ts', file: 'e2e/login.spec.ts', specs: [],
    suites: [{
      title: 'Login', file: 'e2e/login.spec.ts',
      specs: [
        { title: '[1234] signs in with SSO', file: 'e2e/login.spec.ts', tags: [], tests: [
          { projectName: 'macOS', status: 'expected', annotations: [], results: [{ status: 'passed', duration: 1200 }] },
          { projectName: 'Windows 11', status: 'unexpected', annotations: [], results: [{ status: 'failed', duration: 300, error: { message: '\u001b[31mExpected visible\u001b[39m', stack: 'at login.spec.ts:9' } }] },
        ] },
        { title: 'rejects a bad password', file: 'e2e/login.spec.ts', tags: ['@TC1235'], tests: [{ projectName: 'macOS', status: 'flaky', annotations: [], results: [{ status: 'failed', duration: 100 }, { status: 'passed', duration: 90 }] }] },
        { title: 'shows terms', file: 'e2e/login.spec.ts', tags: [], tests: [{ projectName: 'macOS', status: 'skipped', annotations: [{ type: 'TestCase', description: '1236' }], results: [] }] },
      ],
    }],
  }],
}

describe('Playwright JSON', () => {
  const results = parsePlaywright(JSON.stringify(pwReport))
  it('has one result per test and project, named with its describe blocks', () => {
    expect(results.map((r) => [r.fullName, r.project, r.outcome])).toEqual([
      ['Login › [1234] signs in with SSO', 'macOS', 'passed'],
      ['Login › [1234] signs in with SSO', 'Windows 11', 'failed'],
      ['Login › rejects a bad password', 'macOS', 'flaky'],
      ['Login › shows terms', 'macOS', 'skipped'],
    ])
  })
  it('keeps the error without terminal colours, and adds up retries', () => {
    expect(results[1]).toMatchObject({ error: 'Expected visible', stack: 'at login.spec.ts:9', durationMs: 300, file: 'e2e/login.spec.ts' })
    expect(results[2].durationMs).toBe(190)
  })
  it('reads references from titles, tags and annotations', () => {
    expect(results.map((r) => r.refs)).toEqual([['id:1234'], ['id:1234'], ['id:1235'], ['id:1236']])
  })
})

const junit = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="e2e/login.spec.ts" hostname="Windows 11" tests="3">
    <testcase name="Login › [1234] signs in with SSO" classname="e2e/login.spec.ts" time="1.25">
      <failure message="Expected visible" type="FAILURE">Error: Expected visible
    at login.spec.ts:9</failure>
    </testcase>
    <testcase name="Login › rejects a bad password" classname="e2e/login.spec.ts" time="0.4">
      <properties><property name="TestCase" value="1235"/></properties>
    </testcase>
    <testcase name="api › health" classname="api.test" time="0.01"><skipped/></testcase>
  </testsuite>
</testsuites>`

describe('JUnit XML', () => {
  const results = parseJunit(junit)
  it('reads outcome, time, host and failure text', () => {
    expect(results[0]).toMatchObject({ fullName: 'Login › [1234] signs in with SSO', project: 'Windows 11', outcome: 'failed', durationMs: 1250, error: 'Expected visible', refs: ['id:1234'] })
    expect(results[0].stack).toContain('login.spec.ts:9')
    expect(results[1]).toMatchObject({ outcome: 'passed', refs: ['id:1235'] })
    expect(results[2]).toMatchObject({ outcome: 'skipped', refs: [] })
  })
  it('is told apart from Playwright JSON', () => {
    expect(detectFormat(junit)).toBe('junit')
    expect(detectFormat(JSON.stringify(pwReport))).toBe('playwright')
    expect(detectFormat('{"a":1}')).toBeNull()
    expect(() => parseReport('hello')).toThrow(/not a Playwright JSON report/)
  })
})

const configs: TpConfiguration[] = [{ id: 1, name: 'macOS', isDefault: true }, { id: 2, name: 'Windows 11', isDefault: false }]
const pt = (id: number, testCaseId: number, configurationId: number): TpPoint => ({
  id, suiteId: 10, testCaseId, testCaseTitle: `TC ${testCaseId}`, configurationId, configurationName: configs.find((c) => c.id === configurationId)!.name, outcome: 'unspecified', isAutomated: false,
})
const points = [pt(1, 1234, 1), pt(2, 1234, 2), pt(3, 1235, 1), pt(4, 1300, 1)]
const auto = (over: Partial<AutoResult>): AutoResult => ({ fullName: 't', outcome: 'passed', durationMs: 10, refs: [], ...over })

describe('matching results to points', () => {
  it('picks the configuration by project name, loosely', () => {
    expect(configurationFor('Windows 11', configs, null)?.id).toBe(2)
    expect(configurationFor('windows-11', configs, null)?.id).toBe(2)
    expect(configurationFor('mac', configs, null)?.id).toBe(1)
    expect(configurationFor('chromium', configs, 1)?.id).toBe(1)
    expect(configurationFor(undefined, configs, null)).toBeUndefined()
  })
  it('finds the point for the test case and configuration', () => {
    const [m] = matchResults([auto({ refs: ['id:1234'], project: 'Windows 11' })], points, configs, new Map(), 1)
    expect(m).toMatchObject({ pointIds: [2], testCaseIds: [1234], configurationName: 'Windows 11' })
    expect(m.problem).toBeUndefined()
  })
  it('resolves SDV IDs and says why nothing matched', () => {
    const keys = new Map([['SDV-0003', 1300]])
    const ms = matchResults([
      auto({ refs: ['key:SDV-0003'] }),
      auto({ refs: [] }),
      auto({ refs: ['key:SDV-9999'] }),
      auto({ refs: ['id:4321'] }),
      auto({ refs: ['id:1235'], project: 'Windows 11' }),
    ], points, configs, keys, 1)
    expect(ms[0].pointIds).toEqual([4])
    expect(ms[1].problem).toBe('No test case ID in the title')
    expect(ms[2].problem).toBe('No test case has the ID SDV-9999')
    expect(ms[3].problem).toBe('#4321 is not in this plan')
    expect(ms[4].problem).toBe('#1235 has no point for Windows 11')
  })
  it('use maybes only when they name a test case', () => {
    const ms = matchResults([auto({ refs: ['num:2'] }), auto({ refs: ['word:UTF-8'] }), auto({ refs: ['word:SDV-0003'] })], [...points, pt(9, 2, 1)], configs, new Map([['SDV-0003', 1300]]), 1)
    expect(ms.map((m) => [m.pointIds, m.problem])).toEqual([[[9], undefined], [[], 'No test case ID in the title'], [[4], undefined]])
    expect(matchResults([auto({ refs: ['num:2'] })], points, configs, new Map(), 1)[0].problem).toBe('No test case ID in the title')
  })
  it('give a test case with one point the result when the project names no configuration', () => {
    expect(matchResults([auto({ refs: ['id:1235'], project: 'chromium' })], points, configs, new Map(), 2)[0].pointIds).toEqual([3])
    expect(matchResults([auto({ refs: ['id:1235'], project: 'Windows 11' })], points, configs, new Map(), 1)[0].pointIds).toEqual([])
  })
  it('match a loose project name only when one configuration fits', () => {
    const two: TpConfiguration[] = [{ id: 1, name: 'Windows 10', isDefault: false }, { id: 2, name: 'Windows 11', isDefault: false }]
    expect(configurationFor('Windows', two, null)).toBeUndefined()
    expect(configurationFor('windows-11', two, null)?.id).toBe(2)
  })
  it('without any configuration, takes a test case with a single point', () => {
    expect(matchResults([auto({ refs: ['id:1235'] })], points, [], new Map(), null)[0].pointIds).toEqual([3])
    expect(matchResults([auto({ refs: ['id:1234'] })], points, [], new Map(), null)[0].pointIds).toEqual([])
  })
})

describe('results per point', () => {
  it('fail when any test reporting to the point failed, and say which', () => {
    const ms = matchResults([
      auto({ fullName: 'a', refs: ['id:1235'], outcome: 'passed', file: 'a.spec.ts' }),
      auto({ fullName: 'b', refs: ['id:1235'], outcome: 'failed', error: 'boom', stack: 'at b', file: 'b.spec.ts' }),
    ], points, configs, new Map(), 1)
    const [r] = resultsForPoints(ms)
    expect(r).toMatchObject({ pointId: 3, outcome: 'Failed', errorMessage: 'boom', stackTrace: 'at b', durationMs: 20, automatedTestName: 'a | b', automatedTestStorage: 'a.spec.ts, b.spec.ts' })
    expect(r.comment).toContain('2 automated tests')
  })
  it('count a flaky pass as passed with a note, and a skip as not executed', () => {
    const out = resultsForPoints(matchResults([auto({ refs: ['id:1235'], outcome: 'flaky' }), auto({ refs: ['id:1300'], outcome: 'skipped' })], points, configs, new Map(), 1))
    expect(out.map((r) => r.outcome)).toEqual(['Passed', 'NotExecuted'])
    expect(out[0].comment).toMatch(/^Flaky/)
  })
})
