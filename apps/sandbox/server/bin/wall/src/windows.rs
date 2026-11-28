use std::ffi::{OsStr, OsString, c_void};
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;
use std::{env, fs, mem, ptr};

use windows_sys::Win32::Foundation::{
    CloseHandle, ERROR_ALREADY_EXISTS, ERROR_SUCCESS, HANDLE, HANDLE_FLAG_INHERIT, LocalFree,
    SetHandleInformation,
};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSidToSidW, EXPLICIT_ACCESS_W, GRANT_ACCESS, GetNamedSecurityInfoW, REVOKE_ACCESS,
    SE_FILE_OBJECT, SET_ACCESS,
    SetEntriesInAclW, SetNamedSecurityInfoW, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN, TRUSTEE_W,
};
use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeriveAppContainerSidFromAppContainerName, GetAppContainerFolderPath,
};
use windows_sys::Win32::Security::{
    ACCESS_ALLOWED_ACE, ACL, DACL_SECURITY_INFORMATION, DeriveCapabilitySidsFromName, EqualSid, GetAce,
    GetTokenInformation, NO_INHERITANCE, PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID,
    SECURITY_CAPABILITIES, SID_AND_ATTRIBUTES, SUB_CONTAINERS_AND_OBJECTS_INHERIT, TOKEN_QUERY, TOKEN_USER, TokenUser,
};
use windows_sys::Win32::Storage::FileSystem::{FILE_ALL_ACCESS, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ};
use windows_sys::Win32::System::Console::{GetStdHandle, STD_ERROR_HANDLE, STD_INPUT_HANDLE, STD_OUTPUT_HANDLE};
use windows_sys::Win32::System::JobObjects::{
    CreateJobObjectW, JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION, JOB_OBJECT_LIMIT_JOB_MEMORY,
    JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
    SetInformationJobObject,
};
use windows_sys::Win32::System::SystemInformation::GetWindowsDirectoryW;
use windows_sys::Win32::System::SystemServices::SE_GROUP_ENABLED;
use windows_sys::Win32::System::Threading::{
    CREATE_NO_WINDOW, CREATE_UNICODE_ENVIRONMENT, CreateMutexW, CreateProcessW, EXTENDED_STARTUPINFO_PRESENT, GetCurrentProcess,
    GetExitCodeProcess, INFINITE, InitializeProcThreadAttributeList, LPPROC_THREAD_ATTRIBUTE_LIST, OpenProcessToken,
    PROC_THREAD_ATTRIBUTE_HANDLE_LIST, PROC_THREAD_ATTRIBUTE_JOB_LIST, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
    OpenProcess, PROCESS_INFORMATION, PROCESS_SYNCHRONIZE, ReleaseMutex, STARTF_USESTDHANDLES, STARTUPINFOEXW, STARTUPINFOW, UpdateProcThreadAttribute, WaitForSingleObject,
};

/// The AppContainer every program behind the wall runs in.
const CONTAINER: &str = "app.theone.sandbox";

/// What this program is started with, by itself, to take back a run's grants once the run's wall ends, however it ends.
const REVOKE: &str = "--revoke";

/// What this program is started with, by itself and inside the AppContainer, to try a port of this machine's own
/// (`isolated`).
const CONNECT: &str = "--connect";

pub fn main() -> i32 {
    let first = env::args_os().nth(1);
    let mode = |name: &str| first.as_ref().is_some_and(|arg| arg == name);
    match if mode(REVOKE) {
        revoked()
    } else if mode(CONNECT) {
        connected()
    } else {
        walled()
    } {
        Ok(code) => code as i32,
        Err(why) => {
            eprintln!("The wall didn't start it: {why}");
            125
        }
    }
}

type Result<T> = std::result::Result<T, String>;

struct Asked {
    read: Vec<PathBuf>,
    write: Vec<PathBuf>,
    env: Vec<(OsString, OsString)>,
    memory: Option<usize>,
    /// Only whether the AppContainer reaches nothing of this machine's own, and no program.
    check: bool,
    program: Vec<OsString>,
}

