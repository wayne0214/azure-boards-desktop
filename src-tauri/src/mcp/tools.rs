//! The tools the MCP server offers, on top of the app's own Azure DevOps client and signed-in account.

use super::steps::{self, STEPS_FIELD, TESTS_REL};
use super::{context, export, fields, images, imports, pr_form, sync, McpConfig};
use crate::ado::{api, wiql};
use crate::ado::client::AdoClient;
use crate::error::AppError;
use crate::state::AppState;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager};

/// Tools that change Azure DevOps; refused while the server is read-only.
const WRITE_TOOLS: &[&str] = &["create_work_item", "update_work_item", "add_comment", "apply_work_item_sync", "append_to_wiki"];

pub fn definitions(read_only: bool) -> Vec<Value> {
    let id = json!({ "type": "integer", "description": "Work item ID, e.g. 1182" });
    let mut tools = vec![
        tool("get_context", "What the user has open in the Boards app: organization, project, team, the selected work item and the wiki page (if any). Call this first; \"this item\" means the selected one, \"this page\" the wiki page.", json!({}), &[], true),
        tool("get_work_item", "One work item with its fields (rich text as plain text), parent, children and links.", json!({ "id": id }), &["id"], true),
        tool("search_work_items", "Find work items by text in the title (or an ID). Searches the current project unless `project` is given.", json!({
            "text": { "type": "string" },
            "project": { "type": "string", "description": "Project name; omit for the current project" },
            "allProjects": { "type": "boolean", "description": "Search every project in the organization" },
        }), &["text"], true),
        tool("list_my_work", "Work assigned to the user that is not finished, including Resolved and Ready to Test items still assigned to them.", json!({}), &[], true),
        tool("list_children", "Child work items of a work item.", json!({ "id": id }), &["id"], true),
        tool("list_comments", "Discussion comments on a work item, oldest first.", json!({ "id": id }), &["id"], true),
        tool("list_work_item_types", "Work item types of a project with their states and fields (reference names), to know what can be set.", json!({
            "project": { "type": "string", "description": "Project name; omit for the current project" },
        }), &[], true),
        tool("find_work_items", "List work items by type, state, sprint, assignee, recent change, text or key (the type's ID field, e.g. an SRS ID like \"SRS-182\"). E.g. all Requirements in the current sprint, or everything changed since a date.", json!({
            "project": { "type": "string", "description": "Project name; omit for the current project" },
            "types": { "type": "array", "items": { "type": "string" }, "description": "e.g. [\"Requirement\"]" },
            "states": { "type": "array", "items": { "type": "string" }, "description": "Only these states; default all but Removed" },
            "text": { "type": "string", "description": "Words in the title or an ID field" },
            "key": { "type": "string", "description": "Exact value of an ID field, e.g. SRS-182" },
            "iteration": { "type": "string", "description": "\"current\" for the team's current sprint, or an iteration path" },
            "changedSince": { "type": "string", "description": "YYYY-MM-DD" },
            "assignedToMe": { "type": "boolean" },
            "limit": { "type": "integer", "description": "Default 100, at most 500" },
        }), &[], true),
        tool("export_work_items", "Many work items with their full text in one call, e.g. the whole SRS: every filled-in field (or just `fields`), children right after their parent. Markdown by default, ready to save as a file. Long exports come in pages: when `nextOffset` is set, call again with that `offset`. Use this rather than get_work_item for more than a few items.", export::definition_props(&id), &[], true),
        tool("get_item_changes", "What changed on a work item, field by field with old and new values, newest last. Use `since` to see only recent updates.", json!({
            "id": id,
            "since": { "type": "string", "description": "YYYY-MM-DD; omit for the whole history" },
        }), &["id"], true),
        tool("stage_import", "Bring many work items into Boards (e.g. SRS or test cases from a markdown file) for the user to review in the Boards app. Plans it like plan_work_item_sync (match by key, then exact title; create, fill empty fields, conflicts where Boards has different text) and stages the plan; nothing is written. Then tell the user to review and apply it in Boards → Imports, and use get_import_result to see what they applied. Preferred over plan/apply for more than a few items. Staging the same `source` again replaces the earlier pending import.", {
            let mut p = sync_props();
            if let Some(o) = p.as_object_mut() {
                o.remove("overwrite");
            }
            p
        }, &["items"], true),
        tool("get_import_result", "Whether the user applied a staged import, and what happened to each row.", json!({
            "importId": { "type": "string", "description": "From stage_import; omit for the newest" },
        }), &[], true),
        tool("plan_work_item_sync", "Dry run for bringing a few work items into Boards, approved in this chat. For many items use stage_import instead, so the user reviews them in Boards. Matches each item by its key (the type's ID field, e.g. SRS ID), then exact title, and returns a plan per row: create, update (fill fields that are empty in Boards), skip (already the same) or error, plus conflicts where Boards already has different text. Writes nothing.", sync_props(), &["items"], true),
        // Creates nothing, so read-only mode keeps it: the user clicks Create in the form.
        tool("open_pull_request_form", "Open Boards' New pull request form filled in with these values, for the user to review and create. Nothing is created by this call. Checks the repository and that both branches exist (the source must be pushed).", pr_form::schema(), &["repository", "sourceBranch", "title"], false),
    ];
    tools.extend(super::wiki::definitions(read_only));
    if !read_only {
        tools.extend([
            tool("create_work_item", "Create a work item. Text in `description` may be plain text or HTML. For a bug, put numbered steps in Microsoft.VSTS.TCM.ReproSteps and what the user sees in the Symptom field when the type has one (list_work_item_types), and attach screenshots with `images`.", json!({
                "type": { "type": "string", "description": "Work item type, e.g. Bug, Task, User Story, Requirement" },
                "title": { "type": "string" },
                "description": { "type": "string" },
                "parentId": { "type": "integer", "description": "Make it a child of this work item" },
                "assignedTo": { "type": "string", "description": "Email or display name; \"me\" for the user" },
                "project": { "type": "string", "description": "Project name; omit for the current project" },
                "fields": { "type": "object", "description": "Any other fields by reference name" },
                "steps": steps_schema(),
                "tests": tests_schema(),
                "images": images_schema(),
                "imageField": image_field_schema(),
            }), &["type", "title"], false),
            tool("update_work_item", "Change fields of a work item: title, state, assignee, description or any field by reference name. For a test case, `steps` replaces the whole list: read the current steps with get_work_item first and send them all back with your change.", json!({
                "id": id,
                "title": { "type": "string" },
                "state": { "type": "string", "description": "e.g. Active, Resolved, Closed (see list_work_item_types)" },
                "assignedTo": { "type": "string", "description": "Email or display name; \"me\" for the user, \"\" to unassign" },
                "description": { "type": "string", "description": "Plain text or HTML" },
                "fields": { "type": "object", "description": "Other fields by reference name; null clears one" },
                "steps": steps_schema(),
                "tests": tests_schema(),
                "images": images_schema(),
                "imageField": image_field_schema(),
            }), &["id"], false),
            tool("add_comment", "Add a discussion comment to a work item. Plain text; line breaks are kept.", json!({ "id": id, "text": { "type": "string" } }), &["id", "text"], false),
            tool("apply_work_item_sync", "Carry out a plan from plan_work_item_sync, exactly as shown. Call only after the user has seen the plan and agreed. If Boards changed meanwhile, nothing is written and a new plan is returned.", json!({
                "planId": { "type": "string" },
            }), &["planId"], false),
        ]);
    }
    tools
}

