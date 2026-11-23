// The key names from Zed's GPUI (github.com/zed-industries/zed, crates/gpui_linux/src/linux/platform.rs,
// `keystroke_from_xkb`, `get_xkb_compose_state` and `keystroke_underlying_dead_key`, and x11/client.rs,
// `xkb_state_for_key_event`) at commit
// 1043f4a86ab911a381d9bfe45cf6b36d3cdcc89a, named here as the DOM's `KeyboardEvent.key` names them, which the
// renderer's `keydown` and the inspector speak.
// Copyright 2022 - 2025 Zed Industries, Inc. Licensed under the Apache License, Version 2.0
// (clients/app/renderer/LICENSE-APACHE); this file is changed from the original.
// Where each key is on the keyboard (`CODES`) is tao's (github.com/tauri-apps/tao, tao 0.37.2 on crates.io,
// src/platform_impl/linux/keycode.rs, `keycode_from_scancode`), named as the DOM's `KeyboardEvent.code` names them.
// Copyright 2014 - 2021 The winit contributors, 2021 - 2025 The Tauri Programme within The Commons Conservancy.
// Licensed under the Apache License, Version 2.0 (clients/app/renderer/LICENSE-APACHE).

use x11rb::protocol::xproto;
use xkbcommon::xkb::{self, Keycode, Keysym, State};

use crate::inspect::Key;

/// The key `keycode` is, with the modifiers held, as xkbcommon's state has them.
pub fn key(state: &State, keycode: Keycode) -> Key {
    let sym = state.key_get_one_sym(keycode);
    let typed = state.key_get_utf8(keycode);
    let named = match sym {
        Keysym::Return | Keysym::KP_Enter => "Enter",
        Keysym::Tab | Keysym::ISO_Left_Tab => "Tab",
        Keysym::BackSpace => "Backspace",
        Keysym::Delete | Keysym::KP_Delete => "Delete",
        Keysym::Escape => "Escape",
        Keysym::Left | Keysym::KP_Left => "ArrowLeft",
        Keysym::Right | Keysym::KP_Right => "ArrowRight",
        Keysym::Up | Keysym::KP_Up => "ArrowUp",
        Keysym::Down | Keysym::KP_Down => "ArrowDown",
        Keysym::Home | Keysym::KP_Home => "Home",
        Keysym::End | Keysym::KP_End => "End",
        Keysym::Prior | Keysym::KP_Prior => "PageUp",
        Keysym::Next | Keysym::KP_Next => "PageDown",
        Keysym::Insert => "Insert",
        Keysym::Shift_L | Keysym::Shift_R => "Shift",
        Keysym::Control_L | Keysym::Control_R => "Control",
        Keysym::Alt_L | Keysym::Alt_R => "Alt",
        Keysym::Super_L | Keysym::Super_R => "Meta",
        Keysym::Multi_key => "Compose",
        sym if (0xfe50..=0xfe93).contains(&sym.raw()) => "Dead",
        _ => "",
    };
    let key = if !named.is_empty() {
        named.to_owned()
    } else if (0xffbe..=0xffe0).contains(&sym.raw()) {
        format!("F{}", sym.raw() - 0xffbe + 1)
    } else if !typed.is_empty() && !typed.chars().any(char::is_control) {
        typed
    } else {
        // A key with a modifier that types nothing of its own (Ctrl-W): the key's own character, as the DOM has it.
        let lower = xkb::keysym_to_utf32(sym);
        char::from_u32(lower).filter(|c| !c.is_control() && *c != '\0').map_or_else(|| "Unidentified".to_owned(), |c| c.to_string())
    };
    let held = |name: &str| state.mod_name_is_active(name, xkb::STATE_MODS_EFFECTIVE);
    let code = CODES.iter().find(|(at, _)| *at == keycode.raw()).map_or("", |(_, code)| code).to_owned();
    Key { key, code, shift: held(xkb::MOD_NAME_SHIFT), alt: held(xkb::MOD_NAME_ALT), ctrl: held(xkb::MOD_NAME_CTRL), meta: held(xkb::MOD_NAME_LOGO) }
}

