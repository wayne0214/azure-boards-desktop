import { api } from '@/lib/api'
import { wordDocument } from '@/lib/docExport'
import { linkedIds } from '@/lib/requirements'
import { esc } from '@/lib/testplans/report'
import type { TpPlan } from '@/lib/testplans/types'
import { buildVersionReport, versionReportCsv, versionReportHtml, type BugRef } from '@/lib/testplans/versionReport'
import { outcomesOn } from '@/lib/testplans/versions'
import { useAppStore } from '@/store/useAppStore'
import { usePlanStore, versionScope } from '@/store/usePlanStore'
import { useReqStore } from '@/store/useReqStore'
import { useUiStore } from '@/store/useUiStore'
import type { PlanLookups } from './lookups'

/** Save the record of one version as Word or CSV. Resolves false when nothing was saved. */
export async function exportVersionReport(plan: TpPlan, version: string, lookups: PlanLookups, format: 'word' | 'csv'): Promise<boolean> {
  const st = usePlanStore.getState()
  const org = useAppStore.getState().activeOrg
  const project = st.project
  const toast = useUiStore.getState().toast
  if (!org || !project) return false
  try {
    const points = await st.loadAllPoints()
    // Read the version's results fresh: this is the record, not what happens to be on screen.
    const runIds = st.runs.filter((r) => r.buildNumber?.trim() === version).map((r) => r.id)
    const results = outcomesOn(version, st.runs, runIds.length ? await api().tpRunResults(org, project, runIds) : [])
    const bugs = new Map(useReqStore.getState().bugs.map((b) => [b.id, b]))
    const bugsOf = (testCaseId: number): BugRef[] => {
      const t = lookups.tests.get(testCaseId)
      return t ? linkedIds(t, ['System.LinkTypes.Related']).flatMap((id) => {
        const b = bugs.get(id)
        return b ? [{ id, title: String(b.fields['System.Title'] ?? ''), state: String(b.fields['System.State'] ?? '') }] : []
      }) : []
    }
    const report = buildVersionReport({ version, suites: st.suites, points, runs: st.runs, results, scope: versionScope(st, version), rootSuiteId: plan.rootSuiteId, cases: lookups.cases, reqs: lookups.reqs, bugsOf })
    const title = `${plan.name} – Version ${version} – Test Report`
    const path = format === 'word'
      ? await api().pickSavePath(`${title}.doc`, { name: 'Word document', extensions: ['doc'] })
      : await api().pickSavePath(`${title}.csv`)
    if (!path) return false
    const me = useAppStore.getState().account()?.userName ?? ''
    await api().writeTextFile(path, format === 'word'
      ? wordDocument(esc(title), versionReportHtml(plan, report, lookups.cases, new Date().toLocaleString(), me))
      : versionReportCsv(report, lookups.cases))
    toast({ kind: 'success', title: `Version ${version} report saved`, detail: `${report.counts.total} test points, ${report.runs.length} run${report.runs.length === 1 ? '' : 's'}.` })
    return true
  } catch (e) {
    toast({ kind: 'error', title: 'Could not save the version report', detail: String((e as Error)?.message ?? e) })
    return false
  }
}