fn steps_schema() -> Value {
    json!({
        "description": "Test case steps, in order: [{ \"action\": \"Open the report\", \"expected\": \"It shows two pages\" }] (or numbered lines, \"action => expected\")",
        "anyOf": [
            { "type": "array", "items": { "type": "object", "properties": { "action": { "type": "string" }, "expected": { "type": "string" } } } },
            { "type": "string" },
        ],
    })
}

fn images_schema() -> Value {
    json!({
        "type": "array",
        "items": { "type": "string" },
        "description": "Screenshots to attach: full file paths, or \"clipboard\" for the image the user has copied (use it when they pasted an image into the chat and no path is shown). Each is uploaded and added after the text of the Symptom field (else Repro Steps, else Description); text and images already there are kept.",
    })
}

fn image_field_schema() -> Value {
    json!({ "type": "string", "description": "Put `images` in this field instead (reference or display name)" })
}

fn tests_schema() -> Value {
    json!({ "type": "array", "items": { "type": "string" }, "description": "For a test case: the requirements it tests, by key (\"SRS-0012\") or ID (\"#3741\"); linked as Tested By. Existing links are kept." })
}

/// Input of plan_work_item_sync and stage_import.
fn sync_props() -> Value {
    json!({
        "project": { "type": "string", "description": "Project name; omit for the current project" },
        "type": { "type": "string", "description": "Type for items that do not name one; default Requirement. \"Test Case\" for test cases (give `steps` and `tests`)." },
        "keyField": { "type": "string", "description": "ID field to match on, if not detected (e.g. \"SRS ID\")" },
        "keyFields": { "type": "object", "description": "ID field per type, when not detected: type name → field name, e.g. {\"Epic\": \"User Need ID\", \"Feature\": \"Design Input ID\"}" },
        "overwrite": { "type": "boolean", "description": "Replace different text instead of reporting a conflict. Only when the user asked for it." },
        "source": { "type": "string", "description": "Where the items come from, e.g. \"docs/SRS.md\"; shown to the user" },
        "removeMissing": { "type": "boolean", "description": "The file is the complete list for its types: offer items of those types that are only in Boards for removal (set to Removed and tagged, never deleted). Only when the user says the file is complete." },
        "items": { "type": "array", "items": { "type": "object", "properties": {
            "key": { "type": "string", "description": "The item's ID-field value, e.g. SRS-182" },
            "title": { "type": "string" },
            "type": { "type": "string" },
            "fields": { "type": "object", "description": "Field display name or reference name → value, e.g. {\"Acceptance Criteria\": \"...\", \"Software Requirement Specification\": \"...\"}" },
            "parentKey": { "type": "string", "description": "Parent's ID-field value, e.g. DI-12 (may be an earlier item in this list)" },
            "parentId": { "type": "integer" },
            "steps": steps_schema(),
            "tests": tests_schema(),
        } } },
    })
}

pub(super) fn tool(name: &str, description: &str, props: Value, required: &[&str], read_only: bool) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": { "type": "object", "properties": props, "required": required },
        "annotations": { "readOnlyHint": read_only, "destructiveHint": false, "openWorldHint": false },
    })
}

pub async fn call(app: &AppHandle, cfg: &McpConfig, name: &str, args: Value) -> Result<Value, String> {
    if cfg.read_only && WRITE_TOOLS.contains(&name) {
        return Err("Boards is set to read-only for AI tools. Turn that off in Boards → Settings → AI tools (MCP).".into());
    }
    run(app, name, &args).await.map_err(|e| e.message)
}

