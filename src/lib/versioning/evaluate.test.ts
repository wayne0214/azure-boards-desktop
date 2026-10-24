import { describe, expect, it } from 'vitest'
import { BUILD_SERVICE_BITS, overall, versioningSteps, type VersioningFacts } from './evaluate'
import { CZ_TOML, WORKFLOW_PATH, defaultNames, workflowVar, workflowYaml } from './template'

const repo = { id: 'r1', name: 'Scoliosis App' }
const project = 'AI Scoliosis'
const yaml = workflowYaml(defaultNames(project))
const base: VersioningFacts = { branches: [], stable: null, policies: {}, errors: {} }
const ready: VersioningFacts = {
  branches: ['master', 'develop'], stable: 'master', hasTags: true, czToml: CZ_TOML, workflow: yaml,
  pipeline: { id: 7, name: 'scoliosis-app-version-bump-classic' }, lastRun: { id: 1, state: 'completed', result: 'succeeded' },
  secureFile: { id: 'sf', name: 'ai-scoliosis-versioning-gpg-private.asc' }, secureFileAuthorized: true, repoAuthorized: true,
  buildService: { name: 'AI Scoliosis Build Service (dxd)', allow: BUILD_SERVICE_BITS }, policies: {}, errors: {},
}
const byId = (f: VersioningFacts) => Object.fromEntries(versioningSteps(f, repo, project).steps.map((s) => [s.id, s]))

describe('defaultNames', () => {
  it('follows the guide: one bot and one secure file per project', () => {
    expect(defaultNames(project)).toMatchObject({ botName: 'AI Scoliosis Versioning Automation', botEmail: 'ai-scoliosis-versioning@automation.invalid', secureFile: 'ai-scoliosis-versioning-gpg-private.asc' })
  })

  it('round-trips through the workflow file', () => {
    expect(workflowVar(yaml, 'GPG_SECURE_FILE')).toBe('ai-scoliosis-versioning-gpg-private.asc')
    expect(workflowVar(yaml, 'GIT_BOT_NAME')).toBe('AI Scoliosis Versioning Automation')
    expect(workflowVar(workflowYaml({ ...defaultNames(project), botName: 'Name: with "colon"' }), 'GIT_BOT_NAME')).toBe('Name: with "colon"')
  })
})

describe('versioningSteps', () => {
  it('starts an empty repository with the bootstrap commit and waits on the rest', () => {
    const s = byId(base)
    expect(s.files.state).toBe('todo')
    expect(s.files.fix).toMatchObject({ step: 'bootstrap', stable: 'master' })
    expect(s.files.fix?.step === 'bootstrap' && s.files.fix.files.map(([p]) => p)).toEqual(['/.cz.toml', WORKFLOW_PATH])
    expect(s.pipeline.state).toBe('waiting')
    expect(s.develop.state).toBe('waiting')
    expect(overall(versioningSteps(base, repo, project).steps)).toBe('none')
  })

  it('does not repeat the bootstrap in an initialized repository; it proposes the missing file', () => {
    const s = byId({ ...base, branches: ['master'], stable: 'master', czToml: CZ_TOML, workflow: null })
    expect(s.files.fix).toMatchObject({ step: 'files', target: 'master' })
    expect(s.files.fix?.step === 'files' && s.files.fix.files.map(([p]) => p)).toEqual([WORKFLOW_PATH])
  })

  it('walks through the guide in order', () => {
    const afterFiles = { ...base, branches: ['master'], stable: 'master' as const, czToml: CZ_TOML, workflow: yaml, secureFile: null }
    let s = byId(afterFiles)
    expect([s.files.state, s.pipeline.state, s['secure-file'].state, s.authorize.state]).toEqual(['done', 'todo', 'todo', 'waiting'])
    expect(s['secure-file'].fix).toMatchObject({ step: 'secure-file', name: 'ai-scoliosis-versioning-gpg-private.asc' })

    s = byId({ ...afterFiles, pipeline: { id: 7, name: 'p' }, secureFile: { id: 'sf', name: 'x' }, secureFileAuthorized: false, repoAuthorized: false, buildService: null })
    expect(s.authorize.fix).toEqual({ step: 'authorize', pipelineId: 7, secureFileId: 'sf' })
    expect(s['build-service'].state).toBe('waiting')
    expect(s.run.fix).toEqual({ step: 'run', pipelineId: 7, branch: 'master' })
    expect(s.develop.state).toBe('waiting')

    s = byId({ ...afterFiles, pipeline: { id: 7, name: 'p' }, buildService: { name: 'B', allow: 4 }, hasTags: true })
    expect(s['build-service'].detail).toContain('Read, Create branch, Create tag')
    expect(s.develop.fix).toEqual({ step: 'develop', from: 'master' })
  })

  it('reports a running or failed first run', () => {
    const f = { ...ready, hasTags: false, branches: ['master'] }
    expect(byId({ ...f, lastRun: { id: 3, state: 'inProgress' } }).run.state).toBe('running')
    expect(byId({ ...f, lastRun: { id: 3, state: 'completed', result: 'failed' } }).run).toMatchObject({ state: 'failed', fixLabel: 'Run again' })
  })

  it('is ready when everything is set up, with the manual step and policy warning aside', () => {
    const steps = versioningSteps({ ...ready, policies: { master: ['Minimum number of reviewers'], develop: [] } }, repo, project).steps
    expect(overall(steps)).toBe('ready')
    expect(steps.find((x) => x.id === 'policies')?.detail).toContain('master has branch policies')
    expect(steps.find((x) => x.id === 'pr-id')?.state).toBe('manual')
  })

  it('names the token scope a 403 needs instead of failing the whole check', () => {
    const s = byId({ ...ready, errors: { secureFile: { message: 'nope', status: 403 } } })
    expect(s['secure-file']).toMatchObject({ state: 'error', detail: expect.stringContaining('Secure Files (Read)') })
    expect(s.pipeline.state).toBe('done')
    expect(overall(versioningSteps({ ...ready, errors: { secureFile: { message: 'nope', status: 403 } } }, repo, project).steps)).toBe('error')
  })
})