/// Each key's `code` by its X keycode, which is where it is on the keyboard, whatever it types.
const CODES: &[(u32, &str)] = &[
    (0x0009, "Escape"), (0x000A, "Digit1"), (0x000B, "Digit2"), (0x000C, "Digit3"), (0x000D, "Digit4"), (0x000E,
    "Digit5"), (0x000F, "Digit6"), (0x0010, "Digit7"), (0x0011, "Digit8"), (0x0012, "Digit9"), (0x0013, "Digit0"),
    (0x0014, "Minus"), (0x0015, "Equal"), (0x0016, "Backspace"), (0x0017, "Tab"), (0x0018, "KeyQ"), (0x0019, "KeyW"),
    (0x001A, "KeyE"), (0x001B, "KeyR"), (0x001C, "KeyT"), (0x001D, "KeyY"), (0x001E, "KeyU"), (0x001F, "KeyI"),
    (0x0020, "KeyO"), (0x0021, "KeyP"), (0x0022, "BracketLeft"), (0x0023, "BracketRight"), (0x0024, "Enter"), (0x0025,
    "ControlLeft"), (0x0026, "KeyA"), (0x0027, "KeyS"), (0x0028, "KeyD"), (0x0029, "KeyF"), (0x002A, "KeyG"), (0x002B,
    "KeyH"), (0x002C, "KeyJ"), (0x002D, "KeyK"), (0x002E, "KeyL"), (0x002F, "Semicolon"), (0x0030, "Quote"), (0x0031,
    "Backquote"), (0x0032, "ShiftLeft"), (0x0033, "Backslash"), (0x0034, "KeyZ"), (0x0035, "KeyX"), (0x0036, "KeyC"),
    (0x0037, "KeyV"), (0x0038, "KeyB"), (0x0039, "KeyN"), (0x003A, "KeyM"), (0x003B, "Comma"), (0x003C, "Period"),
    (0x003D, "Slash"), (0x003E, "ShiftRight"), (0x003F, "NumpadMultiply"), (0x0040, "AltLeft"), (0x0041, "Space"),
    (0x0042, "CapsLock"), (0x0043, "F1"), (0x0044, "F2"), (0x0045, "F3"), (0x0046, "F4"), (0x0047, "F5"), (0x0048,
    "F6"), (0x0049, "F7"), (0x004A, "F8"), (0x004B, "F9"), (0x004C, "F10"), (0x004D, "NumLock"), (0x004E,
    "ScrollLock"), (0x004F, "Numpad7"), (0x0050, "Numpad8"), (0x0051, "Numpad9"), (0x0052, "NumpadSubtract"), (0x0053,
    "Numpad4"), (0x0054, "Numpad5"), (0x0055, "Numpad6"), (0x0056, "NumpadAdd"), (0x0057, "Numpad1"), (0x0058,
    "Numpad2"), (0x0059, "Numpad3"), (0x005A, "Numpad0"), (0x005B, "NumpadDecimal"), (0x005E, "IntlBackslash"),
    (0x005F, "F11"), (0x0060, "F12"), (0x0061, "IntlRo"), (0x0064, "Convert"), (0x0065, "KanaMode"), (0x0066,
    "NonConvert"), (0x0068, "NumpadEnter"), (0x0069, "ControlRight"), (0x006A, "NumpadDivide"), (0x006B,
    "PrintScreen"), (0x006C, "AltRight"), (0x006E, "Home"), (0x006F, "ArrowUp"), (0x0070, "PageUp"), (0x0071,
    "ArrowLeft"), (0x0072, "ArrowRight"), (0x0073, "End"), (0x0074, "ArrowDown"), (0x0075, "PageDown"), (0x0076,
    "Insert"), (0x0077, "Delete"), (0x0079, "AudioVolumeMute"), (0x007A, "AudioVolumeDown"), (0x007B,
    "AudioVolumeUp"), (0x007D, "NumpadEqual"), (0x007F, "Pause"), (0x0081, "NumpadComma"), (0x0082, "Lang1"), (0x0083,
    "Lang2"), (0x0084, "IntlYen"), (0x0085, "MetaLeft"), (0x0086, "MetaRight"), (0x0087, "ContextMenu"), (0x0088,
    "BrowserStop"), (0x0089, "Again"), (0x008A, "Props"), (0x008B, "Undo"), (0x008C, "Select"), (0x008D, "Copy"),
    (0x008E, "Open"), (0x008F, "Paste"), (0x0090, "Find"), (0x0091, "Cut"), (0x0092, "Help"), (0x0094, "LaunchApp2"),
    (0x0097, "WakeUp"), (0x0098, "LaunchApp1"), (0x00A3, "LaunchMail"), (0x00A4, "BrowserFavorites"), (0x00A6,
    "BrowserBack"), (0x00A7, "BrowserForward"), (0x00A9, "Eject"), (0x00AB, "MediaTrackNext"), (0x00AC,
    "MediaPlayPause"), (0x00AD, "MediaTrackPrevious"), (0x00AE, "MediaStop"), (0x00B3, "MediaSelect"), (0x00B4,
    "BrowserHome"), (0x00B5, "BrowserRefresh"), (0x00BF, "F13"), (0x00C0, "F14"), (0x00C1, "F15"), (0x00C2, "F16"),
    (0x00C3, "F17"), (0x00C4, "F18"), (0x00C5, "F19"), (0x00C6, "F20"), (0x00C7, "F21"), (0x00C8, "F22"), (0x00C9,
    "F23"), (0x00CA, "F24"), (0x00E1, "BrowserSearch")
];

