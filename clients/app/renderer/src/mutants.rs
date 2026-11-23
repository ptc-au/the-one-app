//! Bugs we've had, each put back on purpose when it's asked for, so `tests/mutants.js` can show the renderer's tests
//! catch it: a mutant, as cargo-mutants and Stryker call one. Only the tests' builds have them: the headless renderer's
//! and the app's with `fake`. Every other build's `mutant` is `false`, a constant the compiler takes the bug out by.
//!
//! The one asked for is `ONE_MUTANT`'s name. Each is named
//! where it's planted, and listed with what plays it in `tests/mutants.js`.

#[cfg(feature = "mutants")]
static ASKED: std::sync::OnceLock<String> = std::sync::OnceLock::new();

/// Whether the mutant `name` is asked for.
#[cfg(feature = "mutants")]
pub fn mutant(name: &str) -> bool {
    ASKED.get_or_init(|| std::env::var("ONE_MUTANT").unwrap_or_default()) == name
}

#[cfg(not(feature = "mutants"))]
#[inline(always)]
pub fn mutant(_: &str) -> bool {
    false
}

/// Whether `context` is the one a mutant is planted on, by what it holds (`Context::hung`): the first it's asked of,
/// so the context made in its place, as a lost one's is (`Windows::recover`), is well.
#[cfg(feature = "mutants")]
pub fn planted<T>(context: &std::sync::Arc<T>) -> bool {
    static PLANTED: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    let at = std::sync::Arc::as_ptr(context) as *const () as usize;
    *PLANTED.get_or_init(|| at) == at
}

#[cfg(not(feature = "mutants"))]
#[inline(always)]
pub fn planted<T>(_: &std::sync::Arc<T>) -> bool {
    false
}
