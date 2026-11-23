// The key names from Zed's GPUI (github.com/zed-industries/zed, crates/gpui/src/platform/mac/events.rs,
// `parse_keystroke`) at commit 69e2130295c2649963eb639fc70b4f2ee8ea1624 (gpui 0.2.2 on crates.io), named here as the
// DOM's `KeyboardEvent.key` names them, which the renderer's `keydown` and the inspector speak, and read with
// objc2's AppKit bindings. What a key types is what AppKit says it types (`characters`), not GPUI's own layout
// lookup: the native host has no key bindings to match.
// Copyright 2022 - 2025 Zed Industries, Inc. Licensed under the Apache License, Version 2.0
// (clients/app/renderer/LICENSE-APACHE); this file is changed from the original.
// Where each key is on the keyboard (`CODES`) is tao's (github.com/tauri-apps/tao, tao 0.37.2 on crates.io,
// src/platform_impl/macos/keycode.rs, `keycode_from_scancode`), named as the DOM's `KeyboardEvent.code` names them.
// Copyright 2014 - 2021 The winit contributors, 2021 - 2025 The Tauri Programme within The Commons Conservancy.
// Licensed under the Apache License, Version 2.0 (clients/app/renderer/LICENSE-APACHE).

use objc2_app_kit::{
    NSDeleteFunctionKey, NSDownArrowFunctionKey, NSEndFunctionKey, NSEvent, NSEventModifierFlags, NSF1FunctionKey, NSF35FunctionKey,
    NSHelpFunctionKey, NSHomeFunctionKey, NSLeftArrowFunctionKey, NSPageDownFunctionKey, NSPageUpFunctionKey, NSRightArrowFunctionKey,
    NSUpArrowFunctionKey,
};

use crate::inspect::Key;

const BACKSPACE_KEY: u16 = 0x7f;
const ENTER_KEY: u16 = 0x0d;
const NUMPAD_ENTER_KEY: u16 = 0x03;
const ESCAPE_KEY: u16 = 0x1b;
const TAB_KEY: u16 = 0x09;
const SHIFT_TAB_KEY: u16 = 0x19;

/// The key `event` is, with the modifiers held: a named key (Enter, ArrowLeft), else the character it types, or with
/// ⌘ or Control the key's own character, as the DOM has it (⌘A's `a`).
pub fn key(event: &NSEvent) -> Key {
    let flags = event.modifierFlags();
    let held = |flag: NSEventModifierFlags| flags.contains(flag);
    let (shift, alt, ctrl, meta) =
        (held(NSEventModifierFlags::Shift), held(NSEventModifierFlags::Option), held(NSEventModifierFlags::Control), held(NSEventModifierFlags::Command));
    let ignoring = event.charactersIgnoringModifiers().map(|characters| characters.to_string()).unwrap_or_default();
    let first = ignoring.encode_utf16().next();
    #[allow(non_upper_case_globals)]
    let named = match first.map(u32::from) {
        Some(code) if code == u32::from(ENTER_KEY) || code == u32::from(NUMPAD_ENTER_KEY) => "Enter",
        Some(code) if code == u32::from(TAB_KEY) || code == u32::from(SHIFT_TAB_KEY) => "Tab",
        Some(code) if code == u32::from(BACKSPACE_KEY) => "Backspace",
        Some(code) if code == u32::from(ESCAPE_KEY) => "Escape",
        Some(NSUpArrowFunctionKey) => "ArrowUp",
        Some(NSDownArrowFunctionKey) => "ArrowDown",
        Some(NSLeftArrowFunctionKey) => "ArrowLeft",
        Some(NSRightArrowFunctionKey) => "ArrowRight",
        Some(NSPageUpFunctionKey) => "PageUp",
        Some(NSPageDownFunctionKey) => "PageDown",
        Some(NSHomeFunctionKey) => "Home",
        Some(NSEndFunctionKey) => "End",
        Some(NSDeleteFunctionKey) => "Delete",
        // Observed Insert==NSHelpFunctionKey not NSInsertFunctionKey.
        Some(NSHelpFunctionKey) => "Insert",
        _ => "",
    };
    let key = match first.map(u32::from) {
        _ if !named.is_empty() => named.to_owned(),
        Some(code @ NSF1FunctionKey..=NSF35FunctionKey) => format!("F{}", code - NSF1FunctionKey + 1),
        // A key with ⌘ or Control types nothing of its own: the key's own character, as the DOM has it.
        _ if ctrl || meta => ignoring,
        _ => event.characters().map(|characters| characters.to_string()).unwrap_or_default(),
    };
    let code = CODES.iter().find(|(at, _)| *at == event.keyCode()).map_or("", |(_, code)| code).to_owned();
    Key { key, code, shift, alt, ctrl, meta }
}