fn asked() -> Result<Asked> {
    let mut asked = Asked { read: vec![], write: vec![], env: vec![], memory: None, check: false, program: vec![] };
    let mut args = env::args_os().skip(1);
    while let Some(arg) = args.next() {
        let mut value = || args.next().ok_or(format!("{} needs a value", arg.display()));
        match arg.to_str() {
            // Windows' security functions take a path as Windows writes it, which Erlang doesn't.
            Some("--read") => asked.read.push(value()?.to_string_lossy().replace('/', "\\").into()),
            Some("--write") => asked.write.push(value()?.to_string_lossy().replace('/', "\\").into()),
            Some("--memory") => asked.memory = Some(value()?.to_str().and_then(|n| n.parse().ok()).ok_or("--memory is bytes")?),
            Some("--env") => {
                let said = value()?;
                let (name, value) = said.to_str().and_then(|said| said.split_once('=')).ok_or("--env is NAME=value")?;
                asked.env.push((name.into(), value.into()));
            }
            Some("--check") => asked.check = true,
            Some("--") => asked.program = args.by_ref().collect(),
            _ => return Err(format!("{} isn't something the wall takes", arg.display())),
        }
    }
    if asked.program.is_empty() && !asked.check {
        return Err("it's given no program, after --".into());
    }
    Ok(asked)
}

fn wide(text: impl AsRef<OsStr>) -> Vec<u16> {
    text.as_ref().encode_wide().chain([0]).collect()
}

fn failed(what: &str) -> String {
    format!("{what}: {}", std::io::Error::last_os_error())
}

fn walled() -> Result<u32> {
    let mut asked = asked()?;
    // Read by the program that tries a port (`isolated`), as it's started from this one.
    asked.read.push(env::current_exe().map_err(|error| format!("this program's own path: {error}"))?);
    unsafe {
        let container = container()?;
        // This run's own capability: its folder is granted to it alone.
        // Random, as the standard library's hashers are keyed from the system's random source.
        let random = std::hash::BuildHasher::hash_one(&std::hash::RandomState::new(), std::process::id());
        let run = format!("one-sandbox-{random:016x}");
        let capability = capability(&run)?;

        // What it's granted is the run's capability's alone, and taken back by a program of its own once this ends, as
        // a server stops a wall by killing it, which leaves it no chance to.
        revoker(&asked, &run)?;
        for (paths, access) in [(&asked.read, FILE_GENERIC_READ | FILE_GENERIC_EXECUTE), (&asked.write, FILE_ALL_ACCESS)] {
            for path in paths {
                grant(path, capability, access)?;
            }
        }

        // Its folder, in the AppContainer's own, with only the person and this run's capability on it.
        let folder = folder_of(container)?.join(&run);
        fs::create_dir(&folder).map_err(|error| format!("its folder: {error}"))?;
        let walled = (|| {
            own(&folder, capability)?;
            isolated(container, capability, &folder)?;
            if asked.check { Ok(0) } else { started(&asked, container, capability, &folder) }
        })();
        let _ = fs::remove_dir_all(&folder);
        walled
    }
}

/// `wall --revoke <the wall's process id> <its run> <path>...`: waits for that wall to end, then takes back what the run
/// was granted on each path, and removes its folder, which the wall itself does when it ends on its own.
fn revoked() -> Result<u32> {
    let mut args = env::args_os().skip(2);
    let pid: u32 = args.next().and_then(|arg| arg.to_str()?.parse().ok()).ok_or("--revoke needs a process id")?;
    let run = args.next().and_then(|arg| arg.into_string().ok()).ok_or("--revoke needs a run")?;
    unsafe {
        let wall = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
        if !wall.is_null() {
            WaitForSingleObject(wall, INFINITE);
            CloseHandle(wall);
        }
        let _ = fs::remove_dir_all(folder_of(container()?)?.join(&run));
        let capability = capability(&run)?;
        for path in args {
            revoke(Path::new(&path), capability)?;
        }
    }
    Ok(0)
}

