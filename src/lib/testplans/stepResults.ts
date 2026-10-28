/** A test case's steps beside the step results a run recorded, matched by step id, without reinterpreting outcomes. */
import { plain, type StepItem } from '../testcases/steps'
import type { StepResult } from './types'

export interface StepRow {
  key: string
  /** Number shown, e.g. "2" or "1.3" inside shared steps; none for results the test case no longer has. */
  label?: string
  kind: 'step' | 'shared' | 'extra'
  action: string
  expected: string
  /** For shared steps: the Shared Steps work item. */
  sharedRef?: number
  /** Shared steps whose own steps could not be shown here. */
  unresolved?: boolean
  depth: 0 | 1
  /** As recorded; none when the run recorded nothing for this step. */
  result?: StepResult
}

/**
 * Rows in the test case's order. Steps inside shared steps are listed under them when `sharedSteps` knows the
 * Shared Steps item; their results carry "compref id;step id". Results that match no step (the test case changed
 * since the run) follow at the end, so nothing recorded is hidden.
 */
export function stepRows(items: StepItem[], results: StepResult[], sharedSteps?: (ref: number) => StepItem[] | undefined): StepRow[] {
  const byId = new Map(results.map((r) => [r.stepId, r]))
  const used = new Set<string>()
  const take = (id: string): StepResult | undefined => {
    const r = byId.get(id)
    if (r) used.add(id)
    return r
  }
  const rows: StepRow[] = []
  let n = 0
  for (const item of items) {
    if (item.kind === 'raw') continue
    n++
    const id = item.id != null ? String(item.id) : ''
    if (item.kind === 'step') {
      rows.push({ key: `s${id || n}`, label: String(n), kind: 'step', action: plain(item.action), expected: plain(item.expected), depth: 0, result: id ? take(id) : undefined })
      continue
    }
    const inner = sharedSteps?.(item.ref)?.filter((x): x is Extract<StepItem, { kind: 'step' }> => x.kind === 'step')
    rows.push({ key: `c${id || n}`, label: String(n), kind: 'shared', action: '', expected: '', sharedRef: item.ref, unresolved: !inner, depth: 0, result: id ? take(id) : undefined })
    inner?.forEach((x, i) => {
      const innerId = `${id};${x.id ?? ''}`
      rows.push({ key: `c${id}-${x.id ?? i}`, label: `${n}.${i + 1}`, kind: 'step', action: plain(x.action), expected: plain(x.expected), depth: 1, result: take(innerId) })
    })
  }
  for (const r of results) {
    if (!used.has(r.stepId)) rows.push({ key: `x${r.stepId}`, kind: 'extra', action: '', expected: '', depth: 0, result: r })
  }
  return rows
}

/** How a step row looks: run steps by their outcome; a step after a failure with nothing recorded looks not run. */
export function rowState(row: StepRow, rows: StepRow[]): 'passed' | 'failed' | 'notRun' | 'other' | 'none' {
  const o = row.result?.outcome
  if (o === 'passed') return 'passed'
  if (o === 'failed' || o === 'error' || o === 'aborted' || o === 'timeout') return 'failed'
  if (o === 'notExecuted' || o === 'notApplicable' || o === 'paused') return 'notRun'
  if (o) return 'other'
  const i = rows.indexOf(row)
  return rows.slice(0, i).some((r) => r.result?.outcome === 'failed') ? 'notRun' : 'none'
}
