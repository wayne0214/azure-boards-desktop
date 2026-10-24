//! Ready-made MCP prompts: step-by-step instructions for the two jobs people ask for most.
//! Claude Code shows them as slash commands (/mcp__boards__review_code_against_srs).

use serde_json::{json, Value};

pub fn list() -> Vec<Value> {
    vec![
        json!({
            "name": "review_code_against_srs",
            "title": "Check code against SRS",
            "description": "Compare this repository's code with the requirements (SRS) in Boards, and list what changed in Boards recently.",
            "arguments": [
                { "name": "scope", "description": "An SRS key or work item ID, \"current sprint\", or empty for the item open in Boards", "required": false },
                { "name": "since", "description": "Report Boards changes since this date (YYYY-MM-DD); default 14 days ago", "required": false },
            ],
        }),
        json!({
            "name": "import_srs_from_markdown",
            "title": "Import SRS from a markdown file",
            "description": "Stage the file's requirements for review in Boards → Imports: new ones, empty fields to fill (e.g. acceptance criteria), conflicts, and optionally ones no longer in the file.",
            "arguments": [
                { "name": "file", "description": "Path to the markdown file", "required": true },
                { "name": "type", "description": "Work item type for the rows; default Requirement", "required": false },
            ],
        }),
    ]
}

fn arg<'a>(args: &'a Value, name: &str) -> Option<&'a str> {
    args.get(name).and_then(Value::as_str).map(str::trim).filter(|s| !s.is_empty())
}

/// The prompt's messages, or an error message for an unknown prompt or a missing argument.
pub fn get(name: &str, args: &Value) -> Result<Value, String> {
    let text = match name {
        "review_code_against_srs" => {
            let scope = arg(args, "scope").map(|s| format!("Scope: {s}.")).unwrap_or_else(|| {
                "Scope: the work item open in Boards (get_context). If none is open, my Requirements in the current sprint \
                 (find_work_items with types [\"Requirement\"] and iteration \"current\"). If that finds nothing, ask me."
                    .to_string()
            });
            let since = arg(args, "since").map(str::to_string).unwrap_or_else(|| "14 days ago".to_string());
            format!(
                "Check my code against the requirements (SRS) in Azure DevOps Boards, and tell me what changed there.\n\n\
                 {scope}\n\n\
                 Steps:\n\
                 1. Find the requirements in scope with the boards tools (get_context, find_work_items; export_work_items for the full text of many at once, \
                 get_work_item for one). For each, note its key (e.g. SRS ID), specification text and acceptance criteria.\n\
                 2. For each requirement call get_item_changes with since = {since} and note any change to its text, acceptance criteria or state.\n\
                 3. Find the code for each requirement in this repository: search for its key (e.g. SRS-182) and work item ID (e.g. AB#3734, #3734) in code, \
                 tests and comments, in commit messages (git log --grep) and branch names; then follow the code that implements the behaviour.\n\
                 4. Compare the code with the specification and with each acceptance criterion.\n\
                 5. Report one block per requirement: key and title; status (Implemented / Partly / Not found / Code differs from spec); \
                 each acceptance criterion as met, partly met or missing, with the file:line that shows it; and changes in Boards since {since} that the code does not reflect yet.\n\n\
                 Only report: do not change Boards or the code. End with the gaps to fix, most important first."
            )
        }
        "import_srs_from_markdown" => {
            let file = arg(args, "file").ok_or("Give the markdown file's path.")?;
            let ty = arg(args, "type").unwrap_or("Requirement");
            format!(
                "Bring the requirements in {file} into Azure DevOps Boards.\n\n\
                 1. Read {file}. For each requirement work out: its key (e.g. SRS-182), title, type (default {ty}), parent key if given (e.g. DI-12), \
                 and its fields: the specification text, the (user) acceptance criteria, and any other field the file has. Keep the wording, lists and line breaks as written.\n\
                 2. If a heading or column does not obviously match a Boards field, call list_work_item_types and match by field name. Ask me if one still does not match.\n\
                 3. Ask me whether {file} is the complete list for these types. Only if I say yes, set removeMissing: true, so items only in Boards are offered for removal.\n\
                 4. Call stage_import with the items (at most 300 per call) and source \"{file}\". Do not set overwrite: I choose per conflict in Boards.\n\
                 5. If rows have errors, fix what you can and stage again. Then give me the counts (new, changed, conflicts, only in Boards, errors) \
                 and tell me to review and apply it in Boards → Imports. Nothing is written until I do.\n\
                 6. When I say I am done, call get_import_result and summarise what was applied, what failed and why."
            )
        }
        other => return Err(format!("Unknown prompt: {other}")),
    };
    let description = list().into_iter().find(|p| p["name"] == name).and_then(|p| p.get("description").cloned()).unwrap_or(Value::Null);
    Ok(json!({ "description": description, "messages": [{ "role": "user", "content": { "type": "text", "text": text } }] }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prompts_fill_in_their_arguments() {
        let p = get("import_srs_from_markdown", &json!({ "file": "docs/srs.md" })).unwrap();
        let text = p["messages"][0]["content"]["text"].as_str().unwrap();
        assert!(text.contains("docs/srs.md") && text.contains("stage_import"));
        assert!(get("import_srs_from_markdown", &json!({})).is_err());
        let r = get("review_code_against_srs", &json!({ "scope": "SRS-182" })).unwrap();
        assert!(r["messages"][0]["content"]["text"].as_str().unwrap().contains("Scope: SRS-182."));
        assert!(get("nope", &json!({})).is_err());
        assert_eq!(list().len(), 2);
    }
}