/// Starts this program again to wait for this wall and take back what `run` is granted on the paths it's asked for,
/// as no process of the wall's own: no window, no handle of this one's, nor the job its program's in.
unsafe fn revoker(asked: &Asked, run: &str) -> Result<()> {
    let me = env::current_exe().map_err(|error| format!("this program's own path: {error}"))?;
    let mut program: Vec<OsString> = vec![me.clone().into(), REVOKE.into(), std::process::id().to_string().into(), run.into()];
    program.extend(asked.read.iter().chain(&asked.write).map(OsString::from));
    let mut line = command_line(&program);
    let (startup, mut process): (STARTUPINFOW, PROCESS_INFORMATION) = unsafe { (mem::zeroed(), mem::zeroed()) };
    let started = unsafe {
        CreateProcessW(wide(&me).as_ptr(), line.as_mut_ptr(), ptr::null(), ptr::null(), 0, CREATE_NO_WINDOW, ptr::null(), ptr::null(), &startup, &mut process)
    };
    if started == 0 {
        return Err(failed("what takes back its access"));
    }
    unsafe {
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
    }
    Ok(())
}

/// Tries one of this machine's own ports from inside the AppContainer, which must be refused. Windows keeps an
/// AppContainer from them (loopback, and the machine's own addresses too) by its firewall's isolation, which a setting
/// ends for one AppContainer (a loopback exemption, `CheckNetIsolation`) or for every one (Group Policy, the firewall
/// not running), and then the program reaches everything that listens here. Nothing in the AppContainer's own token
/// stops it, so this finds out, each time, that it can't: a port this program listens on, which a copy of it started in
/// the AppContainer tries. A connection that's let through is waiting to be accepted, and one that's refused is
/// dropped by Windows, so the copy gives it a moment.
unsafe fn isolated(container: PSID, capability: PSID, folder: &Path) -> Result<()> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|error| format!("a port to try: {error}"))?;
    listener.set_nonblocking(true).map_err(|error| format!("a port to try: {error}"))?;
    let port = listener.local_addr().map_err(|error| format!("a port to try: {error}"))?.port();
    let me = env::current_exe().map_err(|error| format!("this program's own path: {error}"))?;
    let program = vec![me.into(), CONNECT.into(), port.to_string().into()];
    let tried = Asked { read: vec![], write: vec![], env: vec![], memory: None, check: false, program };
    unsafe { started(&tried, container, capability, folder)? };
    if listener.accept().is_ok() {
        return Err("Windows lets its AppContainer reach this machine's own ports (a loopback exemption, or its firewall's isolation of apps is off), and a program behind the wall would reach whatever listens here".into());
    }
    Ok(())
}

/// `wall --connect <port>`, inside the AppContainer: tries that port of this machine's own, and ends.
fn connected() -> Result<u32> {
    let port: u16 = env::args_os().nth(2).and_then(|arg| arg.to_str()?.parse().ok()).ok_or("--connect needs a port")?;
    let _ = TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(300));
    Ok(0)
}

/// The AppContainer's SID, which it's made with the first time.
unsafe fn container() -> Result<PSID> {
    let name = wide(CONTAINER);
    let mut sid: PSID = ptr::null_mut();
    let made = unsafe {
        CreateAppContainerProfile(
            name.as_ptr(),
            wide("the One App's sandbox").as_ptr(),
            wide("Untrusted apps, behind the One App's wall").as_ptr(),
            ptr::null(),
            0,
            &mut sid,
        )
    };
    if made == (0x8007_0000u32 | ERROR_ALREADY_EXISTS) as i32 {
        let derived = unsafe { DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut sid) };
        if derived != 0 {
            return Err(format!("the AppContainer's SID: {derived:#x}"));
        }
    } else if made != 0 {
        return Err(format!("the AppContainer: {made:#x}"));
    }
    Ok(sid)
}

