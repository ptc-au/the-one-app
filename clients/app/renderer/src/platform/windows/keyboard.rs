// The key names from Zed's GPUI (github.com/zed-industries/zed, crates/gpui/src/platform/windows/events.rs,
// `parse_normal_key` and `current_modifiers`) at commit 69e2130295c2649963eb639fc70b4f2ee8ea1624 (gpui 0.2.2 on
// crates.io), named here as the DOM's `KeyboardEvent.key` names them, which the renderer's `keydown` and the
// inspector speak. What a key types is WM_CHAR's (`window`); this names the keys that type nothing, and a letter or
// digit held with Ctrl or Alt, which types nothing either.
// Copyright 2022 - 2025 Zed Industries, Inc. Licensed under the Apache License, Version 2.0
// (clients/app/renderer/LICENSE-APACHE); this file is changed from the original.
// Where each key is on the keyboard (`CODES`) is tao's (github.com/tauri-apps/tao, tao 0.37.2 on crates.io,
// src/platform_impl/windows/keycode.rs, `keycode_from_scancode`), named as the DOM's `KeyboardEvent.code` names them.
// Copyright 2014 - 2021 The winit contributors, 2021 - 2025 The Tauri Programme within The Commons Conservancy.
// Licensed under the Apache License, Version 2.0 (clients/app/renderer/LICENSE-APACHE).

use windows::Win32::UI::Input::KeyboardAndMouse::*;

use crate::inspect::Key;

/// Key `vkey` pressed, if it's one that types nothing by itself: a named key, or a letter or digit with Ctrl or Alt;
/// `lparam` is its message's, which says where it is on the keyboard.
pub fn key(vkey: VIRTUAL_KEY, lparam: isize) -> Option<Key> {
    let modifiers = modifiers(lparam);
    let named = match vkey {
        VK_BACK => "Backspace",
        VK_RETURN => "Enter",
        VK_TAB => "Tab",
        VK_UP => "ArrowUp",
        VK_DOWN => "ArrowDown",
        VK_RIGHT => "ArrowRight",
        VK_LEFT => "ArrowLeft",
        VK_HOME => "Home",
        VK_END => "End",
        VK_PRIOR => "PageUp",
        VK_NEXT => "PageDown",
        VK_ESCAPE => "Escape",
        VK_INSERT => "Insert",
        VK_DELETE => "Delete",
        VK_APPS => "ContextMenu",
        VK_SHIFT | VK_LSHIFT | VK_RSHIFT => "Shift",
        VK_CONTROL | VK_LCONTROL | VK_RCONTROL => "Control",
        VK_MENU | VK_LMENU | VK_RMENU => "Alt",
        VK_LWIN | VK_RWIN => "Meta",
        _ => "",
    };
    let key = if !named.is_empty() {
        named.to_owned()
    } else if (VK_F1.0..=VK_F24.0).contains(&vkey.0) {
        format!("F{}", vkey.0 - VK_F1.0 + 1)
    } else if (modifiers.ctrl || modifiers.alt) && matches!(u8::try_from(vkey.0), Ok(b'A'..=b'Z' | b'0'..=b'9' | b' ')) {
        // A letter, digit or space with Ctrl or Alt: the key's own character, as the DOM has it.
        char::from(vkey.0 as u8).to_ascii_lowercase().to_string()
    } else {
        return None;
    };
    Some(Key { key, ..modifiers })
}

/// What `typed` types, with the modifiers held; `lparam` is its WM_CHAR's, which says where its key is.
pub fn typed(typed: String, lparam: isize) -> Key {
    Key { key: typed, ..modifiers(lparam) }
}

/// The `code` of the key a key message's `lparam` is of: its scan code, with 0xE0 before it for an extended key.
fn code(lparam: isize) -> String {
    let scan = ((lparam >> 16) & 0xFF) as u32 | if lparam & (1 << 24) != 0 { 0xE000 } else { 0 };
    CODES.iter().find(|(at, _)| *at == scan).map_or("", |(_, code)| code).to_owned()
}

