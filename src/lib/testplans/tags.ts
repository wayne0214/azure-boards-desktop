/** Versions to test, read from a repository's tags. Tags only suggest: any version can still be typed. */

export interface TagVersion {
  tag: string
  /** The tag without its "v": what runs record as the build number. */
  version: string
  prerelease: boolean
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

/** "v1.4.0" → "1.4.0", the way git-tools tags releases (`tag_format = "v$version"`); null when not a version. */
export function versionOfTag(tag: string): string | null {
  const v = tag.trim().replace(/^[vV](?=\d)/, '')
  return SEMVER.test(v) ? v : null
}

function compareIds(a: string, b: string): number {
  const na = /^\d+$/.test(a)
  const nb = /^\d+$/.test(b)
  if (na && nb) return Number(a) - Number(b)
  if (na !== nb) return na ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Semantic version order: 1.2.0-alpha.1 < 1.2.0-rc.0 < 1.2.0 < 1.10.0. */
export function compareVersions(a: string, b: string): number {
  const ma = SEMVER.exec(a)
  const mb = SEMVER.exec(b)
  if (!ma || !mb) return a.localeCompare(b, undefined, { numeric: true })
  for (let i = 1; i <= 3; i++) {
    const d = Number(ma[i]) - Number(mb[i])
    if (d) return d
  }
  if (!ma[4] || !mb[4]) return ma[4] ? -1 : mb[4] ? 1 : 0
  const pa = ma[4].split('.')
  const pb = mb[4].split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] == null) return -1
    if (pb[i] == null) return 1
    const d = compareIds(pa[i], pb[i])
    if (d) return d
  }
  return 0
}

/** Tags that name a version, newest first; other tags are left out. */
export function tagVersions(tags: string[]): TagVersion[] {
  const seen = new Set<string>()
  const out: TagVersion[] = []
  for (const tag of tags) {
    const version = versionOfTag(tag)
    if (!version || seen.has(version)) continue
    seen.add(version)
    out.push({ tag, version, prerelease: version.includes('-') })
  }
  return out.sort((a, b) => compareVersions(b.version, a.version))
}

/** Whether a version matches a tag, with or without its "v"; null while the tags are not known. */
export function isTagged(version: string, tags: TagVersion[] | null): boolean | null {
  if (!tags) return null
  const v = version.trim().replace(/^[vV](?=\d)/, '')
  return tags.some((t) => t.version === v)
}

/** The repository to read tags from: the one chosen before, the only one, or the one named like the project. */
export function defaultRepo<R extends { id: string; name: string }>(repos: R[], project: string, saved: string | null): R | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
  return repos.find((r) => r.id === saved) ?? (repos.length === 1 ? repos[0] : null) ?? repos.find((r) => norm(r.name) === norm(project)) ?? null
}