unsafe fn capability(name: &str) -> Result<PSID> {
    let (mut groups, mut group_count, mut capabilities, mut count) = (ptr::null_mut(), 0, ptr::null_mut(), 0);
    let derived = unsafe {
        DeriveCapabilitySidsFromName(wide(name).as_ptr(), &mut groups, &mut group_count, &mut capabilities, &mut count)
    };
    if derived == 0 || count == 0 {
        return Err(failed("its capability"));
    }
    Ok(unsafe { *capabilities })
}

unsafe fn folder_of(container: PSID) -> Result<PathBuf> {
    let mut text = ptr::null_mut();
    if unsafe { ConvertSidToStringSidW(container, &mut text) } == 0 {
        return Err(failed("the AppContainer's SID as text"));
    }
    let mut path = ptr::null_mut();
    let found = unsafe { GetAppContainerFolderPath(text, &mut path) };
    unsafe { LocalFree(text as _) };
    if found != 0 {
        return Err(format!("the AppContainer's folder: {found:#x}"));
    }
    let folder = unsafe { OsString::from_wide(std::slice::from_raw_parts(path, (0..).take_while(|&i| *path.add(i) != 0).count())) };
    Ok(folder.into())
}

/// The folder the AppContainer's own is in, three folders down (`<it>\Packages\<name>\AC`), which is what Windows
/// makes `LOCALAPPDATA` out of for a program in an AppContainer: it's the value it needs there, and the one it gives
/// the program is the AppContainer's own folder, not the person's.
unsafe fn local_app_data(container: PSID) -> Result<PathBuf> {
    let own = unsafe { folder_of(container)? };
    own.ancestors().nth(3).map(Path::to_path_buf).ok_or_else(|| format!("{} isn't in a Packages folder", own.display()))
}

fn trustee(sid: PSID) -> TRUSTEE_W {
    TRUSTEE_W {
        pMultipleTrustee: ptr::null_mut(),
        MultipleTrusteeOperation: 0,
        TrusteeForm: TRUSTEE_IS_SID,
        TrusteeType: TRUSTEE_IS_UNKNOWN,
        ptstrName: sid as _,
    }
}

/// Runs `change` on `path`'s access list and writes the result back, to everything in the folder too, which takes a
/// while. One program at a time does this, as each reads the list and writes it back whole.
unsafe fn edit(path: &Path, change: impl FnOnce(*mut ACL) -> Result<Option<*mut ACL>>) -> Result<()> {
    let lock = unsafe { CreateMutexW(ptr::null(), 0, wide("Local\\app.theone.sandbox.access").as_ptr()) };
    if lock.is_null() {
        return Err(failed("the lock on access lists"));
    }
    unsafe { WaitForSingleObject(lock, INFINITE) };
    let name = wide(path);
    let (mut dacl, mut descriptor): (*mut ACL, PSECURITY_DESCRIPTOR) = (ptr::null_mut(), ptr::null_mut());
    let read = unsafe {
        GetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            &mut dacl,
            ptr::null_mut(),
            &mut descriptor,
        )
    };
    let done = if read != ERROR_SUCCESS {
        Err(format!("{} can't be read for its access: {}", path.display(), std::io::Error::from_raw_os_error(read as i32)))
    } else {
        change(dacl).and_then(|new| match new {
            None => Ok(()),
            Some(new) => {
                let set = unsafe {
                    SetNamedSecurityInfoW(name.as_ptr() as _, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, ptr::null_mut(), ptr::null_mut(), new, ptr::null())
                };
                unsafe { LocalFree(new as _) };
                if set == ERROR_SUCCESS {
                    Ok(())
                } else {
                    Err(format!("{} couldn't be changed for its access: {}", path.display(), std::io::Error::from_raw_os_error(set as i32)))
                }
            }
        })
    };
    unsafe {
        LocalFree(descriptor);
        ReleaseMutex(lock);
        CloseHandle(lock);
    }
    done
}

