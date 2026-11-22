//! Bugs we've had, each put back on purpose when it's asked for, so `tooling/mutants` can show the harness's checks
//! catch it: a mutant, as cargo-mutants and Stryker call one. Only the harness's builds have them: the headless
//! harness's and the app harness's (`fake`) and the web gate's frame (`mutants`, `bun clients/web/renderer/build.js
//! <out> --mutants`). Every other build's `mutant` is `false`, a constant the compiler takes the bug out by.
//!
//! The one asked for is `ONE_MUTANT`'s name natively, and on the web the frame's `?mutant=` (`set`). Each is named
//! where it's planted, and listed with what plays it in `tooling/mutants`.

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

/// The mutant asked for where there's no environment (the web's frame, from its address), before anything asks.
#[cfg(feature = "mutants")]
pub fn set(name: &str) {
    let _ = ASKED.set(name.to_owned());
}
