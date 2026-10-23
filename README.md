# Boards

A fast, native desktop client for **Azure DevOps** on macOS and Windows: boards, your work, pull requests, requirements and test cases in one window.

[![CI](https://github.com/wayne0214/azure-boards-desktop/actions/workflows/ci.yml/badge.svg?branch=develop)](https://github.com/wayne0214/azure-boards-desktop/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/wayne0214/azure-boards-desktop)](https://github.com/wayne0214/azure-boards-desktop/releases/latest)

Sign in to an organization once with a Personal Access Token, then switch projects and teams, drag cards across the board, review pull requests and keep track of everything assigned to you, without a browser tab per project. Built with Tauri 2, React and Rust.

## Download

Get the latest installer from [Releases](https://github.com/wayne0214/azure-boards-desktop/releases/latest):

- **macOS 11 or later** (Apple Silicon and Intel): `Boards_<version>_universal.dmg`
- **Windows 10 or later**: `Boards_<version>_x64-setup.exe`. Windows may show a SmartScreen warning for a new app; choose **More info → Run anyway**.

Installed copies update themselves: Boards checks for a new version shortly after launch and every few hours, and offers **Update and restart** (also **Boards → Check for Updates…**).

## Getting started

1. In Azure DevOps, create a Personal Access Token: open `https://dev.azure.com/<your-org>/_usersSettings/tokens` and choose **New Token**. Boards' sign-in screen has a button that opens this page once you type your organization.
2. Set **Organization** to yours, pick an expiry, and under **Scopes** choose *Custom defined*, then tick:

   | Scope | Access | Used for |
   |---|---|---|
   | Work Items | Read & write | Boards, My Work, requirements, test cases |
   | Project and Team | Read | Projects, teams and people |
   | Code | Read & write | Pull requests and Start work branches |
   | Test Management | Read & write | Test Plans (only if your access level includes it) |

3. Open Boards, type your organization (`contoso` or `https://dev.azure.com/contoso`), paste the token and connect.

You can add more organizations later, each with its own token.

## Features

**Planning**
- **Board** with your team's real columns, WIP limits, split Doing/Done columns, drag and drop, and an "Add item" in every column.
- **List** with sortable columns, multi-select and bulk assign, move and iteration changes.
- **My Work**: everything assigned to you across the organization, grouped by project.
- **Details panel** to edit title, assignee, state, iteration, priority, points, tags, description, acceptance criteria and repro steps in place, with child items, linked branches and pull requests, comments, and a history of who changed what.
- **Go to anything** (⌘K / Ctrl+K): jump to a project, find any item by number or title, or run a command.
- **Import from CSV** with column mapping and a preview, and **export** the current view to CSV.
- **Report a bug by dropping a screenshot** on the window: a new Bug opens with the image attached.

**Code** (Azure Repos)
- **Start work** on an item: creates a `feature/1234-short-title` branch (`bugfix/` for bugs), links it, sets the item Active, assigns it to you and checks it out in your local clone.
- **Pull requests**: lists for "waiting for my review", mine, active, completed and abandoned; a diff viewer with inline comment threads; votes; required and optional reviewers; linked work items; complete with squash, merge, rebase or semi-linear, with auto-complete, drafts, abandon and reactivate.
- **Generate PR text** with [git-tools](https://github.com/davidyytan/git-tools), if you have it installed.

**Quality**
- **Requirements** outline (user requirements → design inputs → software requirements) with coverage and Word/CSV export.
- **Test Cases** linked to the requirements they verify, with a keyboard step editor (paste rows from Excel), runs with Pass/Fail and screenshots, coverage, and a test specification and traceability matrix for Word or CSV. See [Test Cases setup](#test-cases-setup).
- **Test Plans** for verification and validation: one plan per project with Verification (a suite per requirement), Validation and tag-based suites, and a test point per configuration (Windows, macOS, a browser…). Each build you test is a version tagged on every run: start a run on chosen suites, run points step by step, mark or assign many at once, import Playwright or JUnit results, and save a version report with run IDs and a sign-off block for the release file. Automated tests link to test cases by ID in the title, such as `[1234]`.

**Everyday**
- **Notifications** while the app is open: a review request, an item assigned to you, a mention, or a failing check on your pull request, with a review count on the macOS Dock icon.
- **Team** view of who is working on what.
- **Timesheet** and **Meeting Rooms** integrations. See [Optional integrations](#optional-integrations).
- Native menus and shortcuts, dark and light themes, adjustable text size, and a fast start from a local snapshot of the last board you opened.

## Test Cases setup

Azure DevOps stays the source of truth: steps are stored in its own format, so test cases still open and run in the web portal and in Test Plans. A few optional fields get the most out of it. A process admin adds them once to the project's inherited process; Boards finds them by name and works without them:

- **Verification Method** (picklist: Test, Inspection, Analysis, Demonstration) on the Requirement type. Only requirements verified by Test count toward coverage.
- **Last Outcome** (picklist: Passed, Failed) and **Last Tested Release** (text) on the Test Case type.

Each run is saved as a comment on the test case. To import a spreadsheet, save it from Excel as CSV (UTF-8).

## Optional integrations

**Timesheet.** Fills and submits a weekly timesheet on a TimeSheet web app (a Blazor Server site with Microsoft sign-in and no API) by operating the real page in a hidden window. Enter the site's address in **Settings → Timesheet**, then sign in once in the window that opens. It was written for one particular site; for another, the page scripts in [`src/lib/timesheet/agent.ts`](src/lib/timesheet/agent.ts) are the place to adapt.

**Meeting Rooms.** Books rooms on a [Teamup](https://www.teamup.com) calendar, where each sub-calendar is a room. Paste the calendar's Teamup link in **Settings → Meeting rooms**. Room booking needs a Teamup API key built into the app; see [Building from source](#building-from-source).

## Privacy and security

- Tokens are stored only in the macOS Keychain or Windows Credential Manager, and are sent only to `dev.azure.com` and `*.visualstudio.com`.
- Everything else stays on your computer: there is no telemetry and no server of ours in between.
- HTML from Azure DevOps is sanitized before it is shown, the window runs under a strict Content Security Policy, and links open in your browser.
- The app reads and writes files only where you choose in its open and save dialogs.
- The timesheet window may only show the address you set and Microsoft sign-in pages.

To report a security issue, please open a [private security advisory](https://github.com/wayne0214/azure-boards-desktop/security/advisories/new) rather than a public issue.

## Building from source

Prerequisites: Node 22+, Rust stable, and the platform toolchain (Xcode Command Line Tools on macOS; Visual Studio Build Tools with C++ on Windows).

```bash
npm install
npm run app:dev              # the desktop app with hot reload
npm run dev                  # the UI alone in a browser, with demo data (no Azure DevOps needed)
npm test                     # frontend unit tests
cd src-tauri && cargo test   # Rust unit tests
```

Installers, built on their own platform:

```bash
npm run installer:mac   # .dmg (universal when both Rust targets are installed)
npm run installer:win   # NSIS setup .exe, in PowerShell
```

For Meeting Rooms, put a Teamup API key in `src-tauri/teamup.key` (git-ignored) or set `TEAMUP_API_KEY` before building. The key is built into the app, and anyone with the app can read it out, so use a key limited to the rooms calendar.

A local macOS build is signed ad hoc, so macOS asks once before the first launch: open **System Settings → Privacy & Security** and choose **Open Anyway**. Release builds are signed with a Developer ID and notarized.

## Contributing

Issues and pull requests are welcome. Branches follow Git Flow: branch from `develop` as `feature/<name>` or `bugfix/<name>`, and open the pull request into `develop` with a [Conventional Commit](https://www.conventionalcommits.org) title such as `feat: …` or `fix: …`. CI runs the tests on every pull request. Versions and releases are automated; see [docs/RELEASING.md](docs/RELEASING.md).

### Project layout

```
src/                    React UI (TypeScript)
  components/           views: board, list, inspector, my work, pr, requirements, testcases, timesheet, rooms…
  store/                Zustand stores, one per area
  lib/                  API layer (Tauri commands, plus a demo mock for the browser) and pure logic per area
src-tauri/src/          Rust backend
  ado/                  Azure DevOps REST client: work items, WIQL, pull requests, test plans and runs
  commands.rs           commands for boards and work items
  pr_commands.rs        commands for pull requests
  plan_commands.rs      commands for Test Plans
  timesheet.rs          the hidden timesheet window and its bridge back to the app
  rooms.rs              Teamup meeting rooms
  tools.rs              local git and git-tools runs
  secrets.rs            OS keychain storage for tokens
  cache.rs settings.rs  SQLite snapshot cache; accounts and settings
  updater.rs menu.rs    self-update; native menu bar
scripts/                installer build scripts
docs/                   release process
```