/// Whether `dacl` lets `sid` have all of `access` (none: any), by an entry of its own.
unsafe fn lets(dacl: *mut ACL, sid: PSID, access: u32) -> bool {
    !dacl.is_null()
        && (0..unsafe { (*dacl).AceCount } as u32).any(|index| {
            let mut ace: *mut c_void = ptr::null_mut();
            unsafe {
                GetAce(dacl, index, &mut ace) != 0
                    && (*(ace as *const ACCESS_ALLOWED_ACE)).Header.AceType == 0
                    && (*(ace as *const ACCESS_ALLOWED_ACE)).Mask & access == access
                    && EqualSid(&raw const (*(ace as *const ACCESS_ALLOWED_ACE)).SidStart as PSID, sid) != 0
            }
        })
}

/// Grants `sid` `access` to `path`, and what's in it: not where every app has it already, as Windows' own folders
/// are (`ALL APPLICATION PACKAGES`), whose access lists the wall never writes to.
unsafe fn grant(path: &Path, sid: PSID, access: u32) -> Result<()> {
    let mut everyone: PSID = ptr::null_mut();
    if unsafe { ConvertStringSidToSidW(wide("S-1-15-2-1").as_ptr(), &mut everyone) } == 0 {
        return Err(failed("the SID of every app"));
    }
    let done = unsafe {
        edit(path, |dacl| {
            if lets(dacl, everyone, access) {
                return Ok(None);
            }
            let entry = EXPLICIT_ACCESS_W {
                grfAccessPermissions: access,
                grfAccessMode: GRANT_ACCESS,
                grfInheritance: if path.is_dir() { SUB_CONTAINERS_AND_OBJECTS_INHERIT } else { NO_INHERITANCE },
                Trustee: trustee(sid),
            };
            let mut new: *mut ACL = ptr::null_mut();
            let made = SetEntriesInAclW(1, &entry, dacl, &mut new);
            if made != ERROR_SUCCESS {
                return Err(format!("{}'s access: {}", path.display(), std::io::Error::from_raw_os_error(made as i32)));
            }
            Ok(Some(new))
        })
    };
    unsafe { LocalFree(everyone) };
    done
}

/// Takes back what `grant` gave `sid` on `path`, and on what's in it, where it did.
unsafe fn revoke(path: &Path, sid: PSID) -> Result<()> {
    unsafe {
        edit(path, |dacl| {
            if !lets(dacl, sid, 0) {
                return Ok(None);
            }
            let entry = EXPLICIT_ACCESS_W { grfAccessPermissions: 0, grfAccessMode: REVOKE_ACCESS, grfInheritance: NO_INHERITANCE, Trustee: trustee(sid) };
            let mut new: *mut ACL = ptr::null_mut();
            let made = SetEntriesInAclW(1, &entry, dacl, &mut new);
            if made != ERROR_SUCCESS {
                return Err(format!("{}'s access: {}", path.display(), std::io::Error::from_raw_os_error(made as i32)));
            }
            Ok(Some(new))
        })
    }
}

