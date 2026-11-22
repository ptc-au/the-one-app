//! What the system says ended the app the last time, told to Telemetry once the client has opened, as
//! `one.client.native.crash` with its reason and where it's from (`one.exit.source`), where only a Rust panic was told
//! before. Each platform says it its own way: a computer's app leaves a marker in its home while it runs and takes it
//! away as it quits (`began`, `quit`), so one found at the next start is a run that ended without quitting; an iPhone's
//! MetricKit says what ended it (`OneMetrics` in Shortcuts.swift: crashes, memory limits, watchdogs), and Android's
//! `ApplicationExitInfo` (`MainActivity`).

use std::sync::Mutex;

use serde_json::json;

/// What was said and isn't told yet, as the client hasn't opened.
static SAID: Mutex<Vec<(&'static str, String)>> = Mutex::new(Vec::new());

/// The system said the last run ended as `reason`, as `source` says it: told as soon as the client is open.
pub(crate) fn ended(source: &'static str, reason: String) {
    SAID.lock().expect("nothing panics holding it").push((source, reason));
    told();
}

/// Tells Telemetry what was said, if the client is open.
pub(crate) fn told() {
    let Some(views) = crate::opened_views() else { return };
    for (source, reason) in std::mem::take(&mut *SAID.lock().expect("nothing panics holding it")) {
        eprintln!("the previous run of the app ended: {reason}");
        views.client.report(json!({"name": "one.client.native.crash", "error": reason, "attributes": {"one.exit.source": source}}));
    }
}

/// This program is the app, on a computer: a marker left by the run before it, which didn't quit, is told, and its own
/// is made, saying which build it is.
#[cfg(not(mobile))]
pub(crate) fn began(home: &std::path::Path) {
    let marker = home.join("running");
    if let Ok(before) = std::fs::read_to_string(&marker) {
        ended("marker", format!("the app ended without quitting, on build {}", before.trim()));
    }
    if let Err(error) = std::fs::write(&marker, ::client::BUILD) {
        eprintln!("the app's marker wasn't made: {error}");
    }
}

/// The app quits, or ends for the one an update started: its marker goes, so the next start finds none.
#[cfg(not(mobile))]
pub(crate) fn quit(home: &std::path::Path) {
    let _ = std::fs::remove_file(home.join("running"));
}

/// What MetricKit says ended an iPhone's app (`OneMetrics` in Shortcuts.swift), as an NSString, which Swift tells by
/// this class's name, as it does `OneCharger`'s (`charger`).
#[cfg(target_os = "ios")]
mod metrics {
    use std::ffi::{CStr, c_char};

    use objc2::runtime::{AnyClass, AnyObject, NSObject};
    use objc2::{ClassType, define_class, msg_send};

    define_class!(
        #[unsafe(super(NSObject))]
        #[name = "OneExited"]
        struct Exited;

        impl Exited {
            #[unsafe(method(ended:))]
            fn ended(said: &AnyObject) {
                let text: *const c_char = unsafe { msg_send![said, UTF8String] };
                if !text.is_null()
                    && let Ok(text) = unsafe { CStr::from_ptr(text) }.to_str()
                {
                    super::ended("metrickit", text.to_owned());
                }
            }
        }
    );

    /// Makes `OneExited` one Swift can find, and has MetricKit tell what it knows, once it has (it delivers a day's, at
    /// the next start).
    pub(super) fn subscribe() {
        let _ = Exited::class();
        if let Some(swift) = AnyClass::get(c"OneMetrics") {
            let () = unsafe { msg_send![swift, subscribe] };
        }
    }
}

/// An iPhone's app listens for what MetricKit says ended it.
#[cfg(target_os = "ios")]
pub(crate) fn subscribe() {
    metrics::subscribe();
}

/// Told by Android's `MainActivity` as it starts, of an exit `ApplicationExitInfo` says wasn't the app's own: why, as it
/// says it.
#[cfg(target_os = "android")]
#[unsafe(no_mangle)]
pub extern "system" fn Java_app_theone_client_Notifications_exited<'local>(mut env: jni::JNIEnv<'local>, _class: jni::objects::JClass<'local>, reason: jni::objects::JString<'local>) {
    if let Ok(reason) = env.get_string(&reason) {
        ended("exit_info", String::from(reason));
    }
}
