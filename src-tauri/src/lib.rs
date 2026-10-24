mod ado;
mod cache;
mod commands;
mod error;
mod menu;
mod nav_guard;
mod secrets;
mod settings;
mod state;
mod timesheet;
mod pr_commands;
mod plan_commands;
mod rooms;
mod tools;
mod updater;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_window_state::Builder::new().build())
        .plugin(nav_guard::init())
        .register_uri_scheme_protocol("tsbridge", |ctx, request| timesheet::handle_bridge(ctx.app_handle(), ctx.webview_label(), request))
        .setup(|app| {
            let config_dir = app.path().app_config_dir()?;
            let data_dir = app.path().app_data_dir()?;
            let settings = settings::SettingsStore::open(config_dir)?;
            let cache = cache::Cache::open(data_dir)?;
            app.manage(state::AppState::new(settings, cache));
            menu::build(app.handle())?;
            // Reading the login shell's PATH can take seconds; do it now rather than on the first Generate.
            std::thread::spawn(tools::warm_up);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_settings,
            commands::get_launch_options,
            commands::debug_log,
            commands::test_connection,
            commands::add_account,
            commands::remove_account,
            commands::set_active_org,
            commands::remember_target,
            commands::toggle_pinned_project,
            commands::list_projects,
            commands::list_teams,
            commands::default_team,
            commands::list_boards,
            commands::get_board,
            commands::get_team_context,
            commands::query_board_items,
            commands::my_work,
            commands::mentioned_items,
            commands::project_items,
            commands::add_link,
            commands::remove_link,
            commands::tp_mirror_result,
            commands::work_item_types,
            commands::search_work_items,
            commands::get_work_item,
            commands::get_children,
            commands::get_comments,
            commands::get_updates,
            commands::get_classification_nodes,
            commands::create_area,
            commands::team_areas,
            commands::create_work_item,
            commands::update_work_item,
            commands::set_parent,
            commands::delete_work_item,
            commands::add_comment,
            commands::fetch_attachment,
            commands::upload_attachment,
            commands::cache_get,
            commands::cache_set,
            commands::cache_clear,
            commands::pick_save_path,
            commands::pick_csv_file,
            commands::pick_open_file,
            commands::read_text_file,
            commands::read_csv,
            commands::write_text_file,
            commands::import_work_items,
            timesheet::timesheet_open,
            timesheet::timesheet_show,
            timesheet::timesheet_hide,
            timesheet::timesheet_is_open,
            timesheet::timesheet_eval,
            timesheet::timesheet_report,
            timesheet::timesheet_close,
            timesheet::timesheet_reload,
            timesheet::timesheet_clear_cookies,
            pr_commands::pr_list_repos,
            pr_commands::pr_list,
            pr_commands::pr_get,
            pr_commands::pr_detail,
            pr_commands::pr_work_item_ids,
            pr_commands::pr_branch_work_items,
            pr_commands::pr_link_work_item,
            pr_commands::pr_changes,
            pr_commands::pr_threads,
            pr_commands::pr_create_thread,
            pr_commands::pr_reply,
            pr_commands::pr_update_thread,
            pr_commands::pr_update_comment,
            pr_commands::pr_delete_comment,
            pr_commands::pr_vote,
            pr_commands::pr_add_reviewer,
            pr_commands::pr_remove_reviewer,
            pr_commands::pr_update,
            pr_commands::pr_create,
            pr_commands::pr_branches,
            pr_commands::pr_start_branch,
            pr_commands::pr_checks,
            pr_commands::pr_file,
            pr_commands::pr_project_members,
            plan_commands::tp_plans,
            plan_commands::tp_create_plan,
            plan_commands::tp_suites,
            plan_commands::tp_create_suite,
            plan_commands::tp_add_cases,
            plan_commands::tp_remove_cases,
            plan_commands::tp_configurations,
            plan_commands::tp_points,
            plan_commands::tp_update_points,
            plan_commands::tp_publish_run,
            plan_commands::tp_runs,
            plan_commands::tp_run_results,
            plan_commands::tp_set_plan_state,
            rooms::rooms_has_key,
            rooms::rooms_list,
            rooms::rooms_fields,
            rooms::rooms_events,
            rooms::rooms_book,
            rooms::rooms_cancel,
            tools::git_current_branch,
            tools::run_git_tools,
            tools::git_checkout_branch,
            tools::cancel_git_tools,
            updater::updater_configured,
        ])
        .run(tauri::generate_context!())
        .expect("error while running application");
}