async fn run(app: &AppHandle, name: &str, args: &Value) -> Result<Value, AppError> {
    let ctx = context();
    if name == "get_context" {
        let mut out = ctx.clone();
        if let Some(obj) = out.as_object_mut() {
            obj.insert("org".into(), json!(org(app, &ctx).ok()));
        }
        return Ok(out);
    }
    let state = app.state::<AppState>();
    let org = org(app, &ctx)?;
    let client = state.client(&org).await?;
    match name {
        "get_work_item" => {
            let item = fetch(&client, int(args, "id")?).await?;
            Ok(detail(&org, &item))
        }
        "search_work_items" => {
            let text = str_arg(args, "text").unwrap_or_default();
            let all = args.get("allProjects").and_then(Value::as_bool).unwrap_or(false);
            let project = if all { None } else { str_arg(args, "project").or_else(|| current_project(&ctx)) };
            let fields = state.fields(&client).await?;
            let items = api::search_items(&client, &fields, project.as_deref(), &text).await?;
            Ok(json!({ "project": project, "items": items.iter().map(summary).collect::<Vec<_>>() }))
        }
        "list_my_work" => {
            let fields = state.fields(&client).await?;
            let items = api::my_work(&client, &fields).await?;
            Ok(json!({ "items": items.iter().map(summary).collect::<Vec<_>>() }))
        }
        "list_children" => {
            let id = int(args, "id")?;
            let project = project_of(&fetch(&client, id).await?);
            let fields = state.fields(&client).await?;
            let items = api::get_children(&client, &fields, &project, id).await?;
            Ok(json!({ "items": items.iter().map(summary).collect::<Vec<_>>() }))
        }
        "list_comments" => {
            let id = int(args, "id")?;
            let project = project_of(&fetch(&client, id).await?);
            let comments = api::get_comments(&client, &project, id).await?;
            Ok(json!({ "comments": comments.iter().map(|c| json!({
                "by": c.pointer("/createdBy/displayName"),
                "at": c.get("createdDate"),
                "text": html_to_text(c.get("text").and_then(Value::as_str).unwrap_or("")),
            })).collect::<Vec<_>>() }))
        }
        "list_work_item_types" => {
            let project = str_arg(args, "project").or_else(|| current_project(&ctx)).ok_or_else(no_project)?;
            let types = api::work_item_types_with_fields(&client, &project).await?;
            Ok(json!({ "project": project, "types": types.iter().filter(|t| !t.get("isDisabled").and_then(Value::as_bool).unwrap_or(false)).map(|t| json!({
                "name": t.get("name"),
                "states": t.get("states").and_then(Value::as_array).map(|s| s.iter().filter_map(|x| x.get("name").cloned()).collect::<Vec<_>>()),
                // The field keys like SRS-182 are matched on, when one is detected; otherwise pass `keyFields` to stage_import.
                "keyField": t.get("fieldDefs").and_then(Value::as_array).and_then(|f| f.iter().find(|d| fields::id_like(d))).and_then(|d| d.get("referenceName")),
                "fields": t.get("fieldDefs").and_then(Value::as_array).map(|f| f.iter().map(|d| json!({
                    "referenceName": d.get("referenceName"),
                    "name": d.get("name"),
                    "required": d.get("alwaysRequired").and_then(Value::as_bool).unwrap_or(false),
                    "allowedValues": d.get("allowedValues").filter(|v| v.as_array().is_some_and(|a| !a.is_empty())),
                })).collect::<Vec<_>>()),
            })).collect::<Vec<_>>() }))
        }
        "create_work_item" => {
            let project = str_arg(args, "project").or_else(|| current_project(&ctx)).ok_or_else(no_project)?;
            let work_item_type = str_arg(args, "type").ok_or_else(|| AppError::validation("Give the work item type."))?;
            let mut fields = extra_fields(args)?;
            let title = str_arg(args, "title").filter(|t| !t.trim().is_empty()).ok_or_else(|| AppError::validation("A title is required."))?;
            fields.insert("System.Title".into(), json!(title.trim()));
            set_common(app, &org, args, &mut fields)?;
            if let Some(sv) = args.get("steps") {
                fields.insert(STEPS_FIELD.into(), json!(steps::to_xml(&steps::from_input(sv).map_err(AppError::validation)?)));
            }
            let parent = args.get("parentId").and_then(Value::as_i64);
            let targets = test_targets(&client, &state, &project, args).await?;
            let image_field = add_images(&client, &state, &project, &work_item_type, args, &mut fields, None).await?;
            let item = api::create_work_item(&client, &project, &work_item_type, &fields, parent).await?;
            let id = item.get("id").and_then(Value::as_i64).unwrap_or(0);
            for t in targets {
                api::add_link(&client, &project, id, t, TESTS_REL).await?;
            }
            changed(app, &item);
            Ok(with_image_field(detail(&org, &fetch(&client, id).await?), image_field))
        }
        "update_work_item" => {
            let id = int(args, "id")?;
            let current = fetch(&client, id).await?;
            let project = project_of(&current);
            let mut fields = extra_fields(args)?;
            if let Some(sv) = args.get("steps") {
                let have = field(&current, STEPS_FIELD).and_then(Value::as_str).map(steps::parse).unwrap_or_default();
                if steps::has_shared(&have) {
                    return Err(AppError::validation("This test case uses shared steps; writing a new list would drop them. Change its steps in Boards."));
                }
                fields.insert(STEPS_FIELD.into(), json!(steps::to_xml(&steps::from_input(sv).map_err(AppError::validation)?)));
            }
            let targets = test_targets(&client, &state, &project, args).await?;
            if let Some(t) = str_arg(args, "title").filter(|t| !t.trim().is_empty()) {
                fields.insert("System.Title".into(), json!(t.trim()));
            }
            if let Some(s) = str_arg(args, "state") {
                fields.insert("System.State".into(), json!(s));
            }
            set_common(app, &org, args, &mut fields)?;
            let work_item_type = field(&current, "System.WorkItemType").and_then(Value::as_str).unwrap_or("").to_string();
            let image_field = add_images(&client, &state, &project, &work_item_type, args, &mut fields, Some(&current)).await?;
            if fields.is_empty() && targets.is_empty() {
                return Err(AppError::validation("Nothing to update: give a title, state, assignedTo, description, steps, tests, images or fields."));
            }
            if !fields.is_empty() {
                api::update_work_item(&client, &project, id, None, &fields).await?;
            }
            for t in targets {
                api::add_link(&client, &project, id, t, TESTS_REL).await?;
            }
            let item = fetch(&client, id).await?;
            changed(app, &item);
            Ok(with_image_field(detail(&org, &item), image_field))
        }
        "add_comment" => {
            let id = int(args, "id")?;
            let text = str_arg(args, "text").filter(|t| !t.trim().is_empty()).ok_or_else(|| AppError::validation("Write a comment first."))?;
            let item = fetch(&client, id).await?;
            let comment = api::add_comment(&client, &project_of(&item), id, &text_to_html(&text)).await?;
            changed(app, &item);
            Ok(json!({ "id": comment.get("id"), "workItemId": id, "url": item_url(&org, &item) }))
        }
        "find_work_items" => find(&client, &state, &ctx, args).await,
        "export_work_items" => export::export(&org, &client, &state, &ctx, args).await,
        "get_item_changes" => {
            let id = int(args, "id")?;
            let project = project_of(&fetch(&client, id).await?);
            let since = str_arg(args, "since").map(|s| date(&s)).transpose()?;
            let updates = api::get_updates(&client, &project, id).await?;
            Ok(json!({ "id": id, "since": since, "changes": changes(&updates, since.as_deref()) }))
        }
        "plan_work_item_sync" => {
            let field_types = state.fields(&client).await?;
            sync::plan(&client, &field_types, args, current_project(&ctx)).await
        }
        "stage_import" => {
            let mut req: sync::SyncRequest = serde_json::from_value(args.clone()).map_err(|e| AppError::validation(format!("Bad input: {e}")))?;
            // The user picks each conflict's side in the review.
            req.overwrite = false;
            let field_types = state.fields(&client).await?;
            let review = sync::review(&client, &field_types, &req, current_project(&ctx)).await?;
            let project = review["project"].as_str().unwrap_or("").to_string();
            let errors: Vec<Value> = review["rows"].as_array().into_iter().flatten().filter(|r| r["category"] == "error").map(|r| json!({ "key": r["key"], "title": r["title"], "error": r["error"] })).collect();
            let staged = imports::stage(app, &org, &project, req, current_project(&ctx), review["summary"].clone())?;
            Ok(json!({
                "importId": staged.id,
                "project": project,
                "summary": review["summary"],
                "errors": errors,
                "removalsHeld": review["removalsHeld"],
                "next": "Nothing is written yet. Tell the user it is ready to review in Boards → Imports (rows with errors cannot be applied; fix them and stage again if needed). Afterwards, get_import_result shows what they applied.",
            }))
        }
        "get_import_result" => imports::result(app, str_arg(args, "importId").as_deref()),
        n if super::wiki::handles(n) => super::wiki::call(app, &client, current_project(&ctx), n, args).await,
        "open_pull_request_form" => pr_form::open(app, &client, current_project(&ctx), args).await,
        "apply_work_item_sync" => {
            let plan_id = str_arg(args, "planId").ok_or_else(|| AppError::validation("Give the planId from plan_work_item_sync."))?;
            let field_types = state.fields(&client).await?;
            let notify = |id: i64| { let _ = app.emit_to("main", "mcp-changed", json!({ "id": id })); };
            sync::apply(&client, &field_types, &plan_id, &notify).await
        }
        other => Err(AppError::validation(format!("Unknown tool: {other}"))),
    }
}

