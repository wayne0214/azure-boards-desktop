//! A project's work item types and fields, as the MCP tools need them: ID fields (e.g. "SRS ID")
//! to match on, and field names written either way ("Acceptance Criteria" or its reference name).

use crate::ado::api::{self, FieldMap};
use crate::ado::client::AdoClient;
use crate::ado::wiql;
use crate::error::{AppError, AppResult};
use serde_json::Value;

pub struct TypeInfo {
    pub name: String,
    /// Field definitions from Azure DevOps: referenceName, name, allowedValues, alwaysRequired.
    pub defs: Vec<Value>,
}

pub async fn project_types(client: &AdoClient, project: &str) -> AppResult<Vec<TypeInfo>> {
    let types = api::work_item_types_with_fields(client, project).await?;
    Ok(types
        .into_iter()
        .filter(|t| !t.get("isDisabled").and_then(Value::as_bool).unwrap_or(false))
        .map(|t| TypeInfo {
            name: t.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
            defs: t.get("fieldDefs").and_then(Value::as_array).cloned().unwrap_or_default(),
        })
        .collect())
}

pub fn find_type<'a>(types: &'a [TypeInfo], name: &str) -> AppResult<&'a TypeInfo> {
    types.iter().find(|t| t.name.eq_ignore_ascii_case(name.trim())).ok_or_else(|| {
        let names: Vec<&str> = types.iter().map(|t| t.name.as_str()).collect();
        AppError::validation(format!("No work item type \"{name}\" in this project. Types: {}", names.join(", ")))
    })
}

fn def_ref(def: &Value) -> &str {
    def.get("referenceName").and_then(Value::as_str).unwrap_or("")
}

fn def_name(def: &Value) -> &str {
    def.get("name").and_then(Value::as_str).unwrap_or("")
}

/// A hand-typed identifier field the process added, like "SRS ID" or "UN No" (same rule as the app's UI).
pub fn id_like(def: &Value) -> bool {
    let reference = def_ref(def);
    let name = def_name(def).to_ascii_lowercase();
    let picklist = def.get("allowedValues").and_then(Value::as_array).is_some_and(|a| !a.is_empty());
    let words: Vec<&str> = name.split(|c: char| !c.is_ascii_alphanumeric()).filter(|w| !w.is_empty()).collect();
    reference.starts_with("Custom.") && !picklist && !name.contains("description") && words.iter().any(|w| matches!(*w, "id" | "no" | "number" | "ref" | "code"))
}

/// The type's ID field (e.g. Custom.SRSID), if it has one.
pub fn key_field(t: &TypeInfo) -> Option<String> {
    t.defs.iter().find(|d| id_like(d)).map(|d| def_ref(d).to_string())
}

/// Every ID field across the project's types, to find a parent by its key whatever its type.
pub fn all_key_fields(types: &[TypeInfo]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for t in types {
        for d in t.defs.iter().filter(|d| id_like(d)) {
            let r = def_ref(d).to_string();
            if !out.contains(&r) {
                out.push(r);
            }
        }
    }
    out
}

/// A field of the type by reference name or display name, ignoring case: "Acceptance Criteria" → Microsoft.VSTS.Common.AcceptanceCriteria.
pub fn resolve_field(t: &TypeInfo, name: &str) -> Option<String> {
    let n = name.trim();
    t.defs
        .iter()
        .find(|d| def_ref(d).eq_ignore_ascii_case(n))
        .or_else(|| t.defs.iter().find(|d| def_name(d).eq_ignore_ascii_case(n)))
        .map(|d| def_ref(d).to_string())
}

/// Rich or long text fields, which WIQL cannot compare with `=` or `IN`.
pub fn is_long_text(field_types: &FieldMap, reference: &str) -> bool {
    matches!(field_types.get(reference).map(String::as_str), Some("html" | "plainText" | "history"))
}

/// WIQL that finds `field` equal to any of `values`. Long-text fields can only be searched by words,
/// so the caller must still compare the values it gets back.
pub fn any_of(field_types: &FieldMap, field: &str, values: &[String]) -> String {
    if is_long_text(field_types, field) {
        format!("({})", values.iter().map(|v| format!("[{field}] CONTAINS WORDS {}", wiql::quote(v.trim()))).collect::<Vec<_>>().join(" OR "))
    } else {
        format!("[{field}] IN ({})", wiql::in_list(values))
    }
}

