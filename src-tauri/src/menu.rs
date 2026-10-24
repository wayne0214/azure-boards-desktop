#[cfg(not(target_os = "macos"))]
use tauri::menu::PredefinedMenuItem;
use tauri::menu::{AboutMetadataBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let about = AboutMetadataBuilder::new()
        .name(Some("Boards"))
        .version(Some(env!("CARGO_PKG_VERSION")))
        .comments(Some("A desktop client for Azure DevOps Boards."))
        .build();

    let settings = MenuItemBuilder::with_id("settings", "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;

    let check_updates = MenuItemBuilder::with_id("check-updates", "Check for Updates…").build(app)?;

    #[cfg(target_os = "macos")]
    let app_menu = SubmenuBuilder::new(app, "Boards")
        .about(Some(about.clone()))
        .item(&check_updates)
        .separator()
        .item(&settings)
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;

    let new_item = MenuItemBuilder::with_id("new-item", "New Work Item…")
        .accelerator("CmdOrCtrl+N")
        .build(app)?;
    let import = MenuItemBuilder::with_id("import", "Import from CSV…")
        .accelerator("CmdOrCtrl+Shift+I")
        .build(app)?;
    let export = MenuItemBuilder::with_id("export", "Export View as CSV…")
        .accelerator("CmdOrCtrl+Shift+E")
        .build(app)?;
    let refresh = MenuItemBuilder::with_id("refresh", "Refresh")
        .accelerator("CmdOrCtrl+R")
        .build(app)?;
    let open_web = MenuItemBuilder::with_id("open-web", "Open in Azure DevOps")
        .accelerator("CmdOrCtrl+Shift+O")
        .build(app)?;

    #[allow(unused_mut)]
    let mut file_builder = SubmenuBuilder::new(app, "File")
        .item(&new_item)
        .separator()
        .item(&import)
        .item(&export)
        .separator()
        .item(&refresh)
        .item(&open_web);
    #[cfg(not(target_os = "macos"))]
    {
        file_builder = file_builder.separator().item(&settings).separator().quit();
    }
    let file = file_builder.build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .separator()
        .item(
            &MenuItemBuilder::with_id("find", "Find…")
                .accelerator("CmdOrCtrl+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("palette", "Go to Anything…")
                .accelerator("CmdOrCtrl+K")
                .build(app)?,
        )
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("view-board", "Board").accelerator("CmdOrCtrl+1").build(app)?)
        .item(&MenuItemBuilder::with_id("view-list", "List").accelerator("CmdOrCtrl+2").build(app)?)
        .item(&MenuItemBuilder::with_id("view-mine", "My Work").accelerator("CmdOrCtrl+3").build(app)?)
        .item(&MenuItemBuilder::with_id("view-prs", "Pull Requests").accelerator("CmdOrCtrl+4").build(app)?)
        .item(&MenuItemBuilder::with_id("view-timesheet", "Timesheet").accelerator("CmdOrCtrl+5").build(app)?)
        .item(&MenuItemBuilder::with_id("view-rooms", "Meeting Rooms").accelerator("CmdOrCtrl+6").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("toggle-sidebar", "Toggle Sidebar")
                .accelerator("CmdOrCtrl+Shift+S")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("toggle-inspector", "Toggle Details")
                .accelerator("CmdOrCtrl+I")
                .build(app)?,
        )
        .item(&MenuItemBuilder::with_id("toggle-mini", "Mini Mode").accelerator("CmdOrCtrl+Shift+D").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("text-bigger", "Make Text Bigger").accelerator("CmdOrCtrl+=").build(app)?)
        .item(&MenuItemBuilder::with_id("text-smaller", "Make Text Smaller").accelerator("CmdOrCtrl+-").build(app)?)
        .item(&MenuItemBuilder::with_id("text-reset", "Actual Size").accelerator("CmdOrCtrl+0").build(app)?)
        .separator()
        .fullscreen()
        .build()?;

    let item_menu = SubmenuBuilder::new(app, "Item")
        .item(&MenuItemBuilder::with_id("assign-me", "Assign to Me").accelerator("CmdOrCtrl+Shift+M").build(app)?)
        .item(&MenuItemBuilder::with_id("copy-link", "Copy Link").accelerator("CmdOrCtrl+Shift+C").build(app)?)
        .item(&MenuItemBuilder::with_id("open-item-web", "Open Item in Browser").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("delete-item", "Move to Recycle Bin").accelerator("CmdOrCtrl+Backspace").build(app)?)
        .build()?;

    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help-pat", "How to Create a Token").build(app)?)
        .item(&MenuItemBuilder::with_id("help-shortcuts", "Keyboard Shortcuts").accelerator("CmdOrCtrl+/").build(app)?)
        .item(&MenuItemBuilder::with_id("whats-new", "What's New").build(app)?)
        .build()?;

    #[cfg(not(target_os = "macos"))]
    let help = {
        let h = help;
        let about_item = PredefinedMenuItem::about(app, Some("About Boards"), Some(about))?;
        h.append(&check_updates)?;
        h.append(&about_item)?;
        h
    };

    let mut builder = MenuBuilder::new(app);
    #[cfg(target_os = "macos")]
    {
        builder = builder.item(&app_menu);
    }
    let menu = builder
        .item(&file)
        .item(&edit)
        .item(&view)
        .item(&item_menu)
        .item(&window)
        .item(&help)
        .build()?;

    app.set_menu(menu)?;
    app.on_menu_event(|app, event| {
        let id = event.id().0.clone();
        let _ = app.emit("menu", id);
    });
    Ok(())
}