/// Each key's `code` by its virtual key code (`keyCode`), which is where it is on the keyboard, whatever it types.
const CODES: &[(u16, &str)] = &[
    (0x00, "KeyA"), (0x01, "KeyS"), (0x02, "KeyD"), (0x03, "KeyF"), (0x04, "KeyH"), (0x05, "KeyG"), (0x06, "KeyZ"),
    (0x07, "KeyX"), (0x08, "KeyC"), (0x09, "KeyV"), (0x0B, "KeyB"), (0x0C, "KeyQ"), (0x0D, "KeyW"), (0x0E, "KeyE"),
    (0x0F, "KeyR"), (0x10, "KeyY"), (0x11, "KeyT"), (0x12, "Digit1"), (0x13, "Digit2"), (0x14, "Digit3"), (0x15,
    "Digit4"), (0x16, "Digit6"), (0x17, "Digit5"), (0x18, "Equal"), (0x19, "Digit9"), (0x1A, "Digit7"), (0x1B,
    "Minus"), (0x1C, "Digit8"), (0x1D, "Digit0"), (0x1E, "BracketRight"), (0x1F, "KeyO"), (0x20, "KeyU"), (0x21,
    "BracketLeft"), (0x22, "KeyI"), (0x23, "KeyP"), (0x24, "Enter"), (0x25, "KeyL"), (0x26, "KeyJ"), (0x27, "Quote"),
    (0x28, "KeyK"), (0x29, "Semicolon"), (0x2A, "Backslash"), (0x2B, "Comma"), (0x2C, "Slash"), (0x2D, "KeyN"), (0x2E,
    "KeyM"), (0x2F, "Period"), (0x30, "Tab"), (0x31, "Space"), (0x32, "Backquote"), (0x33, "Backspace"), (0x35,
    "Escape"), (0x36, "MetaRight"), (0x37, "MetaLeft"), (0x38, "ShiftLeft"), (0x39, "CapsLock"), (0x3A, "AltLeft"),
    (0x3B, "ControlLeft"), (0x3C, "ShiftRight"), (0x3D, "AltRight"), (0x3E, "ControlRight"), (0x3F, "Fn"), (0x40,
    "F17"), (0x41, "NumpadDecimal"), (0x43, "NumpadMultiply"), (0x45, "NumpadAdd"), (0x47, "NumLock"), (0x49,
    "AudioVolumeDown"), (0x4B, "NumpadDivide"), (0x4C, "NumpadEnter"), (0x4E, "NumpadSubtract"), (0x4F, "F18"), (0x50,
    "F19"), (0x51, "NumpadEqual"), (0x52, "Numpad0"), (0x53, "Numpad1"), (0x54, "Numpad2"), (0x55, "Numpad3"), (0x56,
    "Numpad4"), (0x57, "Numpad5"), (0x58, "Numpad6"), (0x59, "Numpad7"), (0x5A, "F20"), (0x5B, "Numpad8"), (0x5C,
    "Numpad9"), (0x5D, "IntlYen"), (0x60, "F5"), (0x61, "F6"), (0x62, "F7"), (0x63, "F3"), (0x64, "F8"), (0x65, "F9"),
    (0x67, "F11"), (0x69, "F13"), (0x6A, "F16"), (0x6B, "F14"), (0x6D, "F10"), (0x6F, "F12"), (0x71, "F15"), (0x72,
    "Insert"), (0x73, "Home"), (0x74, "PageUp"), (0x75, "Delete"), (0x76, "F4"), (0x77, "End"), (0x78, "F2"), (0x79,
    "PageDown"), (0x7A, "F1"), (0x7B, "ArrowLeft"), (0x7C, "ArrowRight"), (0x7D, "ArrowDown"), (0x7E, "ArrowUp"),
    (0x0A, "Backquote")
];

/// The key one of AppKit's standard text commands (NSStandardKeyBindingResponding) stands for on a Mac, as the DOM
/// names it, for a command that came with no key: from an input method's menu, or a binding of the person's own.
pub fn command(selector: &str) -> Option<Key> {
    let (key, shift, alt, meta) = match selector {
        "deleteBackward:" | "deleteBackwardByDecomposingPreviousCharacter:" => ("Backspace", false, false, false),
        "deleteForward:" => ("Delete", false, false, false),
        "deleteWordBackward:" => ("Backspace", false, true, false),
        "deleteWordForward:" => ("Delete", false, true, false),
        "deleteToBeginningOfLine:" => ("Backspace", false, false, true),
        "deleteToEndOfLine:" | "deleteToEndOfParagraph:" => ("Delete", false, false, true),
        "insertNewline:" | "insertLineBreak:" => ("Enter", false, false, false),
        "insertTab:" => ("Tab", false, false, false),
        "insertBacktab:" => ("Tab", true, false, false),
        "cancelOperation:" => ("Escape", false, false, false),
        "moveLeft:" | "moveBackward:" => ("ArrowLeft", false, false, false),
        "moveRight:" | "moveForward:" => ("ArrowRight", false, false, false),
        "moveUp:" => ("ArrowUp", false, false, false),
        "moveDown:" => ("ArrowDown", false, false, false),
        "moveLeftAndModifySelection:" | "moveBackwardAndModifySelection:" => ("ArrowLeft", true, false, false),
        "moveRightAndModifySelection:" | "moveForwardAndModifySelection:" => ("ArrowRight", true, false, false),
        "moveWordLeft:" => ("ArrowLeft", false, true, false),
        "moveWordRight:" => ("ArrowRight", false, true, false),
        "moveWordLeftAndModifySelection:" => ("ArrowLeft", true, true, false),
        "moveWordRightAndModifySelection:" => ("ArrowRight", true, true, false),
        "moveToBeginningOfLine:" | "moveToLeftEndOfLine:" | "moveToBeginningOfParagraph:" => ("ArrowLeft", false, false, true),
        "moveToEndOfLine:" | "moveToRightEndOfLine:" | "moveToEndOfParagraph:" => ("ArrowRight", false, false, true),
        "moveToBeginningOfLineAndModifySelection:" | "moveToLeftEndOfLineAndModifySelection:" => ("ArrowLeft", true, false, true),
        "moveToEndOfLineAndModifySelection:" | "moveToRightEndOfLineAndModifySelection:" => ("ArrowRight", true, false, true),
        "moveToBeginningOfDocument:" => ("ArrowUp", false, false, true),
        "moveToEndOfDocument:" => ("ArrowDown", false, false, true),
        _ => return None,
    };
    Some(Key { key: key.to_owned(), code: crate::inspect::code_of(key), shift, alt, ctrl: false, meta })
}
