import { api, type AreaNode } from './api'

/**
 * Modules are Azure DevOps area paths. The API writes them as "\\Project\\Area\\Audit";
 * work items use "Project\\Audit". These helpers use the work item form.
 */
export function flattenAreas(root: AreaNode): string[] {
  const out: string[] = []
  const walk = (n: AreaNode) => {
    const parts = n.path.split('\\').filter(Boolean)
    if (parts[1] === 'Area') parts.splice(1, 1)
    out.push(parts.join('\\'))
    n.children?.forEach(walk)
  }
  walk(root)
  return out
}

/** "Contoso Mobile\\Audit\\Logs" → "Audit › Logs"; the project root reads as "Whole project". */
export function moduleLabel(path: string | undefined | null): string {
  const parts = String(path ?? '').split('\\').filter(Boolean)
  return parts.length <= 1 ? 'Whole project' : parts.slice(1).join(' › ')
}

const cache = new Map<string, Promise<string[]>>()

export function listAreas(org: string, project: string, fresh = false): Promise<string[]> {
  const key = `${org}/${project}`
  if (fresh || !cache.has(key)) {
    const p = api().getAreaTree(org, project).then(flattenAreas)
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return cache.get(key)!
}

/** Create a module under the project root and return its work item path. */
export async function createModule(org: string, project: string, name: string): Promise<string> {
  await api().createArea(org, project, '', name.trim())
  cache.delete(`${org}/${project}`)
  return `${project}\\${name.trim()}`
}

/** Whether a team's board shows items in `path` (exact area, or a parent that includes sub-areas). */
export function boardShows(teamAreas: { path: string; includeChildren: boolean }[], path: string): boolean {
  const p = path.toLowerCase()
  return teamAreas.some((a) => {
    const t = a.path.toLowerCase()
    return p === t || (a.includeChildren && p.startsWith(t + '\\'))
  })
}
