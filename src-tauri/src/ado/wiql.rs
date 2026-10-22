//! Helpers for building WIQL safely.

pub fn quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

pub fn in_list(values: &[String]) -> String {
    values.iter().map(|v| quote(v)).collect::<Vec<_>>().join(", ")
}

/// Area clause from the team's field values: `([System.AreaPath] UNDER 'A' OR [System.AreaPath] = 'B')`.
pub fn area_clause(areas: &[(String, bool)]) -> Option<String> {
    if areas.is_empty() {
        return None;
    }
    let parts: Vec<String> = areas
        .iter()
        .map(|(path, include_children)| {
            if *include_children {
                format!("[System.AreaPath] UNDER {}", quote(path))
            } else {
                format!("[System.AreaPath] = {}", quote(path))
            }
        })
        .collect();
    Some(format!("({})", parts.join(" OR ")))
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quote_escapes_single_quotes() {
        assert_eq!(quote("plain"), "'plain'");
        assert_eq!(quote("O'Brien"), "'O''Brien'");
        assert_eq!(quote("' OR 1=1 --"), "''' OR 1=1 --'");
        assert_eq!(quote(""), "''");
    }

    #[test]
    fn area_clause_combines_paths() {
        assert_eq!(area_clause(&[]), None);
        let c = area_clause(&[("P\\A".into(), true), ("P".into(), false)]).unwrap();
        assert_eq!(c, "([System.AreaPath] UNDER 'P\\A' OR [System.AreaPath] = 'P')");
    }
}
