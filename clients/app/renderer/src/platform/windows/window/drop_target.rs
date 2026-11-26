// Files dragged from Explorer over an app's window, as OLE tells a drop target (`IDropTarget`), as Windows' own apps
// take them: where they are as they move, as they leave, and dropped.

use windows::Win32::Foundation::{HWND, POINT, POINTL};
use windows::Win32::Graphics::Gdi::ScreenToClient;
use windows::Win32::System::Com::{DVASPECT_CONTENT, FORMATETC, IDataObject, TYMED_HGLOBAL};
use windows::Win32::System::Ole::{CF_HDROP, DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE, IDropTarget, IDropTarget_Impl, RegisterDragDrop, ReleaseStgMedium, RevokeDragDrop};
use windows::Win32::System::SystemServices::MODIFIERKEYS_FLAGS;
use windows::Win32::UI::HiDpi::GetDpiForWindow;
use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};
use windows::Win32::UI::WindowsAndMessaging::{GWLP_USERDATA, GetWindowLongPtrW, USER_DEFAULT_SCREEN_DPI};
use windows::core::{Ref, implement};

use super::State;
use crate::geometry::Point;
use crate::platform::Input;

/// Window `hwnd` takes files dropped from Explorer. Its thread is OLE's (`OleInitialize`, `Display::new`).
pub(super) fn register(hwnd: HWND) {
    let target: IDropTarget = DropTarget { hwnd, files: std::cell::Cell::new(false) }.into();
    if let Err(error) = unsafe { RegisterDragDrop(hwnd, &target) } {
        log::warn!("files can't be dropped on window {hwnd:?}: {error}");
    }
}

/// Window `hwnd` takes no more drops, as it goes.
pub(super) fn revoke(hwnd: HWND) {
    let _ = unsafe { RevokeDragDrop(hwnd) };
}

#[implement(IDropTarget)]
struct DropTarget {
    hwnd: HWND,
    /// Whether what's dragged over it now is files, as it said as it came (`DragEnter`).
    files: std::cell::Cell<bool>,
}

/// CF_HDROP, a list of files, which is all a window takes.
const FILES: FORMATETC = FORMATETC { cfFormat: CF_HDROP.0, ptd: std::ptr::null_mut(), dwAspect: DVASPECT_CONTENT.0, lindex: -1, tymed: TYMED_HGLOBAL.0 as u32 };

impl DropTarget {
    /// Tells its window's page `input`.
    fn push(&self, input: Input) {
        let state = unsafe { GetWindowLongPtrW(self.hwnd, GWLP_USERDATA) } as *const State;
        if let Some(state) = unsafe { state.as_ref() } {
            state.queue.borrow_mut().push((state.id, state.part, input));
        }
    }

    /// Where `point` on the screen, in pixels, is in its window, in points.
    fn at(&self, point: &POINTL) -> Point<f32> {
        let mut point = POINT { x: point.x, y: point.y };
        let scale = unsafe {
            let _ = ScreenToClient(self.hwnd, &mut point);
            GetDpiForWindow(self.hwnd) as f32 / USER_DEFAULT_SCREEN_DPI as f32
        };
        Point { x: point.x as f32 / scale, y: point.y as f32 / scale }
    }
}

impl IDropTarget_Impl for DropTarget_Impl {
    fn DragEnter(&self, data: Ref<IDataObject>, _keys: MODIFIERKEYS_FLAGS, point: &POINTL, effect: *mut DROPEFFECT) -> windows::core::Result<()> {
        let files = data.ok().is_ok_and(|data| unsafe { data.QueryGetData(&FILES) }.is_ok());
        self.files.set(files);
        unsafe { *effect = if files { DROPEFFECT_COPY } else { DROPEFFECT_NONE } };
        if files {
            self.push(Input::Dragged(Some(self.at(point))));
        }
        Ok(())
    }

    fn DragOver(&self, _keys: MODIFIERKEYS_FLAGS, point: &POINTL, effect: *mut DROPEFFECT) -> windows::core::Result<()> {
        unsafe { *effect = if self.files.get() { DROPEFFECT_COPY } else { DROPEFFECT_NONE } };
        if self.files.get() {
            self.push(Input::Dragged(Some(self.at(point))));
        }
        Ok(())
    }

    fn DragLeave(&self) -> windows::core::Result<()> {
        self.files.set(false);
        self.push(Input::Dragged(None));
        Ok(())
    }

    fn Drop(&self, data: Ref<IDataObject>, _keys: MODIFIERKEYS_FLAGS, point: &POINTL, effect: *mut DROPEFFECT) -> windows::core::Result<()> {
        let mut files = Vec::new();
        if let Ok(mut medium) = data.ok().and_then(|data| unsafe { data.GetData(&FILES) }) {
            let drop = HDROP(unsafe { medium.u.hGlobal.0 });
            unsafe {
                for at in 0..DragQueryFileW(drop, u32::MAX, None) {
                    let mut name = vec![0u16; DragQueryFileW(drop, at, None) as usize + 1];
                    let length = DragQueryFileW(drop, at, Some(&mut name)) as usize;
                    files.push(std::path::PathBuf::from(String::from_utf16_lossy(&name[..length])));
                }
                ReleaseStgMedium(&mut medium);
            }
        }
        unsafe { *effect = if files.is_empty() { DROPEFFECT_NONE } else { DROPEFFECT_COPY } };
        self.push(Input::Dropped(self.at(point), files));
        Ok(())
    }
}