/// WIQL that finds `text` inside `field`.
pub fn contains(field_types: &FieldMap, field: &str, text: &str) -> String {
    let op = if is_long_text(field_types, field) { "CONTAINS WORDS" } else { "CONTAINS" };
    format!("[{field}] {op} {}", wiql::quote(text.trim()))
}

/// Field names of the type that share a word with `name`, to suggest when it matches none.
pub fn similar(t: &TypeInfo, name: &str) -> Vec<String> {
    let words: Vec<String> = name.to_lowercase().split(|c: char| !c.is_alphanumeric()).filter(|w| w.len() > 3).map(str::to_string).collect();
    let mut scored: Vec<(usize, &str)> = t
        .defs
        .iter()
        .map(def_name)
        .map(|n| {
            let lower = n.to_lowercase();
            (words.iter().filter(|w| lower.split(|c: char| !c.is_alphanumeric()).any(|x| x == w.as_str())).count(), n)
        })
        .filter(|(score, _)| *score > 0)
        .collect();
    // Most words in common first: "User Acceptance Criteria" → "Acceptance Criteria" before "User Interface Design".
    scored.sort_by(|a, b| b.0.cmp(&a.0));
    scored.into_iter().take(3).map(|(_, n)| n.to_string()).collect()
}

pub fn display_name(t: &TypeInfo, reference: &str) -> String {
    t.defs.iter().find(|d| def_ref(d) == reference).map(def_name).unwrap_or(reference).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn t() -> TypeInfo {
        TypeInfo {
            name: "Requirement".into(),
            defs: vec![
                json!({ "referenceName": "System.Title", "name": "Title" }),
                json!({ "referenceName": "Custom.SRSID", "name": "SRS ID" }),
                json!({ "referenceName": "Custom.Risk", "name": "Risk Level", "allowedValues": ["Low"] }),
                json!({ "referenceName": "Custom.CodeNo", "name": "Code No", "allowedValues": ["A"] }),
                json!({ "referenceName": "Microsoft.VSTS.Common.AcceptanceCriteria", "name": "Acceptance Criteria" }),
            ],
        }
    }

    #[test]
    fn finds_the_id_field() {
        assert_eq!(key_field(&t()).as_deref(), Some("Custom.SRSID"));
        assert!(!id_like(&json!({ "referenceName": "Custom.IdeaDescription", "name": "ID description" })));
        assert!(!id_like(&json!({ "referenceName": "System.Id", "name": "ID" })));
        assert_eq!(all_key_fields(&[t(), t()]), vec!["Custom.SRSID".to_string()]);
    }

    #[test]
    fn resolves_names_either_way() {
        assert_eq!(resolve_field(&t(), "acceptance criteria").as_deref(), Some("Microsoft.VSTS.Common.AcceptanceCriteria"));
        assert_eq!(resolve_field(&t(), "custom.srsid").as_deref(), Some("Custom.SRSID"));
        assert_eq!(resolve_field(&t(), "Nope"), None);
        assert_eq!(display_name(&t(), "Custom.SRSID"), "SRS ID");
        assert_eq!(similar(&t(), "User Acceptance Criteria"), vec!["Acceptance Criteria".to_string()]);
        let mut wide = t();
        wide.defs.push(json!({ "referenceName": "Custom.UID", "name": "User Interface Design" }));
        assert_eq!(similar(&wide, "User Acceptance Criteria")[0], "Acceptance Criteria");
    }

    #[test]
    fn long_text_fields_are_searched_by_words() {
        let mut types = FieldMap::new();
        types.insert("Custom.UserNeedID".into(), "html".into());
        types.insert("Custom.SRSID".into(), "string".into());
        let v = vec!["SRS-1".to_string(), "O'K".to_string()];
        assert_eq!(any_of(&types, "Custom.SRSID", &v), "[Custom.SRSID] IN ('SRS-1', 'O''K')");
        assert_eq!(any_of(&types, "Custom.UserNeedID", &v), "([Custom.UserNeedID] CONTAINS WORDS 'SRS-1' OR [Custom.UserNeedID] CONTAINS WORDS 'O''K')");
        assert_eq!(contains(&types, "Custom.UserNeedID", "x"), "[Custom.UserNeedID] CONTAINS WORDS 'x'");
        assert_eq!(contains(&types, "System.Title", "x"), "[System.Title] CONTAINS 'x'");
    }
}