/// The keyboard's state as a key event says it was when it was pressed: its modifiers from the event, the rest from
/// `xkb`. An input method hands a key back after its modifiers may have come up, as Shift has by the time "A" comes
/// back.
pub fn state_of(xkb: &State, event_state: xproto::KeyButMask) -> State {
    let keymap = xkb.get_keymap();
    let mut key_event_state = State::new(&keymap);
    let latched_modifiers = xkb.serialize_mods(xkb::STATE_MODS_LATCHED);
    let locked_modifiers = xkb.serialize_mods(xkb::STATE_MODS_LOCKED);
    let active_modifier_mask: xkb::ModMask = u16::from(
        event_state
            & (xproto::KeyButMask::SHIFT
                | xproto::KeyButMask::LOCK
                | xproto::KeyButMask::CONTROL
                | xproto::KeyButMask::MOD1
                | xproto::KeyButMask::MOD2
                | xproto::KeyButMask::MOD3
                | xproto::KeyButMask::MOD4
                | xproto::KeyButMask::MOD5),
    )
    .into();
    let depressed_modifiers = active_modifier_mask & !(latched_modifiers | locked_modifiers);
    key_event_state.update_mask(
        depressed_modifiers,
        latched_modifiers,
        locked_modifiers,
        xkb.serialize_layout(xkb::STATE_LAYOUT_DEPRESSED),
        xkb.serialize_layout(xkb::STATE_LAYOUT_LATCHED),
        xkb.serialize_layout(xkb::STATE_LAYOUT_LOCKED),
    );
    key_event_state
}

/// The compose table for the locale, as libxkbcommon finds it (`LC_ALL`, `LC_CTYPE`, `LANG`, then `C`'s), which dead
/// keys and the Compose key type accented letters and symbols by, as GTK's and GPUI's do without an input method.
pub fn compose(context: &xkb::Context) -> Option<xkb::compose::State> {
    let locales = ["LC_ALL", "LC_CTYPE", "LANG"].into_iter().filter_map(|name| std::env::var_os(name).filter(|locale| !locale.is_empty()));
    locales.chain([std::ffi::OsString::from("C")]).find_map(|locale| {
        let table = xkb::compose::Table::new_from_locale(context, &locale, xkb::compose::COMPILE_NO_FLAGS).ok()?;
        Some(xkb::compose::State::new(&table, xkb::compose::STATE_NO_FLAGS))
    })
}

/// What a dead key shows while it waits for the letter it accents, as the DOM's dead keys are drawn
/// (developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values#dead_keycodes_for_linux).
pub fn dead_key(keysym: Keysym) -> Option<String> {
    match keysym {
        Keysym::dead_grave => Some("`".to_owned()),
        Keysym::dead_acute => Some("´".to_owned()),
        Keysym::dead_circumflex => Some("^".to_owned()),
        Keysym::dead_tilde => Some("~".to_owned()),
        Keysym::dead_macron => Some("¯".to_owned()),
        Keysym::dead_breve => Some("˘".to_owned()),
        Keysym::dead_abovedot => Some("˙".to_owned()),
        Keysym::dead_diaeresis => Some("¨".to_owned()),
        Keysym::dead_abovering => Some("˚".to_owned()),
        Keysym::dead_doubleacute => Some("˝".to_owned()),
        Keysym::dead_caron => Some("ˇ".to_owned()),
        Keysym::dead_cedilla => Some("¸".to_owned()),
        Keysym::dead_ogonek => Some("˛".to_owned()),
        Keysym::dead_iota => Some("ͅ".to_owned()),
        Keysym::dead_voiced_sound => Some("゙".to_owned()),
        Keysym::dead_semivoiced_sound => Some("゚".to_owned()),
        Keysym::dead_belowdot => Some("̣̣".to_owned()),
        Keysym::dead_hook => Some("̡".to_owned()),
        Keysym::dead_horn => Some("̛".to_owned()),
        Keysym::dead_stroke => Some("̶̶".to_owned()),
        Keysym::dead_abovecomma => Some("̓̓".to_owned()),
        Keysym::dead_abovereversedcomma => Some("ʽ".to_owned()),
        Keysym::dead_doublegrave => Some("̏".to_owned()),
        Keysym::dead_belowring => Some("˳".to_owned()),
        Keysym::dead_belowmacron => Some("̱".to_owned()),
        Keysym::dead_belowcircumflex => Some("ꞈ".to_owned()),
        Keysym::dead_belowtilde => Some("̰".to_owned()),
        Keysym::dead_belowbreve => Some("̮".to_owned()),
        Keysym::dead_belowdiaeresis => Some("̤".to_owned()),
        Keysym::dead_invertedbreve => Some("̯".to_owned()),
        Keysym::dead_belowcomma => Some("̦".to_owned()),
        Keysym::dead_currency => None,
        Keysym::dead_lowline => None,
        Keysym::dead_aboveverticalline => None,
        Keysym::dead_belowverticalline => None,
        Keysym::dead_longsolidusoverlay => None,
        Keysym::dead_a => None,
        Keysym::dead_A => None,
        Keysym::dead_e => None,
        Keysym::dead_E => None,
        Keysym::dead_i => None,
        Keysym::dead_I => None,
        Keysym::dead_o => None,
        Keysym::dead_O => None,
        Keysym::dead_u => None,
        Keysym::dead_U => None,
        Keysym::dead_small_schwa => Some("ə".to_owned()),
        Keysym::dead_capital_schwa => Some("Ə".to_owned()),
        Keysym::dead_greek => None,
        _ => None,
    }
}
