import { describe, expect, it } from 'vitest'
import { paramNames, parseTestData, serializeTestData } from './params'
import type { StepItem } from './steps'

describe('paramNames', () => {
  it('lists @parameters in order of first appearance', () => {
    const items: StepItem[] = [
      { kind: 'step', id: 2, action: '<P>Enter @rate</P>', expected: '' },
      { kind: 'step', id: 3, action: '<P>See @expected</P>', expected: '<P>@rate shown, mail me@example.com</P>' },
    ]
    expect(paramNames(items)).toEqual(['rate', 'expected'])
  })
})

describe('test data', () => {
  it('reads the portal format', () => {
    const d = parseTestData('<parameters><param name="rate" bind="default"/></parameters>', '<NewDataSet><Table1><rate>0.1</rate></Table1></NewDataSet>')
    expect(d).toEqual({ names: ['rate'], rows: [{ rate: '0.1' }] })
  })
  it('round-trips', () => {
    const d = { names: ['rate', 'expected'], rows: [{ rate: '0.1', expected: 'Accepted' }, { rate: '999 & up', expected: 'Rejected' }] }
    const x = serializeTestData(d)
    expect(parseTestData(x.params, x.dataSource)).toEqual(d)
  })
  it('is empty without data', () => {
    expect(parseTestData(undefined, undefined)).toEqual({ names: [], rows: [] })
  })
})
