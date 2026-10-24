import { describe, expect, it } from 'vitest'
import { baseVersion, notesFor, RELEASE_NOTES, whatsNewOnLaunch } from './releaseNotes'

const memory = (seen?: string) => {
  const m = new Map<string, string>(seen ? [['whatsNew.seen', seen]] : [])
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

describe('whatsNewOnLaunch', () => {
  it('shows the notes once after an update', () => {
    const s = memory('1.1.0')
    expect(whatsNewOnLaunch(true, '1.2.0', s)).toBe('1.2.0')
    expect(whatsNewOnLaunch(true, '1.2.0', s)).toBeNull()
  })

  it('treats an update from a version that never recorded one as an update', () => {
    expect(whatsNewOnLaunch(true, '1.2.0', memory())).toBe('1.2.0')
  })

  it('records a fresh install without showing anything', () => {
    const s = memory()
    expect(whatsNewOnLaunch(false, '1.2.0', s)).toBeNull()
    expect(whatsNewOnLaunch(true, '1.2.0', s)).toBeNull()
  })

  it('shows a release candidate its release notes, and not again for the release', () => {
    const s = memory('1.1.0')
    expect(whatsNewOnLaunch(true, '1.2.0-rc.0', s)).toBe('1.2.0')
    expect(whatsNewOnLaunch(true, '1.2.0', s)).toBeNull()
  })

  it('stays quiet for a version without notes, but records it', () => {
    const s = memory('1.2.0')
    expect(whatsNewOnLaunch(true, '1.2.1', s)).toBeNull()
    expect(s.m.get('whatsNew.seen')).toBe('1.2.1')
  })

  it('does nothing without storage', () => {
    expect(whatsNewOnLaunch(true, '1.2.0', null)).toBeNull()
  })
})

describe('release notes', () => {
  it('match versions without a prerelease or v', () => {
    expect(baseVersion('v1.2.0-rc.3')).toBe('1.2.0')
    expect(notesFor('1.2.0-alpha.1')?.version).toBe('1.2.0')
    expect(notesFor('0.9.0')).toBeNull()
  })

  it('are newest first, each with something to say', () => {
    const versions = RELEASE_NOTES.map((n) => n.version)
    expect([...versions].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))).toEqual(versions)
    for (const n of RELEASE_NOTES) expect(n.highlights.length).toBeGreaterThan(0)
  })
})