/// Each key's `code` by its scan code, which is where it is on the keyboard, whatever it types.
const CODES: &[(u32, &str)] = &[
    (0x0029, "Backquote"), (0x002B, "Backslash"), (0x000E, "Backspace"), (0x001A, "BracketLeft"), (0x001B,
    "BracketRight"), (0x0033, "Comma"), (0x000B, "Digit0"), (0x0002, "Digit1"), (0x0003, "Digit2"), (0x0004,
    "Digit3"), (0x0005, "Digit4"), (0x0006, "Digit5"), (0x0007, "Digit6"), (0x0008, "Digit7"), (0x0009, "Digit8"),
    (0x000A, "Digit9"), (0x000D, "Equal"), (0x0056, "IntlBackslash"), (0x0073, "IntlRo"), (0x007D, "IntlYen"),
    (0x001E, "KeyA"), (0x0030, "KeyB"), (0x002E, "KeyC"), (0x0020, "KeyD"), (0x0012, "KeyE"), (0x0021, "KeyF"),
    (0x0022, "KeyG"), (0x0023, "KeyH"), (0x0017, "KeyI"), (0x0024, "KeyJ"), (0x0025, "KeyK"), (0x0026, "KeyL"),
    (0x0032, "KeyM"), (0x0031, "KeyN"), (0x0018, "KeyO"), (0x0019, "KeyP"), (0x0010, "KeyQ"), (0x0013, "KeyR"),
    (0x001F, "KeyS"), (0x0014, "KeyT"), (0x0016, "KeyU"), (0x002F, "KeyV"), (0x0011, "KeyW"), (0x002D, "KeyX"),
    (0x0015, "KeyY"), (0x002C, "KeyZ"), (0x000C, "Minus"), (0x0034, "Period"), (0x0028, "Quote"), (0x0027,
    "Semicolon"), (0x0035, "Slash"), (0x0038, "AltLeft"), (0xE038, "AltRight"), (0x003A, "CapsLock"), (0xE05D,
    "ContextMenu"), (0x001D, "ControlLeft"), (0xE01D, "ControlRight"), (0x001C, "Enter"), (0xE05B, "MetaLeft"),
    (0xE05C, "MetaRight"), (0x002A, "ShiftLeft"), (0x0036, "ShiftRight"), (0x0039, "Space"), (0x000F, "Tab"), (0x0079,
    "Convert"), (0x0072, "Lang1"), (0xE0F2, "Lang1"), (0x0071, "Lang2"), (0xE0F1, "Lang2"), (0x0070, "KanaMode"),
    (0x007B, "NonConvert"), (0xE053, "Delete"), (0xE04F, "End"), (0xE047, "Home"), (0xE052, "Insert"), (0xE051,
    "PageDown"), (0xE049, "PageUp"), (0xE050, "ArrowDown"), (0xE04B, "ArrowLeft"), (0xE04D, "ArrowRight"), (0xE048,
    "ArrowUp"), (0xE045, "NumLock"), (0x0052, "Numpad0"), (0x004F, "Numpad1"), (0x0050, "Numpad2"), (0x0051,
    "Numpad3"), (0x004B, "Numpad4"), (0x004C, "Numpad5"), (0x004D, "Numpad6"), (0x0047, "Numpad7"), (0x0048,
    "Numpad8"), (0x0049, "Numpad9"), (0x004E, "NumpadAdd"), (0x007E, "NumpadComma"), (0x0053, "NumpadDecimal"),
    (0xE035, "NumpadDivide"), (0xE01C, "NumpadEnter"), (0x0059, "NumpadEqual"), (0x0037, "NumpadMultiply"), (0x004A,
    "NumpadSubtract"), (0x0001, "Escape"), (0x003B, "F1"), (0x003C, "F2"), (0x003D, "F3"), (0x003E, "F4"), (0x003F,
    "F5"), (0x0040, "F6"), (0x0041, "F7"), (0x0042, "F8"), (0x0043, "F9"), (0x0044, "F10"), (0x0057, "F11"), (0x0058,
    "F12"), (0x0064, "F13"), (0x0065, "F14"), (0x0066, "F15"), (0x0067, "F16"), (0x0068, "F17"), (0x0069, "F18"),
    (0x006A, "F19"), (0x006B, "F20"), (0x006C, "F21"), (0x006D, "F22"), (0x006E, "F23"), (0x0076, "F24"), (0xE037,
    "PrintScreen"), (0x0054, "PrintScreen"), (0x0046, "ScrollLock"), (0x0045, "Pause"), (0xE046, "Pause"), (0xE06A,
    "BrowserBack"), (0xE066, "BrowserFavorites"), (0xE069, "BrowserForward"), (0xE032, "BrowserHome"), (0xE067,
    "BrowserRefresh"), (0xE065, "BrowserSearch"), (0xE068, "BrowserStop"), (0xE06B, "LaunchApp1"), (0xE021,
    "LaunchApp2"), (0xE06C, "LaunchMail"), (0xE022, "MediaPlayPause"), (0xE06D, "MediaSelect"), (0xE024, "MediaStop"),
    (0xE019, "MediaTrackNext"), (0xE010, "MediaTrackPrevious"), (0xE05E, "Power"), (0xE02E, "AudioVolumeDown"),
    (0xE020, "AudioVolumeMute"), (0xE030, "AudioVolumeUp")
];


fn is_virtual_key_pressed(vkey: VIRTUAL_KEY) -> bool {
    unsafe { GetKeyState(vkey.0 as i32) < 0 }
}

/// The modifiers held, with AltGr (Windows' right Alt and left Ctrl together) neither, and the key `lparam` is of.
fn modifiers(lparam: isize) -> Key {
    let altgr = is_virtual_key_pressed(VK_RMENU) && is_virtual_key_pressed(VK_LCONTROL);
    Key {
        key: String::new(),
        code: code(lparam),
        ctrl: is_virtual_key_pressed(VK_CONTROL) && !altgr,
        alt: is_virtual_key_pressed(VK_MENU) && !altgr,
        shift: is_virtual_key_pressed(VK_SHIFT),
        meta: is_virtual_key_pressed(VK_LWIN) || is_virtual_key_pressed(VK_RWIN),
    }
}
