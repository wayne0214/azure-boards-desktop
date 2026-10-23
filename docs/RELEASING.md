# Branches, versions and releases

Boards uses Git Flow with [git-tools](https://github.com/davidyytan/git-tools) doing the versioning. You create and merge branches with plain git and GitHub pull requests. CI then bumps the version, commits it and pushes a `vX.Y.Z` tag. You build the release from that tag on your Mac and upload it with `scripts/release-local.sh`.

| Branch | What it holds | Version CI gives it |
|---|---|---|
| `master` | What is released | `X.Y.Z` plus a signed tag `vX.Y.Z`, which you build and release |
| `develop` | The next release, being integrated | `X.Y.Z-alpha.N`, tagged |
| `feature/<name>`, `bugfix/<name>` | One change, merged into `develop` by PR | none |
| `release/X.Y.Z` | A release being stabilised, cut from `develop` | `X.Y.Z-rc.N`, tagged |
| `hotfix/<name>` | An urgent fix, cut from `master` | next patch `-rc.N`, tagged |

The production branch is `master`, not `main`. git-tools only promotes stable versions from a branch named `master`.

`.cz.toml` holds the version and is the only source of truth for it. Each bump also updates `package.json`, `package-lock.json`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`. `tauri.conf.json` reads its version from `package.json`. Don't edit any of these versions by hand.

## Workflows

| File | Runs on | Does |
|---|---|---|
| `.github/workflows/ci.yml` | PRs into `master`, `develop`, `release/**` and `hotfix/**`; pushes to `develop` | `npm test`, `npm run build`, `cargo test` (macOS) and `cargo check` (Windows) |
| `.github/workflows/version-bump.yml` | Pushes to the Git Flow branches | git-tools release-led flow: a signed bump commit and tag, pushed over SSH as the bot |
| `.github/workflows/release-windows.yml` | A manual run only, given a tag | **Build Windows**: builds the Windows installer for that tag and adds it, with its `latest.json` entry, to the tag's release |
| `.github/workflows/release.yml` | A manual run only, on a tag | Fallback: builds both platforms on GitHub's runners into a draft release. It needs the optional secrets below. |

No workflow builds installers on its own. The macOS build comes from [your Mac](#releasing-from-your-mac); the Windows build comes from [Build Windows](#windows).

## One-time setup

### Secrets and variables

Add these under **Settings → Secrets and variables → Actions**. Never put them in a file in the repo. The version bot needs the first three rows:

| Name | Kind | What it is |
|---|---|---|
| `BOT_SSH_SECRETKEY` | secret | Private half of a new, passphrase-less SSH key (`ssh-keygen -t ed25519 -N "" -f boards-bot`). Add the `.pub` half as a deploy key with **Allow write access**. |
| `BOT_GPG_SECRETKEY` | secret | A new, passphrase-less GPG key for the bot: `gpg --export-secret-key -a <KEYID>`. |
| `GIT_BOT_NAME`, `GIT_BOT_EMAIL` | variables | The name and email on that GPG key. To get the commits shown as Verified, add the public GPG key to a GitHub account that owns that email. |

**Build Windows** needs these:

| Name | Kind | What it is |
|---|---|---|
| `TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | secrets | The updater key's contents (`~/.tauri/boards.key`) and its password; see [Updater key](#updater-key). |
| `UPDATER_PUBKEY` | variable | The contents of `~/.tauri/boards.key.pub`. |
| `TEAMUP_API_KEY` | secret | The Teamup API key built into the app for Meeting Rooms (the same value as `src-tauri/teamup.key`). Without it, the Windows build has no room booking. |

Only the fallback `release.yml` also needs these. Skip them if you release the Mac app from your Mac:

| Name | Kind | What it is |
|---|---|---|
| `APPLE_CERTIFICATE` | secret | The "Developer ID Application: Jia Hao Lai (96JNPWR556)" certificate and its private key, exported from Keychain Access as `.p12`, then `base64 -i cert.p12 \| pbcopy`. |
| `APPLE_CERTIFICATE_PASSWORD` | secret | The password you chose when exporting the `.p12`. |
| `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` | secrets | Used for notarization: your Apple ID, an app-specific password from appleid.apple.com, and `96JNPWR556`. |

For the fallback: if the Apple secrets are missing, the Mac app is signed ad hoc; if the updater key is missing, the release doesn't update itself.

### Updater key

Updates are signed with a key of your own, separate from Apple code signing. Create it once, and choose a password when asked:

```bash
npm run tauri signer generate -- -w ~/.tauri/boards.key
```

`scripts/release-local.sh` uses `~/.tauri/boards.key` and `boards.key.pub` from there. **Build Windows** needs the same key as GitHub secrets, so that both platforms' updates verify against the one public key built into the app. The app looks for `latest.json` on this repository's latest release; to host it elsewhere, set `UPDATER_ENDPOINT` to an `https://` URL.

Keep the private key safe. If you lose it, installed copies can no longer update, and users have to install the next version by hand. A release built without the key works, but it doesn't update itself, so users of that version have to install the next one by hand.

### Repository settings

- **General → Pull Requests**: allow squash merging only, with the default message set to **Pull request title**. Turn off merge commits and rebase merging.
  - git-tools reads the subject of the merged commit, so the PR title is what drives each bump. GitHub's default `Merge pull request #…` subject would break it.
- **Rules → Rulesets**, branch ruleset for `master` and `develop`:
  - require a pull request before merging;
  - require the status checks `frontend`, `rust (macos-latest)` and `rust (windows-latest)`;
  - block force pushes and deletion;
  - add **Deploy keys** to the bypass list, so the bot can push its bump commits.
- **Rules → Rulesets**, tag ruleset for `v*`: restrict creation, updates and deletion, with **Deploy keys** on the bypass list.
- Rulesets on a private repo need GitHub Pro or Team. On the free plan, make the repo public or skip the rulesets.

## Day to day

Install git-tools once. It needs Python 3.12 and [uv](https://docs.astral.sh/uv/).

```bash
git clone https://github.com/davidyytan/git-tools.git ~/tools/git-tools
cd ~/tools/git-tools && ./install.sh
```

After every merge, wait for the **Version Bump** run to finish. Then run `git pull --ff-only` and `git fetch --tags` before you branch again. The bot will have pushed a commit.

### Feature

```bash
git switch develop && git pull --ff-only
git switch -c feature/<name>
# work…
git add -A && git-tools commit        # writes a Conventional Commit message and commits; --no-commit to preview
git push -u origin feature/<name>
git-tools pr --base develop           # prints a PR title and body
```

1. Open the PR into `develop` with a Conventional Commit title (`feat: …`, `fix: …`) and squash-merge it.
2. CI tags the next `-alpha.N`: `feat` raises the minor version, `fix`, `perf` and `refactor` raise the patch, and `!` or `BREAKING CHANGE` raises the major.

### Release

```bash
git switch develop && git pull --ff-only
git switch -c release/1.1.0           # exactly release/X.Y.Z, no "v"
git commit --allow-empty -m "chore: open release 1.1.0"
git push -u origin release/1.1.0      # CI: v1.1.0-rc.0
```

1. Push stabilisation fixes straight to the release branch. Each push makes the next `rc`.
2. Run `git-tools pr --base master --release-pr`.
3. Open the PR `release/1.1.0` → `master` titled exactly `Release 1.1.0`, and squash-merge it. Keep the source branch for now.
4. CI commits the version `1.1.0` and pushes the tag `v1.1.0`.
5. Build and upload the macOS app from your Mac ([Releasing from your Mac](#releasing-from-your-mac)), and run **Build Windows** on the tag ([Windows](#windows)). Check the draft has both, then click **Publish**. The in-app updater sees the new version once the release is published.
6. Back-merge into `develop`; see [Back-merge](#back-merge).

### Hotfix

```bash
git switch master && git pull --ff-only
git switch -c hotfix/<name>
git add -A && git-tools commit
git push -u origin hotfix/<name>      # CI: v1.1.1-rc.0
git-tools pr --hotfix-pr
```

1. Open the PR into `master` titled `Hotfix 1.1.1` and squash-merge it. CI tags `v1.1.1`.
2. Release it from your Mac and with **Build Windows**, as for a release.
3. Back-merge into `develop`.

### Releasing from your Mac

You need, once: the Developer ID certificate in your Keychain, an app-specific password from appleid.apple.com, the [updater key](#updater-key), and `gh auth login`. Then, for each `vX.Y.Z` tag:

```bash
git fetch --tags && git checkout v1.1.0
export APPLE_ID=you@example.com APPLE_PASSWORD=<app-specific password> APPLE_TEAM_ID=96JNPWR556
./scripts/release-local.sh v1.1.0
git switch develop
```

The script checks that you're on a clean checkout of exactly that tag, and that the tag matches the version in `package.json`. Then it:

1. builds the universal app, signs it with your Developer ID and notarizes it;
2. signs the update bundle with the updater key;
3. adds the macOS entries to `latest.json`, keeping a Windows entry already on the release;
4. uploads all of it to a draft release on the tag.

It asks for the updater key's password unless `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` is set. Run it again to replace the files on a draft. A prerelease tag (`v1.1.0-rc.0`) makes a prerelease, which the in-app updater ignores. Put `teamup.key` in `src-tauri/` first, or the build has no room booking.

#### Windows

GitHub builds the Windows installer:

1. In the Actions tab, open **Build Windows** and choose **Run workflow**.
2. Enter the tag (`v1.1.0`) and run it.

Until this workflow reaches `master` with the first release that includes it, GitHub shows no **Run workflow** button. Start it from `develop` instead:

```bash
gh workflow run release-windows.yml --ref develop -f tag=v1.0.0
```

It takes about 15 minutes. It builds that tag with the updater key, adds `Boards_<version>_x64-setup.exe` and its `.sig` to the tag's release, and adds the Windows entry to the release's `latest.json`. If the release doesn't exist yet, it creates the draft.

Run it before or after `release-local.sh`, but not at the same time, because both rewrite `latest.json`. Publish once both are on the draft: a release without the Windows entry has no Windows download, and Windows copies don't see it as an update.

If you build on a Windows machine instead, pass the folder with the installer and its `.sig` to `release-local.sh --windows <dir>`.

As a fallback, run **Build installers** from the Actions tab on the tag. It builds both platforms on GitHub's runners, once the optional secrets are set.

### Back-merge

Do this after every release or hotfix, so `develop` gets the fixes without taking `master`'s version. The example uses release 1.1.0.

1. Sync `develop` into the release branch. The commit subject must be exactly this, so CI treats it as a prep bump with no tag:

   ```bash
   git switch release/1.1.0 && git pull --ff-only
   git fetch origin develop
   git merge origin/develop -m "chore: merge develop for backmerge"
   git push
   ```

2. Build the back-merge on a temporary branch cut from `develop`, keeping `develop`'s version files:

   ```bash
   git switch develop && git pull --ff-only && git fetch --tags
   git switch -c integration/backmerge-release-1.1.0
   git fetch origin release/1.1.0
   git merge --no-ff --no-commit origin/release/1.1.0
   git restore --source=origin/develop -- .cz.toml package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock
   git commit -m "chore: backmerge release 1.1.0"
   git push -u origin integration/backmerge-release-1.1.0
   git-tools pr --base develop --backmerge-release-pr --workflow-version 1.1.0
   ```

3. Open the PR into `develop` titled `Backmerge Release 1.1.0` and merge it. For a hotfix, use `--backmerge-hotfix-pr` and the title `Backmerge Hotfix X.Y.Z`.
4. Delete the release (or hotfix) branch and the integration branch.

### If a tag didn't get pushed

Don't re-run the workflow, and never force-push. From a clean checkout of that branch, run:

```bash
PYTHONPATH=~/tools/git-tools python3 -m git_tools.generators.publish --branch <branch> --recover-tag
```
