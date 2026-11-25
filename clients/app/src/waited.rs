//! How long a page's spinner was in sight (the UI library's `<Spinner delay />`, which shows only after half a
//! second), told to Telemetry as `one.client.wait.duration`, a histogram by its app (`one.view`), the screen it was on
//! (`one.screen`) and the tool it waited on (`one.tool`): the last answered of the page's calls that were asked before
//! it came into sight and answered after, which this keeps of each view (`asked`, `answered`).

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::json;

/// A tool a view called: when, and when it was answered, while it's under way `None`.
struct Call {
    tool: String,
    asked: Instant,
    answered: Option<Instant>,
}

/// Each view's last calls, by its key (`<subject>|<entrypoint>`).
static CALLS: Mutex<Vec<(String, Vec<Call>)>> = Mutex::new(Vec::new());

/// How many of a view's calls are kept: more than a screen asks as it opens.
const KEPT: usize = 64;

fn with<T>(view: &str, change: impl FnOnce(&mut Vec<Call>) -> T) -> T {
    let mut views = CALLS.lock().expect("nothing panics holding it");
    let at = match views.iter().position(|(key, _)| key == view) {
        Some(at) => at,
        None => {
            views.push((view.to_owned(), Vec::new()));
            views.len() - 1
        }
    };
    change(&mut views[at].1)
}

/// `view` called `tool`. → when, which `answered` is told.
pub(crate) fn asked(view: &str, tool: &str) -> Instant {
    let asked = Instant::now();
    with(view, |calls| {
        if calls.len() >= KEPT {
            calls.remove(0);
        }
        calls.push(Call { tool: tool.to_owned(), asked, answered: None });
    });
    asked
}

/// The call `view` asked at `asked` was answered, or failed.
pub(crate) fn answered(view: &str, asked: Instant) {
    with(view, |calls| {
        if let Some(call) = calls.iter_mut().find(|call| call.asked == asked) {
            call.answered = Some(Instant::now());
        }
    });
}

/// `view`'s page had a spinner in sight for `ms`, on the screen its page is at (`place`, what follows its link's `#`).
pub(crate) fn waited(view: &str, place: &str, ms: u64) {
    let Ok(views) = crate::views() else { return };
    if crate::suspended::within(ms) {
        return;
    }
    let shown = Instant::now().checked_sub(Duration::from_millis(ms)).unwrap_or_else(Instant::now);
    let tool = with(view, |calls| {
        calls
            .iter()
            .filter(|call| call.asked <= shown && call.answered.is_none_or(|answered| answered >= shown))
            .max_by_key(|call| call.answered.unwrap_or_else(Instant::now))
            .map(|call| call.tool.clone())
    });
    let app = view.split('|').next_back().unwrap_or_default().split('/').next().unwrap_or_default();
    // A screen is a tool of its app's: the one its place names, or with none, the app's first screen.
    let screen = match place.split('&').next().unwrap_or_default() {
        "" => app.to_owned(),
        tool => format!("{app}_{tool}"),
    };
    eprintln!("{app} showed a spinner for {ms} ms on {screen}, waiting on {}", tool.as_deref().unwrap_or("nothing it asked"));
    views.client.report(json!({"name": "one.client.wait.duration", "value": ms, "attributes": {"one.view": app, "one.screen": screen, "one.tool": tool}}));
}

/// Forgets a view that closed.
pub(crate) fn closed(view: &str) {
    CALLS.lock().expect("nothing panics holding it").retain(|(key, _)| key != view);
}