// ----- finding and history -----

/// A YYYY-MM-DD date, checked before it goes into a query.
fn date(s: &str) -> Result<String, AppError> {
    let s = s.trim();
    let ok = s.len() == 10 && s.chars().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == '-' } else { c.is_ascii_digit() });
    if ok { Ok(s.to_string()) } else { Err(AppError::validation(format!("\"{s}\" is not a date like 2026-10-01."))) }
}

pub(super) fn str_list(args: &Value, key: &str) -> Vec<String> {
    args.get(key).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).filter(|s| !s.trim().is_empty()).collect()).unwrap_or_default()
}

/// Work items matching `find_work_items` filters, for listing or exporting.
pub(super) struct Found {
    pub project: String,
    pub ids: Vec<i64>,
    pub limit: u32,
    pub ptypes: Vec<fields::TypeInfo>,
    pub key_fields: Vec<String>,
    pub available: api::FieldMap,
    /// The exact key asked for, lowercased: a word search also finds longer values.
    pub wanted_key: Option<String>,
}

impl Found {
    pub fn keeps(&self, it: &Value) -> bool {
        self.wanted_key.as_ref().map_or(true, |w| self.key_fields.iter().any(|f| field(it, f).and_then(Value::as_str).is_some_and(|v| html_to_text(v).trim().to_lowercase() == *w)))
    }

