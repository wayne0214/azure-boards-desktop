//! Test case steps: Azure DevOps keeps them as XML in `Microsoft.VSTS.TCM.Steps`, each step an action
//! and an expected result (HTML, escaped inside the XML). The same format the app's step grid uses
//! (`src/lib/testcases/steps.ts`), reduced to what the AI tools need: read as text, write a new list.

use super::tools::{html_to_text, text_to_html};
use serde_json::{json, Value};

pub const STEPS_FIELD: &str = "Microsoft.VSTS.TCM.Steps";
/// A test case's link to the requirement it tests.
pub const TESTS_REL: &str = "Microsoft.VSTS.Common.TestedBy-Reverse";

#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    Step { action: String, expected: String },
    /// A reference to shared steps (another work item).
    Shared(i64),
}

fn xml_unescape(s: &str) -> String {
    s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&")
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let at = tag.find(&format!("{name}=\""))? + name.len() + 2;
    tag[at..].find('"').map(|end| tag[at..at + end].to_string())
}

/// Steps from the field's XML, as plain text. Steps inside shared steps belong to that work item and are skipped.
pub fn parse(xml: &str) -> Vec<Step> {
    parse_with_ids(xml).into_iter().map(|(_, s)| s).collect()
}

/// Steps with their `id` attribute, which step results name in `stepIdentifier`.
pub fn parse_with_ids(xml: &str) -> Vec<(Option<String>, Step)> {
    let mut out = Vec::new();
    let mut step_id: Option<String> = None;
    let mut rest = xml;
    let mut shared_depth = 0usize;
    let mut strings: Vec<String> = Vec::new();
    let mut in_step = false;
    while let Some(open) = rest.find('<') {
        let Some(close) = rest[open..].find('>') else { break };
        let tag = &rest[open + 1..open + close];
        let after = &rest[open + close + 1..];
        let name: String = tag.trim_start_matches('/').chars().take_while(|c| c.is_alphanumeric()).collect();
        let closing = tag.starts_with('/');
        let self_closing = tag.ends_with('/');
        match (name.as_str(), closing) {
            ("compref", false) => {
                if shared_depth == 0 {
                    if let Some(r) = attr(tag, "ref").and_then(|r| r.parse().ok()) {
                        out.push((attr(tag, "id"), Step::Shared(r)));
                    }
                }
                if !self_closing {
                    shared_depth += 1;
                }
            }
            ("compref", true) => shared_depth = shared_depth.saturating_sub(1),
            ("step", false) if shared_depth == 0 => {
                in_step = true;
                step_id = attr(tag, "id");
                strings.clear();
                if self_closing {
                    in_step = false;
                    out.push((step_id.take(), Step::Step { action: String::new(), expected: String::new() }));
                }
            }
            ("step", true) if shared_depth == 0 && in_step => {
                in_step = false;
                let mut it = strings.drain(..);
                let step = Step::Step { action: it.next().unwrap_or_default(), expected: it.next().unwrap_or_default() };
                drop(it);
                out.push((step_id.take(), step));
            }
            ("parameterizedString", false) if in_step && !self_closing => {
                let end = after.find("</parameterizedString>").unwrap_or(after.len());
                strings.push(html_to_text(&xml_unescape(&after[..end])).trim().to_string());
                rest = &after[end..];
                continue;
            }
            ("parameterizedString", false) if in_step => strings.push(String::new()),
            _ => {}
        }
        rest = after;
    }
    out
}