/// Makes `folder` the person's and this run's capability's alone, with nothing of its parent's.
unsafe fn own(folder: &Path, capability: PSID) -> Result<()> {
    let mut token: HANDLE = ptr::null_mut();
    if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) } == 0 {
        return Err(failed("this program's token"));
    }
    let mut user = [0u8; 256];
    let mut size = 0;
    let got = unsafe { GetTokenInformation(token, TokenUser, user.as_mut_ptr() as _, user.len() as u32, &mut size) };
    unsafe { CloseHandle(token) };
    if got == 0 {
        return Err(failed("who runs this"));
    }
    let person = unsafe { (*(user.as_ptr() as *const TOKEN_USER)).User.Sid };
    let entries = [person, capability].map(|sid| EXPLICIT_ACCESS_W {
        grfAccessPermissions: FILE_ALL_ACCESS,
        grfAccessMode: SET_ACCESS,
        grfInheritance: SUB_CONTAINERS_AND_OBJECTS_INHERIT,
        Trustee: trustee(sid),
    });
    let mut acl: *mut ACL = ptr::null_mut();
    let made = unsafe { SetEntriesInAclW(entries.len() as u32, entries.as_ptr(), ptr::null(), &mut acl) };
    if made != ERROR_SUCCESS {
        return Err(format!("its folder's access: {}", std::io::Error::from_raw_os_error(made as i32)));
    }
    let set = unsafe {
        SetNamedSecurityInfoW(
            wide(folder).as_ptr() as _,
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            ptr::null_mut(),
            ptr::null_mut(),
            acl,
            ptr::null(),
        )
    };
    unsafe { LocalFree(acl as _) };
    if set != ERROR_SUCCESS {
        return Err(format!("its folder's access: {}", std::io::Error::from_raw_os_error(set as i32)));
    }
    Ok(())
}

/// A program's command line, each argument quoted as Windows' C runtime reads it back (`CommandLineToArgvW`).
fn command_line(program: &[OsString]) -> Vec<u16> {
    let mut line: Vec<u16> = Vec::new();
    for (index, arg) in program.iter().enumerate() {
        if index > 0 {
            line.push(b' ' as u16);
        }
        let arg: Vec<u16> = arg.encode_wide().collect();
        let plain = !arg.is_empty() && !arg.iter().any(|&c| c == b' ' as u16 || c == b'\t' as u16 || c == b'"' as u16);
        if plain {
            line.extend(arg);
            continue;
        }
        line.push(b'"' as u16);
        let mut slashes = 0;
        for c in arg {
            if c == b'\\' as u16 {
                slashes += 1;
            } else {
                let doubled = if c == b'"' as u16 { slashes * 2 + 1 } else { slashes };
                line.extend(std::iter::repeat_n(b'\\' as u16, doubled));
                slashes = 0;
                line.push(c);
            }
        }
        line.extend(std::iter::repeat_n(b'\\' as u16, slashes * 2));
        line.push(b'"' as u16);
    }
    line.push(0);
    line
}