    /// The item's key and the field it is in; keys stored as rich text ("<div>SRS-0005 </div>") as text.
    pub fn key_of(&self, it: &Value) -> Option<(String, String)> {
        let own = field(it, "System.WorkItemType").and_then(Value::as_str).and_then(|t| self.ptypes.iter().find(|p| p.name == t)).and_then(fields::key_field);
        own.iter().chain(self.key_fields.iter()).find_map(|f| field(it, f).and_then(Value::as_str).map(|v| html_to_text(v).trim().to_string()).filter(|v| !v.is_empty()).map(|v| (f.clone(), v)))
    }
}

/// `order` is a WIQL ORDER BY list; `limits` the default and largest `limit`.
pub(super) async fn query(client: &AdoClient, state: &AppState, ctx: &Value, args: &Value, order: &str, limits: (u64, u64)) -> Result<Found, AppError> {
    let project = str_arg(args, "project").or_else(|| current_project(ctx)).ok_or_else(no_project)?;
    let text = str_arg(args, "text").filter(|t| !t.trim().is_empty());
    let key = str_arg(args, "key").filter(|t| !t.trim().is_empty());
    let ptypes = fields::project_types(client, &project).await?;
    let key_fields = fields::all_key_fields(&ptypes);
    let mut clauses = vec![format!("[System.TeamProject] = {}", wiql::quote(&project))];
    let types = str_list(args, "types");
    if !types.is_empty() {
        clauses.push(format!("[System.WorkItemType] IN ({})", wiql::in_list(&types)));
    }
    let states = str_list(args, "states");
    clauses.push(if states.is_empty() { "[System.State] <> 'Removed'".into() } else { format!("[System.State] IN ({})", wiql::in_list(&states)) });
    if args.get("assignedToMe").and_then(Value::as_bool).unwrap_or(false) {
        clauses.push("[System.AssignedTo] = @Me".into());
    }
    if let Some(since) = str_arg(args, "changedSince") {
        clauses.push(format!("[System.ChangedDate] >= {}", wiql::quote(&date(&since)?)));
    }
    if let Some(it) = str_arg(args, "iteration").filter(|s| !s.trim().is_empty()) {
        if it.eq_ignore_ascii_case("current") {
            let team = ctx.get("team").and_then(Value::as_str).filter(|t| !t.is_empty()).ok_or_else(|| AppError::validation("\"current\" needs a team open in Boards; pass an iteration path instead."))?;
            clauses.push(format!("[System.IterationPath] = @CurrentIteration({})", wiql::quote(&format!("[{project}]\\{team}"))));
        } else {
            clauses.push(format!("[System.IterationPath] UNDER {}", wiql::quote(&it)));
        }
    }
    let available = state.fields(client).await?;
    if let Some(t) = &text {
        let mut any = vec![fields::contains(&available, "System.Title", t)];
        any.extend(key_fields.iter().map(|f| fields::contains(&available, f, t)));
        if let Ok(id) = t.trim().trim_start_matches('#').parse::<i64>() {
            any.push(format!("[System.Id] = {id}"));
        }
        clauses.push(format!("({})", any.join(" OR ")));
    }
    if let Some(k) = &key {
        if key_fields.is_empty() {
            return Err(AppError::validation("This project's types have no ID fields; search by `text` instead."));
        }
        let one = [k.trim().to_string()];
        clauses.push(format!("({})", key_fields.iter().map(|f| fields::any_of(&available, f, &one)).collect::<Vec<_>>().join(" OR ")));
    }
    let limit = args.get("limit").and_then(Value::as_u64).unwrap_or(limits.0).clamp(1, limits.1) as u32;
    let query = format!("SELECT [System.Id] FROM WorkItems WHERE {} ORDER BY {order}", clauses.join(" AND "));
    let ids = api::run_wiql(client, "", &query, limit).await?;
    let wanted_key = key.as_deref().map(|k| k.trim().to_lowercase());
    Ok(Found { project, ids, limit, ptypes, key_fields, available, wanted_key })
}

pub(super) async fn find(client: &AdoClient, state: &AppState, ctx: &Value, args: &Value) -> Result<Value, AppError> {
    let found = query(client, state, ctx, args, "[System.ChangedDate] DESC", (100, 500)).await?;
    let mut extra = found.key_fields.clone();
    extra.push("System.ChangedDate".into());
    let items = api::get_items_batch(client, "", &found.ids, &api::select_fields(&found.available, &extra)).await?;
    let rows: Vec<Value> = items
        .iter()
        .filter(|it| found.keeps(it))
        .map(|it| {
            let mut s = summary(it);
            let key = found.key_of(it);
            if let Some(o) = s.as_object_mut() {
                o.insert("key".into(), json!(key.as_ref().map(|k| &k.1)));
                o.insert("keyField".into(), json!(key.as_ref().map(|k| &k.0)));
                o.insert("changed".into(), field(it, "System.ChangedDate").cloned().unwrap_or(Value::Null));
            }
            s
        })
        .collect();
    Ok(json!({ "project": found.project, "count": rows.len(), "truncated": found.ids.len() as u32 >= found.limit, "items": rows }))
}

/// Bookkeeping fields every update touches; they say nothing about the change itself.
const HISTORY_NOISE: &[&str] = &["System.ChangedDate", "System.ChangedBy", "System.RevisedDate", "System.AuthorizedDate", "Microsoft.VSTS.Common.StateChangeDate", "Microsoft.VSTS.Common.StackRank"];