/// Steps as given to a tool: `[{ "action", "expected" }]`, or text with one numbered step per line,
/// "action => expected" (the app's text mode), or an "Expected:" line after the action.
pub fn from_input(v: &Value) -> Result<Vec<Step>, String> {
    match v {
        Value::Array(a) => a
            .iter()
            .map(|s| match s {
                Value::String(t) => Ok(Step::Step { action: t.trim().to_string(), expected: String::new() }),
                Value::Object(o) => Ok(Step::Step {
                    action: o.get("action").and_then(Value::as_str).unwrap_or("").trim().to_string(),
                    expected: o.get("expected").and_then(Value::as_str).unwrap_or("").trim().to_string(),
                }),
                _ => Err("Each step is { \"action\": …, \"expected\": … }.".to_string()),
            })
            .collect(),
        Value::String(text) => Ok(from_text(text)),
        Value::Null => Ok(Vec::new()),
        _ => Err("Steps are a list of { \"action\", \"expected\" } or numbered lines.".to_string()),
    }
}

fn strip_number(line: &str) -> Option<&str> {
    let t = line.trim_start();
    let digits = t.chars().take_while(char::is_ascii_digit).count();
    if digits == 0 {
        return None;
    }
    let rest = &t[digits..];
    rest.strip_prefix('.').or_else(|| rest.strip_prefix(')')).map(str::trim)
}

fn from_text(text: &str) -> Vec<Step> {
    let mut out: Vec<(String, String)> = Vec::new();
    for line in text.lines() {
        let l = line.trim();
        if l.is_empty() {
            continue;
        }
        let lower = l.to_lowercase();
        if let (Some(last), true) = (out.last_mut(), lower.starts_with("expected:") || lower.starts_with("expected result:")) {
            let value = l.split_once(':').map(|x| x.1).unwrap_or("").trim();
            last.1 = if last.1.is_empty() { value.to_string() } else { format!("{}\n{value}", last.1) };
            continue;
        }
        match (strip_number(l), out.last_mut()) {
            (Some(body), _) => {
                let (a, e) = body.split_once("=>").map(|(a, e)| (a.trim(), e.trim())).unwrap_or((body, ""));
                out.push((a.to_string(), e.to_string()));
            }
            // A line without a number continues the step above.
            (None, Some(last)) => {
                if last.1.is_empty() {
                    last.0 = format!("{}\n{l}", last.0);
                } else {
                    last.1 = format!("{}\n{l}", last.1);
                }
            }
            (None, None) => out.push((l.to_string(), String::new())),
        }
    }
    out.into_iter().map(|(action, expected)| Step::Step { action, expected }).collect()
}

