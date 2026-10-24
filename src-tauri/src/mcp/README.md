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
| `plan_work_item_sync`: dry run of a bulk import (see below) | no |
| `create_work_item`, `update_work_item`, `add_comment`, `apply_work_item_sync` | yes |

Prompts (Claude Code shows them as `/mcp__boards__<name>`):

- `review_code_against_srs`: compare this repository's code with the SRS in scope, and list recent Boards changes.
- `import_srs_from_markdown`: read a markdown file, plan, wait for approval, apply.

### Bulk import (plan, then apply)

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
- "Import SRS from <file>.md": read the file, call plan_work_item_sync, show me the plan as a table,
  and call apply_work_item_sync only after I agree. Never set overwrite unless I ask.
```

## Remove it

Everything is in these places:

1. Delete this folder, `src-tauri/src/mcp/`.
2. `src-tauri/src/lib.rs`: remove `mod mcp;`, `mcp::init(app.handle());`, and the `mcp::mcp_*` commands.
3. `src-tauri/Cargo.toml`: remove `tiny_http` and `getrandom` (under the "MCP server" comment).
4. Delete `src/lib/mcp.ts` and `src/components/sheets/McpSettings.tsx`.
5. `src/main.tsx`: remove the `startMcpBridge` import and call.
6. `src/components/sheets/SettingsSheet.tsx`: remove the `McpSettings` import and `<McpSettings />`.

A leftover `mcp.json` in the app config folder is harmless. Press **Remove** for each tool first, or delete
the `boards` entry with `claude mcp remove --scope user boards` and from `~/.codex/config.toml`.
`tools::find_program` (used here to find the CLIs) can stay; it is a general helper.
