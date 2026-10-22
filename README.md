# Boards

A native desktop client for Azure DevOps Boards, for macOS and Windows. Built with Tauri 2, React 19 and Rust.

One Personal Access Token signs you into a whole organization. From there you can switch projects and teams, drag cards between columns, assign people, edit details, comment, create items in bulk from a CSV, and keep an eye on everything assigned to you across every project.

## Features

- **Board view** with the team's real columns, WIP limits, split Doing/Done columns, drag and drop, and inline "Add item" per column.
- **List view** with sortable columns, multi-select, and a bulk bar for assign / move / iteration.
- **My Work**: everything assigned to you across the organization, grouped by project. Double-click to jump to it on its board.
- **Details panel** for editing title, assignee, state, iteration, priority, points, tags, description, acceptance criteria and repro steps in place. Shows child items, linked branches and pull requests, the discussion thread (where you can post comments), and a History of who changed what and when.
- **Start work** on an item (details panel, right-click, or ⌘K): creates a `feature/1234-short-title` branch (`bugfix/` for bugs), links it to the item, sets it Active, assigns it to you, and checks it out in your local clone. The item's Development section then offers **Create PR** for that branch.
- **Notifications** while the app is open: a pull request needs your review, a work item is assigned to you, someone mentions you, or a check fails on your pull request. The Dock icon shows how many reviews are waiting (macOS). Choose which in Settings.
- **Automatic updates** in release builds (see Updates below).
- **Go to anything** (⌘K / Ctrl+K): jump to a project, find an item by number or title (including items not on the current board), or run a command.
- **Import from CSV** with column mapping and a preview; **export** the current view to CSV.
- **Native menus and shortcuts**, right-click context menus, a window that remembers its size, dark and light themes, and a text size you can grow with ⌘+.
- **Fast start**: the last board you looked at opens instantly from a local SQLite snapshot and refreshes in the background.
- **Pull requests** (Azure Repos): work items found on the branch (linked to it, to its commits, or named as #123 in commit messages) are linked when you create one, and more can be linked or unlinked later; reviewers are chosen by typing and marked required or optional; lists for "waiting for my review", mine, active, completed and abandoned; a detail view with description, checks and policies, commits, reviewers and linked work items; a diff viewer with collapsible unchanged regions and inline comment threads (comment, reply, edit, delete, resolve, reactivate); vote (approve, approve with suggestions, wait for author, reject); complete with squash, merge, rebase or semi-linear strategies, delete source branch and work item transition; auto-complete; draft toggle; abandon and reactivate; create a pull request.
- **Test Cases**: write test cases linked to the SRS they verify, with a keyboard step editor (paste rows from Excel, text mode, shared steps, test data), each step's expected result serving as its acceptance criterion, and coverage per SRS. Run them for a release with Pass/Fail and screenshots as proof (recorded on the test case, and copied to Azure Test Plans when you have access), see which test cases need review when an SRS changes, import the QA spreadsheet, and produce the test specification and traceability matrix for Word or CSV (see below).
- **Timesheet**: fills and submits the TimeSheet web app from a weekly grid in the app (see below).
- **Requirements** outline (UR → DI → SRS) with coverage and Word/CSV export, a **Team** view of who is working on what, and **Meeting Rooms** booking through Teamup.
- **Report a bug by dropping a screenshot** anywhere on the window: a new Bug opens with the image in its Symptom.
- **Multiple organizations**, each with its own token, stored in the macOS Keychain or Windows Credential Manager.

## Getting a token

1. Open your tokens page: `https://dev.azure.com/<your-org>/_usersSettings/tokens` (the sign-in screen has a button for it once you type the organization), then **New Token**.
2. Set **Organization** to your organization and pick an expiry.
3. Scopes: *Custom defined*, then tick:

   | Scope | Access | Used for |
   |---|---|---|
   | Work Items | Read & write | Boards, My Work, requirements, test cases |
   | Project and Team | Read | Projects, teams and people |
   | Code | Read & write | Pull requests and Start work branches |
   | Test Management | Read & write | Test Plans; only if your access level includes it |

4. Copy the token, open Boards, type your organization and paste the token.

## Test Cases

Azure DevOps stays the source of truth: steps use its own format, so test cases still open and run in the web portal and Test Plans. A few fields make the most of it; a process admin adds them once to the project's inherited process (the app finds them by name and works without them, with less):

- **Verification Method** (picklist: Test, Inspection, Analysis, Demonstration) on the Requirement type. Only SRS verified by Test count toward coverage.
- **Last Outcome** (picklist: Passed, Failed) and **Last Tested Release** (text) on the Test Case type.

A step's expected result is its acceptance criterion: the documents list them in the Acceptance Criteria column, numbered like the steps, and a run passes when every expected result is met. Each run is saved as a comment on the test case. To export the spreadsheet for import, save it from Excel as CSV (UTF-8).

## Timesheet

The Timesheet section drives the TimeSheet website (a Blazor Server app with no API) through a hidden window inside the app. Enter the site's address in **Settings → Timesheet** first. You sign in once in that window; the app then reads the week, lets you fill a simple grid, and saves and submits rows by operating the real page. Controls are located by their accessible labels, so routine visual changes on the site do not break it. If the site layout changes substantially, the scripts in `src/lib/timesheet/agent.ts` are the place to adjust.

## Meeting Rooms

Room booking talks to Teamup with an API key built into the app at compile time: set `TEAMUP_API_KEY` in the environment, or put the key in `src-tauri/teamup.key` (git-ignored), before building. Without it the Meeting Rooms section says the build has no key. Each user then pastes the rooms calendar's Teamup link (or its key) in **Settings → Meeting rooms**. Anyone with the built app can read the key out of it, so use a key limited to the rooms calendar.

## Security notes

- Tokens live only in the OS keychain; they are sent only to `dev.azure.com` / `*.visualstudio.com` (images in work items are fetched with the token only from those hosts).
- HTML from Azure DevOps is sanitized with DOMPurify before it is shown, the window runs under a strict Content Security Policy, and links open in your browser rather than inside the app.
- The app writes or reads files only where you chose them in its save or open dialog.
- The timesheet window may only show the TimeSheet site and Microsoft sign-in pages.

## Development

Prerequisites: Node 22+, Rust stable, and the platform toolchain (Xcode Command Line Tools on macOS; Visual Studio Build Tools with C++ on Windows).

```bash
npm install
npm run app:dev        # runs the desktop app with hot reload
npm run dev            # frontend only in a browser, with demo data (no Azure DevOps needed)
npm test               # frontend unit tests (Vitest, against the demo data)
cd src-tauri && cargo test   # Rust unit tests
```

Version numbers: `package.json` is the single source; `tauri.conf.json` reads it. Keep `src-tauri/Cargo.toml` in step when you release.

## Building installers

Releases are built by CI from `vX.Y.Z` tags; branches, versioning and the release steps are in [docs/RELEASING.md](docs/RELEASING.md). To build locally:

```bash
npm run installer:mac  # macOS: .dmg (universal if both Rust targets are installed)
npm run installer:win  # Windows (PowerShell): NSIS setup .exe
```

Each platform's installer must be built on that platform. The GitHub Actions workflow in `.github/workflows/release.yml` builds both when you push a tag like `v1.0.0` and attaches them to a draft release.

The macOS app is signed ad hoc (free, no Apple account), not notarized. On Apple Silicon and Intel alike, macOS therefore asks once before the first launch on each Mac:

1. Open Boards. macOS says it can't verify the app; click **Done**.
2. Open **System Settings → Privacy & Security**, scroll to "Boards was blocked…", and click **Open Anyway**.

Or, in Terminal, after copying Boards into Applications: `xattr -dr com.apple.quarantine /Applications/Boards.app`.

Build the universal app (`rustup target add x86_64-apple-darwin` once) so Intel Macs can run it too. To remove the prompt entirely, sign with an Apple Developer ID and notarize: set `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` and `APPLE_TEAM_ID` before building (see the comments in `scripts/`). On Windows, unsigned installers show a SmartScreen warning; click **More info → Run anyway**.

## Updates

Release builds check for a newer version shortly after launch and every few hours, and offer **Update and restart** when one is out (also **Boards → Check for Updates…**). Updates are signed with a key of your own, separate from code signing. Set it up once:

1. Generate the key pair, and choose a password when asked:

   ```bash
   npm run tauri signer generate -- -w ~/.tauri/boards.key
   ```

2. In the GitHub repository, under **Settings → Secrets and variables → Actions**:
   - Secret `TAURI_SIGNING_PRIVATE_KEY`: the contents of `~/.tauri/boards.key`.
   - Secret `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: its password.
   - Variable `UPDATER_PUBKEY`: the contents of `~/.tauri/boards.key.pub`.
   - Optional variable `UPDATER_ENDPOINT`: where the app looks for `latest.json`. It defaults to the latest GitHub release of this repository, which must then be readable by the people who install the app.

3. Push a tag as usual. The workflow signs the update files and attaches `latest.json` to the draft release. Installed apps see the update once you publish the release.

Keep the private key safe: losing it means current installs can no longer update, and they would have to install the next version by hand. Builds without the key (local builds, and CI before the secrets are set) work normally but do not update themselves. The first version with the updater has to be installed by hand.

## Project layout

```
src/                    React UI (TypeScript)
  components/
    shell/              window frame: sidebar, toolbar, status bar, drop-to-report-a-bug
    board/ list/        board and list views
    inspector/          details panel and rich text editors
    mine/ team/         My Work and Team views
    pr/                 pull requests: list, detail tabs, new/complete sheets, pickers
    requirements/       requirements outline and document
    testcases/          test case outline, editor, runs, document, import
    timesheet/ rooms/   timesheet grid and meeting rooms
    sheets/ palette/    new item, import, settings, connect; command palette
    ui/                 shared controls (dropdown, popover, sheet, error boundary, virtual rows)
  store/                Zustand stores, one per area (app, board, ui, my work, pr, req, tc, timesheet, rooms)
  lib/                  API layer (Tauri commands + browser demo mock) and pure logic per area
    pr/ testcases/ timesheet/ rooms/
src-tauri/src/          Rust backend
  ado/                  Azure DevOps REST client: work items, WIQL, pull requests, test plans
  commands.rs           Tauri commands for boards and work items
  pr_commands.rs        Tauri commands for pull requests
  timesheet.rs          the hidden TimeSheet window and its bridge back to the app
  rooms.rs              Teamup meeting rooms
  tools.rs              local git and git-tools runs
  secrets.rs            OS keychain storage for tokens
  cache.rs              SQLite snapshot cache
  settings.rs           accounts and recent targets (JSON in app config dir)
  state.rs menu.rs      shared state; native menu bar
scripts/                installer build scripts
docs/                   feature specs and plans
```