fn clip(v: &Value) -> Value {
    match plain(v) {
        Value::String(s) if s.chars().count() > 600 => json!(format!("{}…", s.chars().take(600).collect::<String>())),
        other => other,
    }
}

pub fn changes(updates: &[Value], since: Option<&str>) -> Vec<Value> {
    updates
        .iter()
        .filter_map(|u| {
            let fields = u.get("fields").and_then(Value::as_object);
            let at = fields
                .and_then(|f| f.get("System.ChangedDate"))
                .and_then(|c| c.get("newValue"))
                .or_else(|| u.get("revisedDate"))
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            if since.is_some_and(|s| at.as_str() < s) {
                return None;
            }
            let mut out: Vec<Value> = fields
                .into_iter()
                .flatten()
                .filter(|(k, _)| !NOISE.contains(&k.as_str()) && !HISTORY_NOISE.contains(&k.as_str()) && !k.starts_with("WEF_"))
                .map(|(k, c)| json!({ "field": k, "from": c.get("oldValue").map(clip), "to": c.get("newValue").map(clip) }))
                .collect();
            let rel = |kind: &str| u.pointer(&format!("/relations/{kind}")).and_then(Value::as_array).map_or(0, Vec::len);
            if rel("added") + rel("removed") > 0 {
                out.push(json!({ "field": "links", "added": rel("added"), "removed": rel("removed") }));
            }
            (!out.is_empty()).then(|| json!({ "rev": u.get("rev"), "by": u.pointer("/revisedBy/displayName"), "at": at, "changes": out }))
        })
        .collect()
}

// ----- arguments -----

pub(super) fn str_arg(args: &Value, key: &str) -> Option<String> {
    args.get(key).and_then(Value::as_str).map(str::to_string)
}

fn int(args: &Value, key: &str) -> Result<i64, AppError> {
    let v = args.get(key);
    v.and_then(Value::as_i64)
        .or_else(|| v.and_then(Value::as_str).and_then(|s| s.trim().trim_start_matches('#').parse().ok()))
        .ok_or_else(|| AppError::validation(format!("`{key}` must be a work item ID.")))
}

fn extra_fields(args: &Value) -> Result<Map<String, Value>, AppError> {
    match args.get("fields") {
        None | Some(Value::Null) => Ok(Map::new()),
        Some(Value::Object(m)) => Ok(m.clone()),
        Some(_) => Err(AppError::validation("`fields` must be an object of reference name → value.")),
    }
}

/// Upload the call's `images` and add them after the text of their field: the text this call sets,
/// else what `current` has (on update). Returns the field, or None when there are no images.
async fn add_images(client: &AdoClient, state: &AppState, project: &str, work_item_type: &str, args: &Value, fields: &mut Map<String, Value>, current: Option<&Value>) -> Result<Option<String>, AppError> {
    let specs = images::specs(args)?;
    if specs.is_empty() {
        return Ok(None);
    }
    let read = images::read_all(specs).await?;
    let types = api::work_item_types_with_fields(client, project).await?;
    let type_def = types.iter().find(|t| t.get("name").and_then(Value::as_str).is_some_and(|n| n.eq_ignore_ascii_case(work_item_type)));
    let field_types = state.fields(client).await?;
    let target = images::target_field(type_def, &field_types, str_arg(args, "imageField").as_deref())?;
    let html = images::upload_html(client, project, read).await?;
    let existing = fields.get(&target).cloned().or_else(|| current.and_then(|c| field(c, &target)).cloned());
    fields.insert(target.clone(), json!(images::append(existing.as_ref(), &html)));
    Ok(Some(target))
}

fn with_image_field(mut out: Value, image_field: Option<String>) -> Value {
    if let (Some(f), Some(obj)) = (image_field, out.as_object_mut()) {
        obj.insert("imagesAddedTo".into(), json!(f));
    }
    out
}

/// assignedTo and description, shared by create and update.
fn set_common(app: &AppHandle, org: &str, args: &Value, fields: &mut Map<String, Value>) -> Result<(), AppError> {
    if let Some(who) = str_arg(args, "assignedTo") {
        let who = if who.eq_ignore_ascii_case("me") { my_name(app, org).ok_or_else(|| AppError::validation("Could not tell who \"me\" is; give an email."))? } else { who };
        fields.insert("System.AssignedTo".into(), if who.is_empty() { Value::Null } else { json!(who) });
    }
    if let Some(d) = str_arg(args, "description") {
        fields.insert("System.Description".into(), json!(text_to_html(&d)));
    }
    Ok(())
}

// ----- app state -----

fn org(app: &AppHandle, ctx: &Value) -> Result<String, AppError> {
    if let Some(o) = ctx.get("org").and_then(Value::as_str).filter(|o| !o.is_empty()) {
        return Ok(o.to_string());
    }
    app.state::<AppState>()
        .settings
        .get()?
        .active_org
        .ok_or_else(|| AppError::validation("Boards is not signed in to an organization. Open the app and sign in."))
}

fn my_name(app: &AppHandle, org: &str) -> Option<String> {
    let settings = app.state::<AppState>().settings.get().ok()?;
    settings.accounts.into_iter().find(|a| a.org == org).map(|a| a.user_name)
}

fn current_project(ctx: &Value) -> Option<String> {
    ctx.get("project").and_then(Value::as_str).filter(|p| !p.is_empty()).map(str::to_string)
}

fn no_project() -> AppError {
    AppError::validation("No project is open in Boards; pass `project`.")
}

