# MCP server

Lets AI coding tools (Claude Code, Codex, anything that speaks MCP) read and change Azure DevOps
work items through the account Boards is already signed in to, and see which item is open in the app.

Off by default. Turn it on in **Settings → AI tools (MCP)**.

## How it works

- The app listens on `http://127.0.0.1:47615/mcp` (MCP Streamable HTTP, plain JSON replies, no sessions).
- Every request needs `Authorization: Bearer <token>`. The token and the on/off switch live in
  `mcp.json` in the app config folder (file mode 0600 on macOS/Linux).
- Requests with a non-loopback `Host`, or an `Origin` from a web page, are refused (DNS rebinding).
- Tool calls use the app's own Azure DevOps client and keychain token, so nothing else needs signing in.
- The UI sends what is open (org, project, team, selected item) to `mcp_set_context`; `get_context` returns it.
- After a write, the server emits `mcp-changed` and the UI reloads that item.
- **Read-only** mode removes the write tools from the list entirely.

| Tool | Writes |
|---|---|
| `get_context`, `get_work_item`, `search_work_items`, `list_my_work`, `list_children`, `list_comments`, `list_work_item_types` | no |
| `find_work_items`: by type, state, sprint, assignee, changed-since, text, or key (an ID field such as "SRS ID") | no |
| `get_item_changes`: field-by-field history, optionally since a date | no |
| `export_work_items`: full text of many items at once (e.g. the whole SRS) as markdown or JSON, in pages | no |
| `stage_import`, `get_import_result`: stage a bulk import for review in Boards → Imports (see below) | no (the user applies it in the app) |
| `plan_work_item_sync`: dry run of a bulk import approved in the chat | no |
| `create_work_item`, `update_work_item`, `add_comment`, `apply_work_item_sync` | yes |

Prompts (Claude Code shows them as `/mcp__boards__<name>`):

- `review_code_against_srs`: compare this repository's code with the SRS in scope, and list recent Boards changes.
- `import_srs_from_markdown`: read a markdown file and stage it for review in Boards → Imports.
- `import_hierarchy_from_markdown`: User Needs (Epic), Design Inputs (Feature) and Requirements from one file, staged as one import with their parents.
  Keys are matched on each type's ID field (`keyField` in `list_work_item_types`); a type whose keys live in a field
  that is not detected is named in `keyFields`, e.g. `{ "Epic": "User Need ID" }`.
- `import_test_cases_from_markdown`: the same for test cases, with their steps and the requirements they test.
- `report_bug_from_screenshot`: write a Bug's title, Repro Steps and Symptom from a screenshot and a note, and create it
  with the screenshot in the Symptom.

### Screenshots (`images`)

An AI tool sees an image pasted into its chat but cannot pass its bytes on, so `create_work_item` and `update_work_item`
take `images`: full file paths (`file://` URLs and `~/` work too) or `"clipboard"`, which Boards reads itself (`images.rs`).
On the clipboard, a copied file is used as it is; a screenshot is saved as PNG.

- Only PNG, JPEG, GIF and WebP (checked by their bytes, not the name), up to 25 MB each and 10 per call.
  Relative paths are refused: the server cannot tell which folder the AI tool means.
- Every image is read before anything is written, then uploaded as a work item attachment and added as `<img>`
  after the text of the type's Symptom field (`Microsoft.VSTS.CMMI.Symptom` or one named Symptom), else
  Repro Steps, else Description; `imageField` picks another. Text the call sets for that field comes first;
  on update, what the field already has is kept.
- The reply's `imagesAddedTo` names the field.

### Test cases

