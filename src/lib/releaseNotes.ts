import { version as packageVersion } from '../../package.json'

export interface ReleaseNote {
  version: string
  highlights: { title: string; detail: string }[]
  /** Smaller changes, one line each. */
  more: string[]
}

/** Shown once in What's New after an update to that version. Newest first; add one per release. */
export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '1.5.0',
    highlights: [
      {
        title: 'Test results, without opening Azure DevOps',
        detail: 'Press History on a test case to see every recorded result, newest first, from Playwright runs and manual runs alike. Open one to see which step failed and why, the stack trace, and its screenshots and logs. In Test Plans, press Result on a point, or Last result and History in the runner.',
      },
      {
        title: 'Versions from your repository\'s tags',
        detail: 'The version boxes in Test Plans and in Test Cases Run suggest the repository\'s release tags, newest first, with pre-releases on request. You can still type any version; one without a tag is marked untagged and runs as usual.',
      },
    ],
    more: [
      'Your AI tool can list test results, read a result with its steps, and save a failure screenshot or log to look at.',
    ],
  },
  {
    version: '1.4.0',
    highlights: [
      {
        title: 'Your project wiki, in Boards',
        detail: 'Open Wiki in a project to read, search and edit its Azure DevOps wiki next to your work. Paste or drop images into a page, and #123 links show the item\'s title. Your AI tool can read and write wiki pages too.',
      },
      {
        title: 'Meeting notes that turn into work',
        detail: 'New pages can start from a template: meeting notes, a decision, feedback, a sprint review or release notes. Press Notes on a room booking for notes with the time, room and organiser filled in. Action items like "- [ ] @Name do this" become Tasks with one click, linked back on the page.',
      },
      {
        title: 'Live blocks',
        detail: 'Add a Live block to a page to show work items, a requirement, pull requests, the decision log or feedback as they are right now, each time the page is opened.',
      },
      {
        title: 'See what changed since you looked',
        detail: 'Pages your teammates changed since you last looked are marked in the Wiki, counted in the sidebar, and listed in My Work and mini mode. @mention someone in a page, and mentions of you are highlighted.',
      },
      {
        title: 'Sprint reviews and release notes, drafted',
        detail: 'Start a sprint review from the sprint\'s items, or release notes from the pull requests merged since a date, then edit and save.',
      },
    ],
    more: [
      'The details panel lists the wiki pages that mention the item.',
      'Feedback pages can be linked to the requirement they became, and the feedback list shows each as Waiting, In progress or Shipped.',
      'Your AI tool can attach screenshots to a bug, and open a pull request form filled in for you to check.',
      'Imports: edit the file\'s text for a row before applying it.',
      'Notifications now show as a banner on macOS even while Boards is in front.',
    ],
  },
  {
    version: '1.3.0',
    highlights: [
      {
        title: 'Mini mode',
        detail: 'Press Cmd/Ctrl+Shift+D, or choose View → Mini Mode, for a small window that stays on top. It shows reviews waiting on you, your pull requests, what you are working on, mentions and your next room booking. Click anything to go back to the full window at that item.',
      },
      {
        title: 'Paste a screenshot to report a bug',
        detail: 'Press Cmd/Ctrl+V with an image on the clipboard and a new Bug opens with it in the Symptom, the same as dropping a screenshot on the window. In mini mode the bug form opens over the small window.',
      },
      {
        title: 'Versioning',
        detail: 'A new Versioning page in each project checks every repository for git-tools version bumps on Azure Pipelines, and walks you through setting up what is missing. It asks before it changes anything.',
      },
      {
        title: 'One Testing item',
        detail: 'Test Cases and Test Plans share one Testing item in the sidebar, with a switch in the toolbar. Testing opens whichever you used last.',
      },
    ],
    more: [
      'Meeting Rooms shows times in 12-hour format (9:00am, 1:30pm).',
      'The sign-in screen lists which token access each feature needs.',
      'Timesheet: Save & submit now submits the week, and only says so when the rows read back as Submitted.',
      'Pull request titles no longer squeeze to one letter per line in a narrow pane.',
    ],
  },
  {
    version: '1.2.0',
    highlights: [
      {
        title: 'Work on Boards from Claude Code and Codex',
        detail: 'Boards can run a local MCP server, so your AI coding tool can find, read, create and update work items, test cases included. Turn it on in Settings → AI tools.',
      },
      {
        title: 'Review imports before anything is written',
        detail: 'Ask your AI tool to compare a markdown file with Boards: User Needs, Design Inputs, SRS or test cases. It stages what is new, changed or missing, and you review it side by side in Imports, decide each conflict and apply only what you pick.',
      },
      {
        title: 'Nothing is deleted by an import',
        detail: 'Items no longer in the file are set to Removed, tagged "Removed by import" and given a comment, so they can always be brought back. They are left unpicked until you choose them.',
      },
      {
        title: 'Test cases by conversation',
        detail: 'Steps and the requirements a test case covers can be read and changed by talking to your AI tool, and QA can import a testcase.md the same way as the SRS.',
      },
      {
        title: 'Export to markdown',
        detail: 'Your AI tool can export the SRS or test cases to a .md file, with each item under its parent and each test case with its steps.',
      },
    ],
    more: [
      'Settings has a new two-pane layout, grouped by topic.',
      'The details panel is clearer and resizable, and always offers Acceptance Criteria when the type has it.',
      'Timesheet: "Clear cookies" recovers a blank timesheet window.',
      'This What\'s New window appears once after each update. Open it again from Help → What\'s New.',
    ],
  },
]

/** The version this build was made from (the desktop app takes its version from package.json too). */
export const APP_VERSION: string = packageVersion

/** "1.2.0-rc.1" → "1.2.0": a release candidate shares its release's notes. */
export const baseVersion = (v: string) => v.trim().replace(/^v/, '').split(/[-+]/)[0]

export const notesFor = (version: string) => RELEASE_NOTES.find((n) => n.version === baseVersion(version)) ?? null

const SEEN = 'whatsNew.seen'

interface Store { getItem(key: string): string | null; setItem(key: string, value: string): void }

function storage(): Store | null {
  try { return localStorage } catch { return null }
}

/**
 * Called once per launch. Returns the version whose notes to show, or null. Each version is shown once;
 * a fresh install (nobody signed in yet) is recorded without showing anything.
 */
export function whatsNewOnLaunch(signedIn: boolean, version = APP_VERSION, store = storage()): string | null {
  if (!store) return null
  try {
    const seen = store.getItem(SEEN)
    if (seen !== null && baseVersion(seen) === baseVersion(version)) return null
    store.setItem(SEEN, version)
    return signedIn && notesFor(version) ? baseVersion(version) : null
  } catch {
    return null
  }
}
