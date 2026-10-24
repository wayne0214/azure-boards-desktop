import { CZ_TOML, WORKFLOW_PATH, namesFrom, workflowYaml, type VersioningNames } from './template'

/** What `versioning_facts` reads about one repository. Sections it could not read are missing and listed under `errors`. */
export interface VersioningFacts {
  branches: string[]
  stable: 'master' | 'main' | null
  hasTags?: boolean
  czToml?: string | null
  workflow?: string | null
  pipeline?: { id: number; name: string } | null
  lastRun?: { id: number; state: string; result?: string | null; createdDate?: string } | null
  secureFile?: { id: string; name: string } | null
  secureFileAuthorized?: boolean
  repoAuthorized?: boolean
  /** Null until a pipeline in the project has run once: Azure creates the identity then. */
  buildService?: { name: string; allow: number } | null
  policies: Record<string, string[]>
  errors: Record<string, { message: string; status?: number | null }>
}

/** One change `versioning_fix` can make. */
export type VersioningFix =
  | { step: 'bootstrap'; stable: string; files: [string, string][] }
  | { step: 'files'; target: string; files: [string, string][]; title: string; description: string }
  | { step: 'pipeline'; repoName: string; workflowPath: string }
  | { step: 'secure-file'; name: string; botName: string; botEmail: string }
  | { step: 'authorize'; pipelineId: number; secureFileId: string | null }
  | { step: 'build-service' }
  | { step: 'run'; pipelineId: number; branch: string }
  | { step: 'develop'; from: string }

export type StepState = 'done' | 'todo' | 'waiting' | 'running' | 'failed' | 'optional' | 'warn' | 'error'

export interface VersioningStep {
  id: 'files' | 'pipeline' | 'secure-file' | 'authorize' | 'build-service' | 'run' | 'develop' | 'pr-id' | 'policies'
  title: string
  state: StepState
  detail: string
  fix?: VersioningFix
  /** The button's words. */
  fixLabel?: string
  /** What the confirmation says will happen. */
  confirm?: string
}

/** Read, Contribute, Create branch, Create tag. */
export const BUILD_SERVICE_BITS = 2 | 4 | 16 | 32
const BIT_NAMES: [number, string][] = [[2, 'Read'], [4, 'Contribute'], [16, 'Create branch'], [32, 'Create tag']]

/** Token scopes each section needs, for a 401/403. */
const SCOPE: Record<string, string> = {
  branches: 'Code (Read)',
  tags: 'Code (Read)',
  files: 'Code (Read)',
  policies: 'Code (Read)',
  pipeline: 'Build (Read)',
  lastRun: 'Build (Read)',
  secureFile: 'Secure Files (Read)',
  secureFileAuthorized: 'Pipeline Resources (Use)',
  repoAuthorized: 'Pipeline Resources (Use)',
  buildService: 'Identity (Read) and Security (Manage)',
}

function problem(f: VersioningFacts, ...keys: string[]): string | null {
  for (const k of keys) {
    const e = f.errors[k]
    if (!e) continue
    if (e.status === 401 || e.status === 403) return `Your access token cannot read this. It needs ${SCOPE[k] ?? 'more access'}.`
    return e.message
  }
  return null
}

export interface RepoRef {
  id: string
  name: string
}

