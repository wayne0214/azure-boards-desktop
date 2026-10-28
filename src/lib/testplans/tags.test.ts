import { describe, expect, it } from 'vitest'
import { compareVersions, defaultRepo, isTagged, tagVersions, versionOfTag } from './tags'

describe('tags as versions', () => {
  it('reads versions from git-tools tags and skips other tags', () => {
    expect(versionOfTag('v1.4.0')).toBe('1.4.0')
    expect(versionOfTag('1.5.0-alpha.0')).toBe('1.5.0-alpha.0')
    expect(versionOfTag('release-notes')).toBeNull()
    expect(versionOfTag('v1.4')).toBeNull()
  })

  it('orders newest first, a release after its pre-releases', () => {
    const v = tagVersions(['v0.3.0', 'v0.10.0', 'v0.5.0-alpha.0', 'v0.5.0', 'v0.5.0-rc.0', 'v0.5.0-alpha.10', 'v0.5.0-alpha.2', 'misc', '0.3.0'])
    expect(v.map((t) => t.version)).toEqual(['0.10.0', '0.5.0', '0.5.0-rc.0', '0.5.0-alpha.10', '0.5.0-alpha.2', '0.5.0-alpha.0', '0.3.0'])
    expect(v.find((t) => t.version === '0.5.0-rc.0')?.prerelease).toBe(true)
    expect(compareVersions('1.0.0-alpha', '1.0.0-alpha.1')).toBeLessThan(0)
  })

  it('tells whether a version was tagged, once the tags are known', () => {
    const v = tagVersions(['v1.4.0'])
    expect(isTagged('1.4.0', v)).toBe(true)
    expect(isTagged('v1.4.0', v)).toBe(true)
    expect(isTagged('1.5.0-rc.1', v)).toBe(false)
    expect(isTagged('1.4.0', null)).toBeNull()
  })

  it('picks the saved repository, else the only one, else the one named like the project', () => {
    const repos = [{ id: 'a', name: 'contoso-api' }, { id: 'b', name: 'contoso-mobile' }]
    expect(defaultRepo(repos, 'Contoso Mobile', null)?.id).toBe('b')
    expect(defaultRepo(repos, 'Contoso Mobile', 'a')?.id).toBe('a')
    expect(defaultRepo(repos, 'Other', null)).toBeNull()
    expect(defaultRepo([repos[0]], 'Other', null)?.id).toBe('a')
  })
})