/// Numbered text for reading and comparing: "1. Open the report\n   Expected: The PDF is saved".
pub fn to_text(steps: &[Step]) -> String {
    steps
        .iter()
        .enumerate()
        .map(|(i, s)| match s {
            Step::Shared(r) => format!("{}. (shared steps #{r})", i + 1),
            Step::Step { action, expected } => {
                let indent = |t: &str| t.replace('\n', "\n   ");
                if expected.is_empty() { format!("{}. {}", i + 1, indent(action)) } else { format!("{}. {}\n   Expected: {}", i + 1, indent(action), indent(expected)) }
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn has_shared(steps: &[Step]) -> bool {
    steps.iter().any(|s| matches!(s, Step::Shared(_)))
}

/// A new steps list as Azure DevOps stores it. Step ids start at 2, as the portal's do.
pub fn to_xml(steps: &[Step]) -> String {
    let mut body = String::new();
    let mut id = 1;
    for s in steps {
        id += 1;
        match s {
            Step::Shared(r) => body.push_str(&format!("<compref id=\"{id}\" ref=\"{r}\" />")),
            Step::Step { action, expected } => {
                let kind = if expected.trim().is_empty() { "ActionStep" } else { "ValidateStep" };
                let html = |t: &str| if t.trim().is_empty() { String::new() } else { xml_escape(&text_to_html(t)) };
                body.push_str(&format!(
                    "<step id=\"{id}\" type=\"{kind}\"><parameterizedString isformatted=\"true\">{}</parameterizedString><parameterizedString isformatted=\"true\">{}</parameterizedString><description/></step>",
                    html(action),
                    html(expected)
                ));
            }
        }
    }
    format!("<steps id=\"0\" last=\"{id}\">{body}</steps>")
}

/// The canonical value kept in a plan: `[{ action, expected }]`.
pub fn to_value(steps: &[Step]) -> Value {
    json!(steps
        .iter()
        .filter_map(|s| match s {
            Step::Step { action, expected } => Some(json!({ "action": action, "expected": expected })),
            Step::Shared(_) => None,
        })
        .collect::<Vec<_>>())
}

/// Steps compared as text, whitespace collapsed.
pub fn same(a: &[Step], b: &[Step]) -> bool {
    let norm = |s: &[Step]| to_text(s).split_whitespace().collect::<Vec<_>>().join(" ");
    norm(a) == norm(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PORTAL: &str = r#"<steps id="0" last="4"><step id="2" type="ValidateStep"><parameterizedString isformatted="true">&lt;DIV&gt;&lt;P&gt;Open the report &amp;amp; scan&lt;/P&gt;&lt;/DIV&gt;</parameterizedString><parameterizedString isformatted="true">&lt;P&gt;Report shows&lt;BR/&gt;two pages&lt;/P&gt;</parameterizedString><description/></step><compref id="3" ref="812"><step id="5" type="ActionStep"><parameterizedString isformatted="true">inner</parameterizedString><parameterizedString isformatted="true"></parameterizedString></step></compref><step id="4" type="ActionStep"><parameterizedString isformatted="true">Close it</parameterizedString><parameterizedString isformatted="true"/><description/></step></steps>"#;

    #[test]
    fn keeps_step_ids_for_step_results() {
        let ids: Vec<Option<String>> = parse_with_ids(PORTAL).into_iter().map(|(id, _)| id).collect();
        assert_eq!(ids, vec![Some("2".into()), Some("3".into()), Some("4".into())]);
    }

    #[test]
    fn reads_the_portals_xml() {
        let s = parse(PORTAL);
        assert_eq!(s.len(), 3);
        assert_eq!(s[0], Step::Step { action: "Open the report & scan".into(), expected: "Report shows\ntwo pages".into() });
        assert_eq!(s[1], Step::Shared(812));
        assert_eq!(s[2], Step::Step { action: "Close it".into(), expected: String::new() });
        assert!(has_shared(&s));
        assert_eq!(to_text(&s), "1. Open the report & scan\n   Expected: Report shows\n   two pages\n2. (shared steps #812)\n3. Close it");
        assert!(parse("").is_empty());
    }

    #[test]
    fn writes_xml_that_reads_back() {
        let steps = vec![Step::Step { action: "Tap <Export>".into(), expected: "PDF & images saved".into() }, Step::Step { action: "Close".into(), expected: String::new() }];
        let xml = to_xml(&steps);
        assert!(xml.starts_with("<steps id=\"0\" last=\"3\"><step id=\"2\" type=\"ValidateStep\">"));
        assert!(xml.contains("type=\"ActionStep\""));
        assert_eq!(parse(&xml), steps);
    }

    #[test]
    fn takes_steps_as_a_list_or_text() {
        let list = from_input(&json!([{ "action": "Open", "expected": "Opens" }, "Close"])).unwrap();
        assert_eq!(list, vec![Step::Step { action: "Open".into(), expected: "Opens".into() }, Step::Step { action: "Close".into(), expected: String::new() }]);
        let text = from_input(&json!("1. Open => Opens\n2) Export\n   Expected: Saved\n   as PDF\n3. Close")).unwrap();
        assert_eq!(text, vec![
            Step::Step { action: "Open".into(), expected: "Opens".into() },
            Step::Step { action: "Export".into(), expected: "Saved\nas PDF".into() },
            Step::Step { action: "Close".into(), expected: String::new() },
        ]);
        assert!(same(&list, &from_input(&json!("1. Open\nExpected: Opens\n2. Close")).unwrap()));
        assert!(from_input(&json!(3)).is_err());
    }
}
