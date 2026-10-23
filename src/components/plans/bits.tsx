import type { Counts } from '@/lib/testplans/report'
import { BUCKET_LABEL, bucketOf } from '@/lib/testplans/types'

/** A thin bar of passed, failed, blocked and not run. */
export function OutcomeBar({ counts }: { counts: Counts }) {
  if (!counts.total) return <span className="tp-bar empty" />
  const w = (n: number) => `${(n / counts.total) * 100}%`
  return (
    <span className="tp-bar" title={`${counts.passed} passed · ${counts.failed} failed · ${counts.blocked} blocked · ${counts.notRun} not run`}>
      <i className="passed" style={{ width: w(counts.passed) }} />
      <i className="failed" style={{ width: w(counts.failed) }} />
      <i className="blocked" style={{ width: w(counts.blocked) }} />
      <i className="na" style={{ width: w(counts.na) }} />
    </span>
  )
}

export function OutcomePill({ outcome }: { outcome: string }) {
  const b = bucketOf(outcome)
  return <span className={`tp-pill ${b}`}>{BUCKET_LABEL[b]}</span>
}

