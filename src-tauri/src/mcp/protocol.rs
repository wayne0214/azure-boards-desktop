//! The MCP JSON-RPC layer: initialize, ping, tools/list and tools/call. Transport-free, so it is tested on its own.

use super::prompts;
use serde_json::{json, Value};

/// Newest first; a client asking for one of these gets it back, anything else gets the newest.
pub const PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

pub const INSTRUCTIONS: &str = "Azure DevOps Boards, through the Boards desktop app the user is signed into. \
Call get_context first: it names the organization, the project and the work item the user has open in the app, \
so \"this item\" or \"the current story\" means that one. Requirements (SRS) have a key in an ID field such as \"SRS ID\"; \
find_work_items finds them by key, type or sprint, and get_item_changes shows what changed. To bring many items in from a file, \
use plan_work_item_sync, show the user the plan, and apply it only after they agree. Work item fields use Azure DevOps reference names \
(System.Title, System.State, Microsoft.VSTS.Common.AcceptanceCriteria); list_work_item_types shows what a type has. \
The project wiki holds the team's conventions, decisions and meeting notes: search_wiki before deciding how something should work, \
and append_to_wiki to record a decision the user asks you to keep (get_context's wikiPage is the page they have open). \
The team's pages follow a shape Boards reads: meeting notes under /Meeting notes named \"YYYY-MM-DD Topic\" with actions as \"- [ ] @Name what to do\" \
(Boards turns them into Tasks), decisions under /Decision log as \"NNNN Title\" starting with \"**Status:** Proposed · **Decided by:** Name · **Date:** YYYY-MM-DD\", \
and feedback under /Collaborator feedback with the items it became under \"## Became\" as \"- #123\".";

/// What a tool call produced: a JSON result, or an error message shown to the model.
pub type ToolOutcome = Result<Value, String>;

/// Answers one JSON-RPC message. `None` for notifications, which get no reply.
pub fn handle(msg: &Value, tools: &[Value], call: &dyn Fn(&str, Value) -> ToolOutcome) -> Option<Value> {
    let id = msg.get("id").cloned();
    let method = msg.get("method").and_then(Value::as_str).unwrap_or("");
    let Some(id) = id else {
        // notifications/initialized, notifications/cancelled, ...
        return None;
    };
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    let result = match method {
        "initialize" => {
            let asked = params.get("protocolVersion").and_then(Value::as_str).unwrap_or("");
            let version = PROTOCOL_VERSIONS.iter().find(|v| **v == asked).unwrap_or(&PROTOCOL_VERSIONS[0]);
            Ok(json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false }, "prompts": { "listChanged": false } },
                "serverInfo": { "name": "boards", "title": "Boards (Azure DevOps)", "version": env!("CARGO_PKG_VERSION") },
                "instructions": INSTRUCTIONS,
            }))
        }
        "ping" => Ok(json!({})),
        "tools/list" => Ok(json!({ "tools": tools })),
        "prompts/list" => Ok(json!({ "prompts": prompts::list() })),
        "prompts/get" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            prompts::get(name, params.get("arguments").unwrap_or(&Value::Null)).map_err(|e| (-32602, e))
        }
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            if !tools.iter().any(|t| t.get("name").and_then(Value::as_str) == Some(name)) {
                Err((-32602, format!("Unknown tool: {name}")))
            } else {
                let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
                Ok(match call(name, args) {
                    Ok(v) => json!({
                        "content": [{ "type": "text", "text": serde_json::to_string_pretty(&v).unwrap_or_default() }],
                        "isError": false,
                    }),
                    Err(e) => json!({ "content": [{ "type": "text", "text": e }], "isError": true }),
                })
            }
        }
        "" => Err((-32600, "Invalid request".to_string())),
        other => Err((-32601, format!("Method not found: {other}"))),
    };
    Some(match result {
        Ok(r) => json!({ "jsonrpc": "2.0", "id": id, "result": r }),
        Err((code, message)) => json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } }),
    })
}

/// A POST body: one message or a batch. Returns what to send back, or `None` for "202 Accepted".
pub fn handle_body(body: &str, tools: &[Value], call: &dyn Fn(&str, Value) -> ToolOutcome) -> Option<Value> {
    let parsed: Value = match serde_json::from_str(body) {
        Ok(v) => v,
        Err(_) => return Some(json!({ "jsonrpc": "2.0", "id": null, "error": { "code": -32700, "message": "Parse error" } })),
    };
    match parsed {
        Value::Array(batch) => {
            let replies: Vec<Value> = batch.iter().filter_map(|m| handle(m, tools, call)).collect();
            (!replies.is_empty()).then_some(Value::Array(replies))
        }
        single => handle(&single, tools, call),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tools() -> Vec<Value> {
        vec![json!({ "name": "echo", "inputSchema": { "type": "object" } })]
    }
    fn echo(_: &str, args: Value) -> ToolOutcome {
        if args.get("fail").is_some() { Err("nope".into()) } else { Ok(args) }
    }

    #[test]
    fn initialize_echoes_a_supported_version() {
        let r = handle_body(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}"#, &tools(), &echo).unwrap();
        assert_eq!(r["result"]["protocolVersion"], "2025-03-26");
        assert!(r["result"]["capabilities"]["tools"].is_object());
        let r = handle_body(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}"#, &tools(), &echo).unwrap();
        assert_eq!(r["result"]["protocolVersion"], PROTOCOL_VERSIONS[0]);
    }

    #[test]
    fn notifications_get_no_reply() {
        assert!(handle_body(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#, &tools(), &echo).is_none());
    }

    #[test]
    fn tool_calls_wrap_results_and_errors() {
        let ok = handle_body(r#"{"jsonrpc":"2.0","id":"a","method":"tools/call","params":{"name":"echo","arguments":{"x":1}}}"#, &tools(), &echo).unwrap();
        assert_eq!(ok["id"], "a");
        assert_eq!(ok["result"]["isError"], false);
        assert!(ok["result"]["content"][0]["text"].as_str().unwrap().contains("\"x\": 1"));
        let err = handle_body(r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"echo","arguments":{"fail":true}}}"#, &tools(), &echo).unwrap();
        assert_eq!(err["result"]["isError"], true);
        let unknown = handle_body(r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"nope"}}"#, &tools(), &echo).unwrap();
        assert_eq!(unknown["error"]["code"], -32602);
    }

    #[test]
    fn bad_input_and_unknown_methods() {
        assert_eq!(handle_body("{", &tools(), &echo).unwrap()["error"]["code"], -32700);
        let prompts = handle_body(r#"{"jsonrpc":"2.0","id":1,"method":"prompts/list"}"#, &tools(), &echo).unwrap();
        assert!(prompts["result"]["prompts"].as_array().is_some_and(|p| !p.is_empty()));
        assert_eq!(handle_body(r#"{"jsonrpc":"2.0","id":1,"method":"resources/list"}"#, &tools(), &echo).unwrap()["error"]["code"], -32601);
        let batch = handle_body(r#"[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"}]"#, &tools(), &echo).unwrap();
        assert_eq!(batch.as_array().unwrap().len(), 1);
    }
}
