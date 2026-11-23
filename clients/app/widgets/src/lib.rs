//! What a phone's home-screen widgets ask their network through: the widgets there are to pick from
//! (`home-screen_pages`), a widget's layout, and what its buttons and switches call, as the app asks (`answer`). An
//! iPhone's are drawn in a process of the system's, its Widget Extension (`clients/app/gen/apple/Widgets`), which opens
//! the app's client from the App Group the two share, as the app's notification extension reads its key there, and keeps
//! it while the system keeps the process, so the next widget asks over the same connection. Android's are drawn in the
//! app's own process, with its client (`Widgets` in `clients/app/src/session.rs`).

use std::ffi::{CStr, CString, c_char};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use anyhow::{Context, Result, anyhow};
use client::{Client, State};
use serde_json::{Value, json};
use tokio::runtime::Runtime;
use tokio::sync::OnceCell;
use tokio::time::timeout;

/// How long a widget waits for its network: WidgetKit gives a timeline a few more seconds than this.
const WAIT: Duration = Duration::from_secs(20);

/// Asks the network of the client kept in `home` for `method` with `params` (JSON), as the app would, and gives what it
/// answered as JSON: `{"result": …}`, or `{"error": "…"}`, with `"signedOut": true` where this device isn't in its
/// network. It waits for the answer, so it's asked off the main thread. What it gives is freed with
/// `one_widgets_free`.
///
/// # Safety
///
/// Each is a C string, valid for the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn one_widgets_request(home: *const c_char, method: *const c_char, params: *const c_char) -> *mut c_char {
    let text = |text: *const c_char| unsafe { CStr::from_ptr(text) }.to_string_lossy().into_owned();
    let (home, method, params) = (text(home), text(method), text(params));
    let answer = runtime().block_on(answer(open(&home), &method, &params));
    CString::new(answer.to_string()).expect("JSON has no NUL").into_raw()
}

/// Frees what `one_widgets_request` gave.
///
/// # Safety
///
/// `text` is what it gave, freed once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn one_widgets_free(text: *mut c_char) {
    if !text.is_null() {
        drop(unsafe { CString::from_raw(text) });
    }
}

/// What the client `client` opens is answered for `method` with `params` (JSON), as JSON: `{"result": …}`, or
/// `{"error": "…"}`, with `"signedOut": true` where this device isn't in its network, which a widget says to sign in to.
pub async fn answer(client: impl Future<Output = Result<Arc<Client>>>, method: &str, params: &str) -> Value {
    let asked = async {
        let client = client.await?;
        let mut state = client.state();
        let state = state.wait_for(|state| !matches!(state, State::Opening { .. })).await?.clone();
        if let State::SignIn { .. } = state {
            return Ok(json!({"error": state.to_string(), "signedOut": true}));
        }
        let params: Value = serde_json::from_str(params).context("what was asked isn't JSON")?;
        anyhow::Ok(json!({"result": client.request(method, params).await?}))
    };
    match timeout(WAIT, asked).await {
        Ok(answer) => answer.unwrap_or_else(|error| json!({"error": format!("{error:#}")})),
        Err(_) => json!({"error": "Your network didn't answer."}),
    }
}

fn runtime() -> &'static Runtime {
    static RUNTIME: OnceLock<Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("a runtime"))
}

/// The app's client kept in `home`, opened once for the process.
async fn open(home: &str) -> Result<Arc<Client>> {
    static CLIENT: OnceCell<Arc<Client>> = OnceCell::const_new();
    CLIENT.get_or_try_init(|| Client::open(home, "widget", Vec::new(), Vec::new())).await.cloned().map_err(|error| anyhow!("{error:#}"))
}