/// The work items named in `tests` (keys or IDs); an unknown or ambiguous key is an error, before anything is written.
async fn test_targets(client: &AdoClient, state: &AppState, project: &str, args: &Value) -> Result<Vec<i64>, AppError> {
    let wanted = str_list(args, "tests");
    if wanted.is_empty() {
        return Ok(Vec::new());
    }
    let keys: Vec<String> = wanted.iter().filter(|k| sync::id_ref(k).is_none()).cloned().collect();
    let found = if keys.is_empty() {
        Default::default()
    } else {
        let types = fields::project_types(client, project).await?;
        sync::parents_by_key(client, &state.fields(client).await?, project, &fields::all_key_fields(&types), &keys).await?
    };
    wanted
        .iter()
        .map(|k| match sync::id_ref(k) {
            Some(id) => Ok(id),
            None => match found.get(&sync::key_norm(k)).map(Vec::as_slice) {
                Some([id]) => Ok(*id),
                Some(ids) if ids.len() > 1 => Err(AppError::validation(format!("\"{k}\" matches several work items: {ids:?}; use the ID."))),
                _ => Err(AppError::validation(format!("No work item has the key \"{k}\"."))),
            },
        })
        .collect()
}

/// Tell the app window an item changed so an open board or details panel shows it.
fn changed(app: &AppHandle, item: &Value) {
    let _ = app.emit_to("main", "mcp-changed", json!({ "id": item.get("id") }));
}

// ----- work items -----

/// Fetched at organization level, so callers need not know the project.
async fn fetch(client: &AdoClient, id: i64) -> Result<Value, AppError> {
    client.get(&client.url(&format!("/_apis/wit/workitems/{id}?$expand=relations"))).await
}

pub(super) fn field<'a>(item: &'a Value, name: &str) -> Option<&'a Value> {
    item.get("fields").and_then(|f| f.get(name))
}

fn project_of(item: &Value) -> String {
    field(item, "System.TeamProject").and_then(Value::as_str).unwrap_or("").to_string()
}

pub(super) fn item_url(org: &str, item: &Value) -> String {
    format!(
        "https://dev.azure.com/{}/{}/_workitems/edit/{}",
        urlencoding::encode(org),
        urlencoding::encode(&project_of(item)),
        item.get("id").and_then(Value::as_i64).unwrap_or(0)
    )
}

/// Identities as their display name; everything else as is.
pub(super) fn plain(v: &Value) -> Value {
    match v {
        Value::Object(o) if o.contains_key("displayName") => {
            let name = o.get("displayName").and_then(Value::as_str).unwrap_or("");
            match o.get("uniqueName").and_then(Value::as_str) {
                Some(u) if !u.is_empty() && u != name => json!(format!("{name} <{u}>")),
                _ => json!(name),
            }
        }
        Value::String(s) if looks_like_html(s) => json!(html_to_text(s)),
        other => other.clone(),
    }
}

pub fn summary(item: &Value) -> Value {
    let f = |n: &str| field(item, n).map(plain).unwrap_or(Value::Null);
    json!({
        "id": item.get("id"),
        "type": f("System.WorkItemType"),
        "title": f("System.Title"),
        "state": f("System.State"),
        "assignedTo": f("System.AssignedTo"),
        "project": f("System.TeamProject"),
        "iteration": f("System.IterationPath"),
    })
}

/// Fields the model never needs: bookkeeping, and values repeated elsewhere in the answer.
const NOISE: &[&str] = &[
    "System.Rev", "System.Watermark", "System.AuthorizedAs", "System.AuthorizedDate", "System.PersonId", "System.RevisedDate",
    "System.CommentCount", "System.NodeName", "System.AreaId", "System.IterationId", "System.IterationLevel1", "System.IterationLevel2",
    "System.IterationLevel3", "System.AreaLevel1", "System.AreaLevel2", "System.AreaLevel3", "System.Id", "System.BoardColumnDone",
];

pub fn detail(org: &str, item: &Value) -> Value {
    let mut fields = Map::new();
    if let Some(all) = item.get("fields").and_then(Value::as_object) {
        for (k, v) in all {
            if NOISE.contains(&k.as_str()) || k.starts_with("WEF_") || v.is_null() {
                continue;
            }
            let value = if k == STEPS_FIELD { json!(steps::to_text(&steps::parse(v.as_str().unwrap_or("")))) } else { plain(v) };
            fields.insert(k.clone(), value);
        }
    }
    let mut parent = Value::Null;
    let mut children = Vec::new();
    let mut links = Vec::new();
    for rel in item.get("relations").and_then(Value::as_array).into_iter().flatten() {
        let kind = rel.get("rel").and_then(Value::as_str).unwrap_or("");
        let url = rel.get("url").and_then(Value::as_str).unwrap_or("");
        let target = url.rsplit('/').next().and_then(|s| s.parse::<i64>().ok());
        match (kind, target) {
            ("System.LinkTypes.Hierarchy-Reverse", Some(t)) => parent = json!(t),
            ("System.LinkTypes.Hierarchy-Forward", Some(t)) => children.push(json!(t)),
            ("AttachedFile", _) => links.push(json!({ "type": "attachment", "name": rel.pointer("/attributes/name") })),
            ("ArtifactLink", _) => links.push(json!({ "type": rel.pointer("/attributes/name"), "url": url })),
            (k, Some(t)) => links.push(json!({ "type": rel.pointer("/attributes/name").cloned().unwrap_or(json!(k)), "id": t })),
            (k, None) => links.push(json!({ "type": k, "url": url })),
        }
    }
    json!({
        "id": item.get("id"),
        "rev": item.get("rev"),
        "url": item_url(org, item),
        "parent": parent,
        "children": children,
        "links": links,
        "fields": fields,
    })
}