unsafe fn started(asked: &Asked, container: PSID, capability: PSID, folder: &Path) -> Result<u32> {
    // The job it's in: its memory limit, and its end once this ends, however that is.
    let job = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
    if job.is_null() {
        return Err(failed("its job object"));
    }
    let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { mem::zeroed() };
    limits.BasicLimitInformation.LimitFlags =
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_DIE_ON_UNHANDLED_EXCEPTION;
    if let Some(memory) = asked.memory {
        limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_JOB_MEMORY;
        limits.JobMemoryLimit = memory;
    }
    let limited = unsafe {
        SetInformationJobObject(job, JobObjectExtendedLimitInformation, &raw const limits as _, mem::size_of_val(&limits) as u32)
    };
    if limited == 0 {
        return Err(failed("its job object's limits"));
    }

    // What it inherits: this program's standard input, output and error, and nothing else.
    let mut handles: Vec<HANDLE> = Vec::new();
    for which in [STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE] {
        let handle = unsafe { GetStdHandle(which) };
        if !handle.is_null() && handle as isize != -1 && !handles.contains(&handle) {
            unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) };
            handles.push(handle);
        }
    }

    let mut capabilities = [SID_AND_ATTRIBUTES { Sid: capability, Attributes: SE_GROUP_ENABLED as u32 }];
    let security = SECURITY_CAPABILITIES {
        AppContainerSid: container,
        Capabilities: capabilities.as_mut_ptr(),
        CapabilityCount: 1,
        Reserved: 0,
    };
    let jobs = [job];
    let mut size = 0;
    unsafe { InitializeProcThreadAttributeList(ptr::null_mut(), 3, 0, &mut size) };
    let mut list = vec![0u8; size];
    let attributes = list.as_mut_ptr() as LPPROC_THREAD_ATTRIBUTE_LIST;
    let set = unsafe {
        InitializeProcThreadAttributeList(attributes, 3, 0, &mut size) != 0
            && UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES as usize, &raw const security as _, mem::size_of_val(&security), ptr::null_mut(), ptr::null()) != 0
            && UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST as usize, jobs.as_ptr() as _, mem::size_of_val(&jobs), ptr::null_mut(), ptr::null()) != 0
            && (handles.is_empty()
                || UpdateProcThreadAttribute(attributes, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST as usize, handles.as_ptr() as _, handles.len() * mem::size_of::<HANDLE>(), ptr::null_mut(), ptr::null()) != 0)
    };
    if !set {
        return Err(failed("how it's started"));
    }

    let mut startup: STARTUPINFOEXW = unsafe { mem::zeroed() };
    startup.StartupInfo.cb = mem::size_of::<STARTUPINFOEXW>() as u32;
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = unsafe { GetStdHandle(STD_INPUT_HANDLE) };
    startup.StartupInfo.hStdOutput = unsafe { GetStdHandle(STD_OUTPUT_HANDLE) };
    startup.StartupInfo.hStdError = unsafe { GetStdHandle(STD_ERROR_HANDLE) };
    startup.lpAttributeList = attributes;

    // Its environment: what it's given, Windows' folder, which Windows' own libraries need, and its own folder as
    // its profile. CreateProcess for an AppContainer refuses to start without `LOCALAPPDATA` (os error 203), and
    // makes `LOCALAPPDATA`, `TEMP` and `TMP` the AppContainer's own folders out of it, whatever else is given.
    let mut windows = [0u16; 260];
    let length = unsafe { GetWindowsDirectoryW(windows.as_mut_ptr(), windows.len() as u32) } as usize;
    let windows = OsString::from_wide(&windows[..length]);
    let mut environment: Vec<(OsString, OsString)> = asked.env.clone();
    environment.push(("SystemRoot".into(), windows.clone()));
    for name in ["TMPDIR", "USERPROFILE", "APPDATA"] {
        environment.push((name.into(), folder.into()));
    }
    environment.push(("LOCALAPPDATA".into(), unsafe { local_app_data(container)? }.into()));
    // Where its home is as Erlang's VM reads it (`HOMEDRIVE` and `HOMEPATH`, before `USERPROFILE`), and where its
    // programs are as Windows' own and Erlang's read it (`PATH`): Windows' folders, and no other.
    let home = folder.to_string_lossy();
    let (drive, path) = home.split_at(home.find(':').map_or(0, |colon| colon + 1));
    environment.push(("HOMEDRIVE".into(), drive.into()));
    environment.push(("HOMEPATH".into(), path.into()));
    environment.push(("PATH".into(), format!("{0}\\System32;{0}", windows.to_string_lossy()).into()));
    let mut block: Vec<u16> = Vec::new();
    for (name, value) in &environment {
        block.extend(name.encode_wide());
        block.push(b'=' as u16);
        block.extend(value.encode_wide());
        block.push(0);
    }
    block.push(0);

    let program = wide(&asked.program[0]);
    let mut line = command_line(&asked.program);
    let mut process: PROCESS_INFORMATION = unsafe { mem::zeroed() };
    let created = unsafe {
        CreateProcessW(
            program.as_ptr(),
            line.as_mut_ptr(),
            ptr::null(),
            ptr::null(),
            1,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
            block.as_ptr() as _,
            wide(folder).as_ptr(),
            &raw const startup.StartupInfo,
            &mut process,
        )
    };
    if created == 0 {
        return Err(failed(&format!("{}", asked.program[0].display())));
    }
    unsafe {
        CloseHandle(process.hThread);
        WaitForSingleObject(process.hProcess, INFINITE);
        let mut code = 0;
        GetExitCodeProcess(process.hProcess, &mut code);
        CloseHandle(process.hProcess);
        // Whatever it started goes with it.
        CloseHandle(job);
        Ok(code)
    }
}
