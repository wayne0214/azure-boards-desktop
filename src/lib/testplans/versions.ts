import type { TpPlan, TpPoint, TpResult, TpRun } from './types'

/** Versions under test in a plan: each run carries the version it tested as its build number. */

/** Newest first: 1.0.0 before 1.0.0-rc.1 before 0.10.0 before 0.9.0. */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => {
    const [main, pre] = v.replace(/^v/i, '').split('-', 2)
    return { nums: main.split('.').map((n) => Number.parseInt(n, 10) || 0), pre }
  }
  const x = parts(a)
  const y = parts(b)
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (y.nums[i] ?? 0) - (x.nums[i] ?? 0)
    if (d) return d
  }
  // A release outranks its pre-releases.
  if (!x.pre !== !y.pre) return x.pre ? 1 : -1
  return (y.pre ?? '').localeCompare(x.pre ?? '', undefined, { numeric: true }) || b.localeCompare(a)
}

export function versionsOf(runs: TpRun[], added: string[]): string[] {
  const all = new Set([...runs.map((r) => r.buildNumber?.trim() ?? ''), ...added.map((v) => v.trim())].filter(Boolean))
  return [...all].sort(compareVersions)
}

/** The latest result of each point among the runs that tested `version`. */
export function outcomesOn(version: string, runs: TpRun[], results: TpResult[]): Map<number, TpResult> {
  const ids = new Set(runs.filter((r) => r.buildNumber?.trim() === version.trim()).map((r) => r.id))
  const out = new Map<number, TpResult>()
  for (const r of results) {
    if (!ids.has(r.runId)) continue
    const cur = out.get(r.pointId)
    if (!cur || r.runId > cur.runId || (r.runId === cur.runId && r.resultId > cur.resultId)) out.set(r.pointId, r)
  }
  return out
}

/** Points as they stood on a version: its result where there is one, else not run. Without results, unchanged. */
export function withVersion(points: TpPoint[], results: Map<number, TpResult> | null): TpPoint[] {
  if (!results) return points
  return points.map((p) => {
    const r = results.get(p.id)
    return { ...p, outcome: r?.outcome ?? 'unspecified', lastRunId: r?.runId, lastResultId: r?.resultId, lastRunDate: r?.completedDate, lastRunBy: r?.runBy }
  })
}

/**
 * The project's test plan, which Run mode in Test Cases records into: the only active plan;
 * else the one last opened in Test Plans; else one named V&V; else the newest active plan.
 */
export function projectPlan(plans: TpPlan[], rememberedId: number | null): TpPlan | null {
  const active = plans.filter((p) => p.state !== 'Inactive')
  if (active.length <= 1) return active[0] ?? null
  return active.find((p) => p.id === rememberedId) ?? active.find((p) => /v\s*&\s*v|v and v/i.test(p.name)) ?? active[0]
}
