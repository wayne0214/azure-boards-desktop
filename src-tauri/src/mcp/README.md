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
| `create_work_item`, `update_work_item`, `add_comment` | yes |

## Connect

Copy the setup from Settings. It looks like this:

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

## Remove it

Everything is in these places:

1. Delete this folder, `src-tauri/src/mcp/`.
2. `src-tauri/src/lib.rs`: remove `mod mcp;`, `mcp::init(app.handle());`, and the four `mcp::mcp_*` commands.
3. `src-tauri/Cargo.toml`: remove `tiny_http` and `getrandom` (under the "MCP server" comment).
4. Delete `src/lib/mcp.ts` and `src/components/sheets/McpSettings.tsx`.
5. `src/main.tsx`: remove the `startMcpBridge` import and call.
6. `src/components/sheets/SettingsSheet.tsx`: remove the `McpSettings` import and `<McpSettings />`.

A leftover `mcp.json` in the app config folder is harmless.
