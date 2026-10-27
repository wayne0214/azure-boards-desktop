//! macOS files a notification from the app in front straight into Notification Center, without a banner,
//! unless the notification delegate says to present it. The delegate the notification plugin installs
//! (mac-notification-sys) does not, so "Send test notification", pressed inside Boards, never showed one.

/// Teaches that delegate to present notifications while Boards is in front. Call before the first one is sent.
#[cfg(target_os = "macos")]
pub fn present_while_in_front() {
    use objc2::encode::Encode;
    use objc2::ffi;
    use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
    use objc2::sel;
    use std::ffi::CString;

    // -userNotificationCenter:shouldPresentNotification:
    extern "C-unwind" fn should_present(_this: *mut AnyObject, _cmd: Sel, _center: *mut AnyObject, _note: *mut AnyObject) -> Bool {
        Bool::YES
    }

    // The class mac-notification-sys defines in Objective-C; if a later version renames it, banners just stay off in front.
    let Some(class) = AnyClass::get(c"NotificationCenterDelegate") else { return };
    let Ok(types) = CString::new(format!("{}@:@@", Bool::ENCODING)) else { return };
    // SAFETY: the function matches the selector's signature and its type encoding; adding a method the class
    // already has does nothing.
    unsafe {
        let imp: Imp = std::mem::transmute(should_present as extern "C-unwind" fn(_, _, _, _) -> _);
        ffi::class_addMethod(
            class as *const AnyClass as *mut AnyClass,
            sel!(userNotificationCenter:shouldPresentNotification:),
            imp,
            types.as_ptr(),
        );
    }
}

#[cfg(not(target_os = "macos"))]
pub fn present_while_in_front() {}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use objc2::runtime::AnyClass;
    use objc2::sel;

    #[test]
    fn the_plugin_delegate_presents_notifications_in_front() {
        super::present_while_in_front();
        // Fails if mac-notification-sys renames its delegate class: banners in front would quietly stop again.
        let class = AnyClass::get(c"NotificationCenterDelegate").expect("mac-notification-sys's delegate class");
        assert!(class.instance_method(sel!(userNotificationCenter:shouldPresentNotification:)).is_some());
    }
}