// ----- text -----

fn looks_like_html(s: &str) -> bool {
    s.contains("</") || s.contains("<br") || s.contains("<img")
}

/// Rich text as readable plain text: block ends become line breaks, list items get a bullet.
pub fn html_to_text(html: &str) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(start) = rest.find('<') {
        out.push_str(&rest[..start]);
        let Some(end) = rest[start..].find('>') else {
            out.push_str(&rest[start..]);
            rest = "";
            break;
        };
        let tag = rest[start + 1..start + end].trim().to_ascii_lowercase();
        let name: String = tag.trim_start_matches('/').chars().take_while(|c| c.is_ascii_alphanumeric()).collect();
        match name.as_str() {
            "br" | "p" | "div" | "tr" | "h1" | "h2" | "h3" | "h4" | "ul" | "ol" if !out.ends_with('\n') && !out.is_empty() => out.push('\n'),
            "li" if !tag.starts_with('/') => {
                if !out.ends_with('\n') && !out.is_empty() { out.push('\n'); }
                out.push_str("- ");
            }
            "img" => out.push_str("[image]"),
            _ => {}
        }
        rest = &rest[start + end + 1..];
    }
    out.push_str(rest);
    let decoded = out
        .replace("&nbsp;", " ")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    let lines: Vec<&str> = decoded.lines().map(str::trim_end).collect();
    let mut text = lines.join("\n");
    while text.contains("\n\n\n") {
        text = text.replace("\n\n\n", "\n\n");
    }
    text.trim().to_string()
}

/// Plain text to the HTML Azure DevOps stores; text that already is HTML is passed through.
pub fn text_to_html(text: &str) -> String {
    if looks_like_html(text) || text.trim_start().starts_with('<') {
        return text.to_string();
    }
    text.split("\n\n")
        .map(|p| {
            let esc = p.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;");
            format!("<p>{}</p>", esc.trim().replace('\n', "<br>"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn html_becomes_readable_text() {
        assert_eq!(html_to_text("<p>One &amp; two</p><ul><li>a</li><li>b</li></ul><div>end<br>x</div>"), "One & two\n- a\n- b\nend\nx");
        assert_eq!(html_to_text("plain"), "plain");
    }

    #[test]
    fn text_becomes_html_and_html_is_kept() {
        assert_eq!(text_to_html("a <b>\nline\n\nnext"), "<p>a &lt;b&gt;<br>line</p><p>next</p>");
        assert_eq!(text_to_html("<p>x</p>"), "<p>x</p>");
    }

    #[test]
    fn detail_flattens_identities_and_relations() {
        let item = json!({
            "id": 7, "rev": 3,
            "fields": {
                "System.TeamProject": "Contoso", "System.Title": "T", "System.Rev": 3,
                "System.AssignedTo": { "displayName": "Ann", "uniqueName": "ann@x.com" },
                "System.Description": "<p>Hi</p>",
            },
            "relations": [
                { "rel": "System.LinkTypes.Hierarchy-Reverse", "url": "https://dev.azure.com/o/_apis/wit/workItems/5" },
                { "rel": "System.LinkTypes.Hierarchy-Forward", "url": "https://dev.azure.com/o/_apis/wit/workItems/9" },
            ],
        });
        let d = detail("org", &item);
        assert_eq!(d["parent"], 5);
        assert_eq!(d["children"], json!([9]));
        assert_eq!(d["fields"]["System.AssignedTo"], "Ann <ann@x.com>");
        assert_eq!(d["fields"]["System.Description"], "Hi");
        assert!(d["fields"].get("System.Rev").is_none());
        assert_eq!(d["url"], "https://dev.azure.com/org/Contoso/_workitems/edit/7");
    }

    #[test]
    fn changes_list_real_edits_since_a_date() {
        let updates = vec![
            json!({ "rev": 1, "fields": { "System.ChangedDate": { "newValue": "2026-09-01T00:00:00Z" }, "System.Title": { "newValue": "A" } } }),
            json!({ "rev": 2, "revisedBy": { "displayName": "Ann" }, "fields": {
                "System.ChangedDate": { "newValue": "2026-10-05T00:00:00Z" },
                "Microsoft.VSTS.Common.AcceptanceCriteria": { "oldValue": "<p>old</p>", "newValue": "<p>new</p>" },
            } }),
            json!({ "rev": 3, "fields": { "System.ChangedDate": { "newValue": "2026-10-06T00:00:00Z" }, "System.Rev": { "newValue": 3 } } }),
        ];
        let c = changes(&updates, Some("2026-10-01"));
        assert_eq!(c.len(), 1);
        assert_eq!(c[0]["by"], "Ann");
        assert_eq!(c[0]["changes"][0]["from"], "old");
        assert_eq!(c[0]["changes"][0]["to"], "new");
        assert_eq!(changes(&updates, None).len(), 2);
    }

    #[test]
    fn dates_are_checked() {
        assert!(date("2026-10-01").is_ok());
        assert!(date("2026-10-01' OR 1=1").is_err());
        assert!(date("yesterday").is_err());
    }

    #[test]
    fn read_only_hides_write_tools() {
        let names = |ro| definitions(ro).iter().map(|t| t["name"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert!(!names(true).iter().any(|n| WRITE_TOOLS.contains(&n.as_str())));
        assert!(WRITE_TOOLS.iter().all(|w| names(false).iter().any(|n| n == w)));
        assert!(names(true).iter().any(|n| n == "open_pull_request_form"));
    }
}
