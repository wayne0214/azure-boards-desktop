/**
 * The files a repository needs for git-tools versioning on Azure Pipelines (classic Git Flow), as in
 * git-tools' docs/azure-devops/setup.md and .azure/workflows/version-bump-git-flow-classic.yml.example.
 */

export const WORKFLOW_PATH = '/.azure/workflows/version-bump-git-flow-classic.yml'
/** A tag with Azure merge-subject handling and decide_version_strategy(flow="classic"). */
export const DEFAULT_GIT_TOOLS_REF = '0.2.0-alpha.2'

export interface VersioningNames {
  botName: string
  botEmail: string
  secureFile: string
  gitToolsRef: string
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'project'

/** The guide's naming: one bot identity and one secure file per project. */
export function defaultNames(project: string): VersioningNames {
  const s = slug(project)
  return {
    botName: `${project.replace(/[<>"]/g, '').trim()} Versioning Automation`,
    botEmail: `${s}-versioning@automation.invalid`,
    secureFile: `${s}-versioning-gpg-private.asc`,
    gitToolsRef: DEFAULT_GIT_TOOLS_REF,
  }
}

/** What `git-tools init --defaults` writes. */
export const CZ_TOML = `[tool.commitizen]
name = "cz_conventional_commits"
tag_format = "$version"
version_scheme = "semver2"
version = "0.0.1"
major_version_zero = true
`

/** A YAML scalar: quoted when it holds anything YAML would read differently. */
const scalar = (v: string) => (/^[A-Za-z0-9 ._@/:-]+$/.test(v) && !/^[\s-]|:\s|\s#|\s$/.test(v) ? v : JSON.stringify(v))

export function workflowYaml(n: VersioningNames): string {
  return `# git-tools version bump for classic Git Flow on Azure Pipelines.
# Added by Boards from git-tools' .azure/workflows/version-bump-git-flow-classic.yml.example (${scalar(n.gitToolsRef)}).
#   - develop -> tagged alpha prereleases on the upcoming release line
#   - release/<x.y.z> stabilizes that line as rc prereleases
#   - master -> stable releases
#   - hotfix/** -> patch rc prereleases, then stable on master
# Setup: docs/azure-devops/setup.md in the git-tools repository.

trigger:
  branches:
    include:
      - master
      - develop
      - release/*
      - hotfix/*
      - feature/*
      - bugfix/*

# The flow reacts to branch pushes; do not also run as a PR validation build.
pr: none

pool:
  vmImage: ubuntu-latest

variables:
  # Set to 'false' to bump only .cz.toml (default enabled).
  GIT_TOOLS_BUMP_SYNC_AUXILIARY: 'true'
  # git-tools is cloned from a public GitHub repo.
  GIT_TOOLS_REPO: https://github.com/davidyytan/git-tools.git
  GIT_TOOLS_REF: ${scalar(n.gitToolsRef)}
  # Project-scoped signing identity; no Azure DevOps user account is needed.
  GIT_BOT_NAME: ${scalar(n.botName)}
  GIT_BOT_EMAIL: ${scalar(n.botEmail)}
  # Exact project-scoped filename under Pipelines > Library > Secure files.
  GPG_SECURE_FILE: ${scalar(n.secureFile)}

steps:
  - checkout: self
    fetchDepth: 0 # full history: the engine reads origin/develop and origin/master
    fetchTags: true # new pipelines otherwise skip tags; the engine needs them
    persistCredentials: true # later steps push as the build service identity

  - task: UsePythonVersion@0
    inputs:
      versionSpec: '3.12'

  - bash: git clone --branch "$GIT_TOOLS_REF" "$GIT_TOOLS_REPO" "$ENGINE_PATH"
    displayName: Clone git-tools
    env:
      GIT_TOOLS_BUMP_SYNC_AUXILIARY: $(GIT_TOOLS_BUMP_SYNC_AUXILIARY)
      ENGINE_PATH: $(Agent.TempDirectory)/git-tools

  - bash: |
      set -euo pipefail
      export BRANCH_NAME="\${BUILD_SOURCEBRANCH#refs/heads/}"
      export PYTHONPATH="$ENGINE_PATH"
      python - <<'PY'
      import os
      from pathlib import Path

      from git_tools.generators.bumpgen import decide_version_strategy

      decision = decide_version_strategy(Path.cwd(), os.environ["BRANCH_NAME"], flow="classic")
      for key, value in decision.outputs().items():
          value = value.replace("%", "%AZP25").replace("\\r", "%0D").replace("\\n", "%0A")
          print(f"##vso[task.setvariable variable={key}]{value}")
      PY
    displayName: Decide version strategy
    env:
      BUILD_SOURCEBRANCH: $(Build.SourceBranch)
      GIT_TOOLS_BUMP_SYNC_AUXILIARY: $(GIT_TOOLS_BUMP_SYNC_AUXILIARY)
      ENGINE_PATH: $(Agent.TempDirectory)/git-tools

  - bash: |
      python - <<'PY'
      import json
      import os
      for key in sorted(os.environ):
          if key.startswith("DECISION_"):
              print(f"{key[9:].lower()}={json.dumps(os.environ[key], ensure_ascii=True)}")
      PY
    displayName: Show decision
    env:
      DECISION_SKIP: $(skip)
      DECISION_INVALID: $(invalid)
      DECISION_MODE: $(mode)
      DECISION_REASON: $(reason)
      DECISION_ERROR: $(error)
      DECISION_RELEASE_TARGET: $(release_target)
      DECISION_HOTFIX_TARGET: $(hotfix_target)
      DECISION_CURRENT_VERSION: $(current_version)
      DECISION_CURRENT_RELEASE_LINE: $(current_release_line)
      DECISION_MASTER_VERSION: $(master_version)
      DECISION_MASTER_RELEASE_LINE: $(master_release_line)
      DECISION_BOOTSTRAP_COMMITIZEN_VERSION_OK: $(bootstrap_commitizen_version_ok)
      DECISION_BOOTSTRAP_SUBJECT_OK: $(bootstrap_subject_ok)
      DECISION_CURRENT_IS_PRERELEASE: $(current_is_prerelease)
      DECISION_BUMP_ELIGIBLE: $(bump_eligible)
      DECISION_BRANCH_GATE_REF: $(branch_gate_ref)
      DECISION_BRANCH_HAS_UNIQUE_COMMITS: $(branch_has_unique_commits)
      DECISION_CREATE_TAG: $(create_tag)
      DECISION_SUBJECT: $(subject)
      DECISION_ARGS: $(args)

  - bash: |
      python - <<'PY'
      import json
      import os
      print("Decision error: " + json.dumps(os.environ["DECISION_ERROR"], ensure_ascii=True))
      PY
      exit 1
    displayName: Fail invalid release branch configuration
    condition: eq(variables['invalid'], 'true')
    env:
      DECISION_ERROR: $(error)

  - task: DownloadSecureFile@1
    name: gpgKey
    displayName: Download bot GPG private key
    inputs:
      secureFile: '$(GPG_SECURE_FILE)'
    condition: and(succeeded(), ne(variables['skip'], 'true'), ne(variables['invalid'], 'true'))

  - bash: |
      set -euo pipefail
      mkdir -p ~/.gnupg
      chmod 700 ~/.gnupg
      gpg --batch --import "$GPG_KEY_PATH"
      FPR="$(gpg --list-secret-keys --with-colons | awk -F: '/^fpr/{print $10; exit}')"
      echo "$FPR:6:" | gpg --import-ownertrust
      git config --global user.signingkey "$FPR"
      git config --global commit.gpgsign true
      git config --global tag.gpgsign true
      echo "Imported GPG key $FPR"
    displayName: Import GPG key
    env:
      GPG_KEY_PATH: $(gpgKey.secureFilePath)
    condition: and(succeeded(), ne(variables['skip'], 'true'), ne(variables['invalid'], 'true'))

  - bash: |
      set -euo pipefail
      git config user.name "$GIT_BOT_NAME"
      git config user.email "$GIT_BOT_EMAIL"
      git fetch --force --tags origin
      PYTHONPATH="$ENGINE_PATH" python - <<'PY'
      import os
      import shlex
      import subprocess
      import sys
      subprocess.run([sys.executable, "-m", "git_tools.generators.bumpgen", *shlex.split(os.environ["BUMP_ARGS"])], check=True)
      PY
    displayName: Run version bump
    env:
      GIT_TOOLS_BUMP_SYNC_AUXILIARY: $(GIT_TOOLS_BUMP_SYNC_AUXILIARY)
      ENGINE_PATH: $(Agent.TempDirectory)/git-tools
      BUMP_ARGS: $(args)
    condition: and(succeeded(), ne(variables['skip'], 'true'), ne(variables['invalid'], 'true'))

  - bash: |
      set -euo pipefail
      BRANCH_NAME="\${BUILD_SOURCEBRANCH#refs/heads/}"
      PYTHONPATH="$ENGINE_PATH" python -m git_tools.generators.publish \\
        --branch "$BRANCH_NAME" --create-tag "$CREATE_TAG"
    displayName: Push changes
    condition: and(succeeded(), ne(variables['skip'], 'true'), ne(variables['invalid'], 'true'))
    env:
      BUILD_SOURCEBRANCH: $(Build.SourceBranch)
      GIT_TOOLS_BUMP_SYNC_AUXILIARY: $(GIT_TOOLS_BUMP_SYNC_AUXILIARY)
      ENGINE_PATH: $(Agent.TempDirectory)/git-tools
      CREATE_TAG: $(create_tag)
`
}

/** A top-level `variables:` value from a workflow file, without quotes or a trailing comment. */
export function workflowVar(yaml: string, key: string): string | null {
  const m = yaml.match(new RegExp(`^\\s*${key}:\\s*(.+?)\\s*$`, 'm'))
  if (!m) return null
  const v = m[1]
  // Double quotes are written by `scalar` as JSON strings; single quotes double an inner quote.
  const dq = v.match(/^"((?:[^"\\]|\\.)*)"/)
  if (dq) { try { return JSON.parse(`"${dq[1]}"`) as string } catch { return dq[1] } }
  const sq = v.match(/^'((?:[^']|'')*)'/)
  if (sq) return sq[1].replace(/''/g, "'")
  return v.replace(/\s+#.*$/, '').trim()
}

/** The names a repository's existing workflow uses, falling back to the project's defaults. */
export function namesFrom(yaml: string | null | undefined, project: string): VersioningNames {
  const d = defaultNames(project)
  if (!yaml) return d
  return {
    botName: workflowVar(yaml, 'GIT_BOT_NAME') ?? d.botName,
    botEmail: workflowVar(yaml, 'GIT_BOT_EMAIL') ?? d.botEmail,
    secureFile: workflowVar(yaml, 'GPG_SECURE_FILE') ?? d.secureFile,
    gitToolsRef: workflowVar(yaml, 'GIT_TOOLS_REF') ?? d.gitToolsRef,
  }
}
