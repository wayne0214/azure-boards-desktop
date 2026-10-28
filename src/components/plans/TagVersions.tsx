import { useEffect } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { isTagged } from '@/lib/testplans/tags'
import { useAppStore } from '@/store/useAppStore'
import { offeredTags, useTagStore } from '@/store/useTagStore'

/** The project's repository tags as versions to test, loaded once per project. Tags only suggest: any version can be typed. */
export function useTagVersions() {
  const org = useAppStore((a) => a.activeOrg)
  const project = useAppStore((a) => a.selectedProject?.name)
  const s = useTagStore(useShallow((st) => ({ repos: st.repos, repoId: st.repoId, tags: st.tags, error: st.error, loading: st.loading, prerelease: st.prerelease, ensure: st.ensure, setRepo: st.setRepo, setPrerelease: st.setPrerelease })))
  useEffect(() => { if (org && project) void s.ensure(org, project) }, [org, project]) // eslint-disable-line react-hooks/exhaustive-deps
  const offered = offeredTags(s).map((t) => t.version)
  const repoName = s.repos?.find((r) => r.id === s.repoId)?.name
  return { ...s, offered, repoName }
}

/** A quiet note when the version matches no tag. Only information: runs on it are recorded as usual. */
export function UntaggedNote({ version }: { version: string | null | undefined }) {
  const t = useTagVersions()
  if (!version?.trim() || isTagged(version, t.tags) !== false) return null
  return <span className="tag-untagged" title={`No tag in ${t.repoName ?? 'the repository'} matches ${version.trim()}. That is fine for a build that is not tagged yet; runs are recorded as usual.`}>untagged</span>
}
