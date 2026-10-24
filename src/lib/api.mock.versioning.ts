// Demo versioning setup for browser mode: each fix moves the demo repository one step along.
import type { Api } from './api'
import { BUILD_SERVICE_BITS, type VersioningFacts } from './versioning/evaluate'
import { CZ_TOML, defaultNames, workflowYaml } from './versioning/template'

const delay = (ms = 300) => new Promise((r) => setTimeout(r, ms))
const empty = (): VersioningFacts => ({ branches: ['main'], stable: 'main', hasTags: false, czToml: null, workflow: null, pipeline: null, lastRun: null, secureFile: null, buildService: null, policies: { main: [] }, errors: {} })

const state: Record<string, VersioningFacts> = {
  r1: empty(),
  r2: {
    branches: ['main', 'develop'], stable: 'main', hasTags: true, czToml: CZ_TOML, workflow: workflowYaml(defaultNames('Contoso Mobile')),
    pipeline: { id: 41, name: 'contoso-api-version-bump-classic' }, lastRun: { id: 9, state: 'completed', result: 'succeeded' },
    secureFile: { id: 'sf1', name: 'contoso-mobile-versioning-gpg-private.asc' }, secureFileAuthorized: true, repoAuthorized: true,
    buildService: { name: 'Contoso Mobile Build Service (demo-org)', allow: BUILD_SERVICE_BITS }, policies: { main: ['Minimum number of reviewers'], develop: [] }, errors: {},
  },
  r3: { ...empty(), branches: ['main'], czToml: CZ_TOML, errors: { secureFile: { message: 'Forbidden', status: 403 } } },
}

export const mockVersioning: Pick<Api, 'versioningFacts' | 'versioningFix'> = {
  versioningFacts: async (_o, _pid, _p, repoId) => { await delay(); return structuredClone(state[repoId] ?? empty()) },
  versioningFix: async (_o, _pid, project, repoId, fix) => {
    await delay(500)
    const f = (state[repoId] ??= empty())
    switch (fix.step) {
      case 'bootstrap':
      case 'files':
        for (const [path, content] of fix.files) { if (path === '/.cz.toml') f.czToml = content; else f.workflow = content }
        return fix.step === 'files' ? { pullRequestId: 1290 } : { branch: fix.stable }
      case 'pipeline': f.pipeline = { id: 50 + Object.keys(state).length, name: `${fix.repoName}-version-bump-classic` }; f.secureFileAuthorized = false; f.repoAuthorized = false; return { id: f.pipeline.id }
      case 'secure-file': f.secureFile = { id: `sf-${repoId}`, name: fix.name }; f.secureFileAuthorized = false; return { name: fix.name }
      case 'authorize': f.secureFileAuthorized = true; f.repoAuthorized = true; return { authorized: true }
      case 'run':
        f.lastRun = { id: 100, state: 'completed', result: 'succeeded' }
        f.hasTags = !!f.buildService && (f.buildService.allow & BUILD_SERVICE_BITS) === BUILD_SERVICE_BITS
        f.buildService ??= { name: `${project} Build Service (demo-org)`, allow: 2 }
        if (!f.hasTags) f.lastRun.result = 'failed'
        return { id: 100 }
      case 'build-service': if (f.buildService) f.buildService.allow = BUILD_SERVICE_BITS; return { allow: BUILD_SERVICE_BITS }
      case 'develop': f.branches.push('develop'); return { branch: 'refs/heads/develop' }
    }
  },
}