/** The setup steps for a repository, in the order the git-tools Azure guide does them. */
export function versioningSteps(f: VersioningFacts, repo: RepoRef, project: string): { steps: VersioningStep[]; names: VersioningNames } {
  const names = namesFrom(f.workflow, project)
  const stable = f.stable ?? 'master'
  const steps: VersioningStep[] = []
  const hasCz = !!f.czToml
  const hasWorkflow = !!f.workflow

  // 1. Files on the stable branch.
  {
    const err = problem(f, 'branches', 'files')
    const files: [string, string][] = []
    if (!hasCz) files.push(['/.cz.toml', CZ_TOML])
    if (!hasWorkflow) files.push([WORKFLOW_PATH, workflowYaml(names)])
    const step: VersioningStep = { id: 'files', title: 'Versioning files', state: 'done', detail: `.cz.toml and ${WORKFLOW_PATH.slice(1)} are on ${stable}.` }
    if (err) Object.assign(step, { state: 'error', detail: err })
    else if (!hasCz && !hasWorkflow) {
      // A repository not set up yet gets the guide's bootstrap commit; the engine reads its subject.
      Object.assign(step, {
        state: 'todo',
        detail: `Not set up. The first step is a "Release 0.1.0" commit on ${stable} with .cz.toml at 0.0.1 and the pipeline file.`,
        fix: { step: 'bootstrap', stable, files },
        fixLabel: f.stable ? `Commit to ${stable}` : `Create ${stable}`,
        confirm: `Push a commit "Release 0.1.0" straight to ${stable}${f.stable ? '' : ' (creating it)'}, adding .cz.toml (version 0.0.1), ${WORKFLOW_PATH.slice(1)} and a .gitignore rule for *-gpg-private.asc?`,
      })
    } else if (files.length) {
      // Already initialized: do not repeat the bootstrap, propose the missing file in a pull request.
      const what = files.map(([p]) => p.slice(1)).join(' and ')
      Object.assign(step, {
        state: 'todo',
        detail: `${what} is missing on ${stable}.`,
        fix: { step: 'files', target: stable, files, title: 'chore: set up git-tools versioning', description: `Adds ${what} for the git-tools version-bump pipeline (classic Git Flow).` },
        fixLabel: 'Open pull request',
        confirm: `Open a pull request into ${stable} adding ${what}?`,
      })
    }
    steps.push(step)
  }

  // 2. The pipeline definition.
  {
    const err = problem(f, 'pipeline')
    const step: VersioningStep = { id: 'pipeline', title: 'Pipeline', state: 'waiting', detail: 'Needs the pipeline file on the stable branch first.' }
    if (err) Object.assign(step, { state: 'error', detail: err })
    else if (f.pipeline) Object.assign(step, { state: 'done', detail: `${f.pipeline.name} runs ${WORKFLOW_PATH.slice(1)}.` })
    else if (hasWorkflow) {
      Object.assign(step, {
        state: 'todo',
        detail: 'The pipeline file is there but no pipeline uses it.',
        fix: { step: 'pipeline', repoName: repo.name, workflowPath: WORKFLOW_PATH },
        fixLabel: 'Create pipeline',
        confirm: `Create the pipeline from ${WORKFLOW_PATH.slice(1)}? It is not run yet.`,
      })
    }
    steps.push(step)
  }

  // 3. The bot's signing key.
  {
    const err = problem(f, 'secureFile')
    const step: VersioningStep = { id: 'secure-file', title: 'Signing key', state: 'done', detail: `${names.secureFile} is in Pipelines → Library → Secure files.` }
    if (err) Object.assign(step, { state: 'error', detail: err })
    else if (f.secureFile === undefined) Object.assign(step, { state: 'waiting', detail: 'Checked once the pipeline file names it.' })
    else if (!f.secureFile) {
      Object.assign(step, {
        state: 'todo',
        detail: `${names.secureFile} is not in the project's secure files. One key serves every repository in the project.`,
        fix: { step: 'secure-file', name: names.secureFile, botName: names.botName, botEmail: names.botEmail },
        fixLabel: 'Generate and upload',
        confirm: `Generate a GPG signing key for "${names.botName} <${names.botEmail}>" (RSA 3072, expires in 2 years) and upload it as the secure file ${names.secureFile}? The private key is not shown or saved; keep a backup by exporting it from Azure if your policy needs one.`,
      })
    }
    steps.push(step)
  }

  // 4. Let the pipeline use the repository and the key without a manual approval.
  {
    const err = problem(f, 'secureFileAuthorized', 'repoAuthorized')
    const step: VersioningStep = { id: 'authorize', title: 'Pipeline access', state: 'waiting', detail: 'Needs the pipeline and the signing key first.' }
    if (err) Object.assign(step, { state: 'error', detail: err })
    else if (f.pipeline && f.secureFile) {
      if (f.secureFileAuthorized && f.repoAuthorized !== false) Object.assign(step, { state: 'done', detail: 'The pipeline may use the signing key and the repository.' })
      else {
        const missing = [!f.secureFileAuthorized && 'the signing key', f.repoAuthorized === false && 'the repository'].filter(Boolean).join(' and ')
        Object.assign(step, {
          state: 'todo',
          detail: `The pipeline is not yet allowed to use ${missing}.`,
          fix: { step: 'authorize', pipelineId: f.pipeline.id, secureFileId: f.secureFile.id },
          fixLabel: 'Authorize',
          confirm: `Allow ${f.pipeline.name} to use ${f.secureFile.name} and this repository?`,
        })
      }
    }
    steps.push(step)
  }

  // 5. The build service pushes the bump commit and tag.
  {
    const err = problem(f, 'buildService')
    const step: VersioningStep = { id: 'build-service', title: 'Build service permissions', state: 'done', detail: '' }
    if (err) Object.assign(step, { state: 'error', detail: err })
    else if (f.buildService === undefined || f.buildService === null) {
      Object.assign(step, { state: 'waiting', detail: `"${project} Build Service" appears after a pipeline in the project first runs. Run the pipeline once (it may fail), then come back.` })
    } else {
      const lacking = BIT_NAMES.filter(([bit]) => (f.buildService!.allow & bit) === 0).map(([, n]) => n)
      if (lacking.length === 0) step.detail = `${f.buildService.name} can read, contribute, create branches and create tags.`
      else {
        Object.assign(step, {
          state: 'todo',
          detail: `${f.buildService.name} is missing ${lacking.join(', ')}.`,
          fix: { step: 'build-service' },
          fixLabel: 'Grant',
          confirm: `Allow ${f.buildService.name} to Read, Contribute, Create branch and Create tag on ${repo.name}? Bypass policies is not granted.`,
        })
      }
    }
    steps.push(step)
  }

  // 6. The first run on the stable branch makes the first version.
  {
    const err = problem(f, 'lastRun', 'tags')
    const step: VersioningStep = { id: 'run', title: 'First version', state: 'waiting', detail: 'Needs the pipeline first.' }
    const run = f.lastRun
    if (err) Object.assign(step, { state: 'error', detail: err })
    else if (f.hasTags) Object.assign(step, { state: 'done', detail: 'The repository has its first version tag.' })
    else if (run && run.state !== 'completed') Object.assign(step, { state: 'running', detail: `Run ${run.id} is ${run.state}.` })
    else if (f.pipeline) {
      const failed = run && run.result && run.result !== 'succeeded'
      Object.assign(step, {
        state: failed ? 'failed' : 'todo',
        detail: failed ? `Run ${run!.id} ${run!.result}. Check its log in Azure DevOps, fix the cause, then run again.` : `Run the pipeline on ${stable} to make version 0.1.0.`,
        fix: { step: 'run', pipelineId: f.pipeline.id, branch: stable },
        fixLabel: failed ? 'Run again' : `Run on ${stable}`,
        confirm: `Run ${f.pipeline.name} on ${stable} now?`,
      })
    }
    steps.push(step)
  }

  // 7. develop starts from the bumped stable branch.
  {
    const step: VersioningStep = { id: 'develop', title: 'develop branch', state: 'done', detail: 'develop exists.' }
    if (!f.branches.includes('develop')) {
      if (f.hasTags && f.stable) {
        Object.assign(step, {
          state: 'todo',
          detail: `Create develop from the bumped ${stable}.`,
          fix: { step: 'develop', from: stable },
          fixLabel: 'Create develop',
          confirm: `Create develop from the tip of ${stable}?`,
        })
      } else Object.assign(step, { state: 'waiting', detail: `Created from ${stable} after its first version.` })
    }
    steps.push(step)
  }

  // 8. Optional: git-tools strips Azure's "Merged PR <id>:" prefix; turning it off only keeps history tidy. No API for it.
  steps.push({ id: 'pr-id', title: 'Pull request ID in commit messages (optional)', state: 'optional', detail: 'Versioning works either way: git-tools ignores Azure\'s "Merged PR 42:" prefix. For tidier history, turn it off in Project settings → Repositories → this repository → Settings.' })

  // Policies that require pull requests also stop the bot's direct push.
  const guarded = Object.entries(f.policies).filter(([, kinds]) => kinds.length > 0).map(([b]) => b)
  if (guarded.length) {
    steps.push({
      id: 'policies',
      title: 'Branch policies',
      state: 'warn',
      detail: `${guarded.join(' and ')} ${guarded.length > 1 ? 'have' : 'has'} branch policies. The bot pushes its bump commit directly, so an administrator must approve a "Bypass policies when pushing" exception for the build service.`,
    })
  }
  return { steps, names }
}

export type Overall = 'ready' | 'partial' | 'none' | 'error'

/** One word for the repository card. */
export function overall(steps: VersioningStep[]): Overall {
  const core = steps.filter((s) => s.state !== 'optional' && s.state !== 'warn')
  if (core.some((s) => s.state === 'error')) return 'error'
  if (core.every((s) => s.state === 'done')) return 'ready'
  return core.find((s) => s.id === 'files')?.state === 'done' ? 'partial' : 'none'
}
