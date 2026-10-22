fn main() {
    // The Teamup API key is built into the app: from TEAMUP_API_KEY, or else the git-ignored file teamup.key.
    println!("cargo:rerun-if-env-changed=TEAMUP_API_KEY");
    println!("cargo:rerun-if-changed=teamup.key");
    let key = std::env::var("TEAMUP_API_KEY")
        .ok()
        .or_else(|| std::fs::read_to_string("teamup.key").ok())
        .map(|k| k.trim().to_string())
        .unwrap_or_default();
    println!("cargo:rustc-env=TEAMUP_API_KEY={key}");
    tauri_build::build()
}