Steps live in `Microsoft.VSTS.TCM.Steps` as XML (`steps.rs`, the same format as the app's step grid).
The tools read them as numbered text ("1. Open the report / Expected: …") and take them as
`steps: [{ "action", "expected" }]` or numbered lines. `tests: ["SRS-0012"]` links a test case to the
requirements it tests (Tested By); links are only ever added.

- Export shows each test case's steps and a "Tests" line naming its requirements.
- Import compares steps as a whole list: empty in Boards → filled; different → a conflict to decide in the review.
  A test case that uses shared steps keeps its steps (a new list would drop the reference); change those in Boards.
- `create_work_item` / `update_work_item` take `steps` and `tests` too. `steps` replaces the whole list, so the AI
  reads the current steps first and sends them back with the change.

### Export

`export_work_items` takes the same filters as `find_work_items` (or a list of `ids`) and returns every
filled-in field, rich text as plain text, children right after their parent. Bookkeeping fields (dates,
"changed by", area/iteration) are left out unless named in `fields`. A page stops at about 60,000 characters
(under Claude Code's limit for one tool result); `nextOffset` says where the next page starts.

### Bulk import: staged, reviewed in the app

`stage_import` plans the items like `plan_work_item_sync` (below) and keeps the plan in `mcp-imports.json`
in the app config folder; nothing is written. The **Imports** page (sidebar, with a count of imports waiting)
plans it again against Boards as it is now and shows each row as **New**, **Changed** (empty fields to fill),
**Conflict** (Boards has different text: keep Boards or use the file, per field), **Only in Boards**,
**Error** or **Unchanged**, with the text before and after. New and changed rows start picked; picking a row
also picks a parent created by the same import.

With `removeMissing: true` (only when the user says the file is complete), items of the file's types
that the file does not have show as **Only in Boards**, unpicked. Applying one never deletes it: it is set
to Removed when its type has that state, tagged `Removed by import`, and gets a comment naming the file.

**Apply** writes only the picked rows. Each row carries the item's revision from the review; if the
item changed since, that row is left alone and reported. `get_import_result` tells the AI tool what was applied.
Staging the same `source` again replaces a pending import of it.

### Bulk import in the chat (plan, then apply)

`plan_work_item_sync` takes a list of items (`key`, `title`, `fields` by display or reference name,
`parentKey` or `parentId`) and matches each against Boards: first by the type's ID field (e.g. `Custom.SRSID`),
then by exact title for an item without a different key. Each row comes back as:

- **create**: not in Boards yet.
- **update**: found, and some fields are empty in Boards, so they will be filled.
- **skip**: found and already the same.
- **error**: unknown field or type, ambiguous match, or a parent key that matches nothing.

Text that differs from Boards is reported as a **conflict** and left alone, unless the plan is made with `overwrite: true`.
`apply_work_item_sync` takes the `planId`, checks Boards still matches the plan, and only then writes.
If something changed in between, it writes nothing and returns a new plan. ID fields stored as rich text
(`<div>SRS-0005</div>`) are searched by words, then compared as plain text.

## Connect

In **Settings → AI tools (MCP)** press **Turn on & set up**. Boards turns the server on and sets up every tool it finds:

- **Claude Code**: runs `claude mcp add --scope user …` (found on the login shell's PATH).
- **Codex**: writes a `[mcp_servers.boards]` table into `~/.codex/config.toml`, keeping everything else as it is.
  The file is copied to `config.toml.before-boards` before the first change.

Each tool then shows as set up, not set up, set up with an old token, or not found on this computer, with
Set up / Update / Remove buttons. **New token** sets up again every tool that was set up, so nothing breaks.
`cargo test -- --ignored setup_round_trip` runs the real setup and removal in a throwaway home folder.

To set a tool up by hand, the copy buttons give the same setup. It looks like this:

```bash
claude mcp add --scope user --transport http boards http://127.0.0.1:47615/mcp --header "Authorization: Bearer <token>"
```

Codex, in `~/.codex/config.toml`:

```toml
[mcp_servers.boards]
url = "http://127.0.0.1:47615/mcp"
http_headers = { Authorization = "Bearer <token>" }
```

The app must be running for the tools to answer.

Codex has no slash commands for MCP prompts. Put the steps in the project's `AGENTS.md` instead:

```markdown
## Requirements (SRS) in Azure DevOps Boards
Use the `boards` MCP tools. Requirements have an SRS ID (e.g. SRS-0005); find them with find_work_items
(key, types ["Requirement"], iteration "current") and see recent edits with get_item_changes.
- "Check my code against the SRS": for each requirement, search this repo for its SRS ID and work item ID
  (AB#1234), compare the code with the specification and each acceptance criterion, and report
  met / partly met / missing with file:line. Report only; change nothing.
- "Import SRS from <file>.md": read the file and call stage_import with source "<file>.md"; set
  removeMissing only if I say the file is complete. Then tell me to review it in Boards → Imports,
  and afterwards report get_import_result.
- "Import test cases from <file>.md": the same with type "Test Case", each item's `steps`
  ([{ action, expected }]) and `tests` (the SRS keys it covers).
```

## Remove it

Everything is in these places:

1. Delete this folder, `src-tauri/src/mcp/`.
2. `src-tauri/src/lib.rs`: remove `mod mcp;`, `mcp::init(app.handle());`, and the `mcp::mcp_*` commands.
3. `src-tauri/Cargo.toml`: remove `tiny_http` and `getrandom` (under the "MCP server" comment).
4. Delete `src/lib/mcp.ts`, `src/components/sheets/McpSettings.tsx` and `src/components/imports/`.
5. `src/main.tsx`: remove the `startMcpBridge` import and call.
6. `src/components/sheets/SettingsSheet.tsx`: remove the `McpSettings` import and `<McpSettings />`.
7. The Imports page: remove `'imports'` from `View` in `src/store/useUiStore.ts`, and its uses in
   `src/components/shell/AppShell.tsx`, `Sidebar.tsx` and `Toolbar.tsx`, plus the "Imports" block in `src/styles/app.css`.

A leftover `mcp.json` in the app config folder is harmless. Press **Remove** for each tool first, or delete
the `boards` entry with `claude mcp remove --scope user boards` and from `~/.codex/config.toml`.
`tools::find_program` (used here to find the CLIs) can stay; it is a general helper.
