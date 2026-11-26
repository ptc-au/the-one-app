//! What a client keeps: every answer a server gave to something that only reads, as a file in the client's home.
//! A view (an app, or the home screen) is shown what was kept at once and asked again behind it, so it opens as
//! fast with no server up as with one. An answer is kept as whoever asked it: the device's person, or who the
//! client says it acts as or for, so nobody is shown what was answered someone else.
//!
//! Something large isn't in an answer: the answer has a short-lived link to it in the bucket. The client fetches it
//! while the link lasts and keeps it, and sends what's large the same way, by a link a server hands it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use std::fs;
use std::io::Write;

use anyhow::{Context, Result, bail};
use futures_util::future::join_all;
use futures_util::stream::{self, StreamExt, TryStreamExt};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::sync::watch;

use crate::Client;

impl Client {
    /// Asks the server for `method`, which only reads, and keeps its answer. A list of files is answered once it's
    /// whole (`keep_whole`).
    pub async fn fresh(&self, method: &str, params: &Value) -> Result<Value> {
        let response = self.request(method, params.clone()).await?;
        if method == "resources/list" {
            return Ok(self.keep_whole(params, response).await);
        }
        self.keep(method, params, &response)?;
        Ok(response)
    }

    /// A list of files a server gave, as a page loads its files from it: each version's files (`ui://<app>/<code>/…`,
    /// which never change) are kept first, so a page and everything it loads are one version's, all here, as a CDN's
    /// hashed assets are, whatever the server keeps after. A server keeps only the last few versions' files, and one
    /// still moving to the latest may list a version whose files are gone: a list whose files couldn't all be kept
    /// isn't taken, and the one kept before it is answered, whose files all are, while Telemetry hears why. With none
    /// kept yet, as on a first start, it's answered at once and kept once it's whole, as its files are fetched anyway.
    /// It's boxed, as asking a server may ask for its list of tools again (`fresh`), which this is in.
    fn keep_whole(&self, params: &Value, listed: Value) -> futures_util::future::BoxFuture<'static, Value> {
        let Some(client) = self.me.upgrade() else { return Box::pin(async { listed }) };
        let kept = client.cached("resources/list", params);
        let runtime = self.runtime.clone();
        let keeping = {
            let (params, listed) = (params.clone(), listed.clone());
            async move {
                let files = listed["resources"].as_array().into_iter().flatten().filter_map(|resource| resource["uri"].as_str());
                // Each read as a page asks it, for whoever the list is for (`_meta.subject`), so it's what it finds.
                let reads = files.filter(|uri| uri.starts_with("ui://")).map(|uri| {
                    let mut read = params.clone();
                    read["uri"] = json!(uri);
                    read
                });
                let missing: Vec<Value> = reads.filter(|read| !client.cache_file("resources/read", read).exists()).collect();
                // What's in each file, by its SHA-256, where the server says: one kept from a version before is kept
                // for this one from that, not read again, as a CDN's content-addressed assets are.
                let hashes: HashMap<String, String> = listed["resources"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|resource| Some((resource["uri"].as_str()?.to_owned(), resource["_meta"]["sha256"].as_str()?.to_owned())))
                    .filter(|(_, hash)| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
                    .collect();
                let fetch = |read: Value| {
                    let client = client.clone();
                    let hash = read["uri"].as_str().and_then(|uri| hashes.get(uri)).cloned();
                    async move {
                        let uri = read["uri"].clone();
                        let kept = hash.as_deref().and_then(|hash| fs::read(client.home.join("cache").join("sha256").join(hash)).ok());
                        if let Some(content) = kept.and_then(|kept| serde_json::from_slice::<Value>(&kept).ok()) {
                            let mut content = content;
                            content["uri"] = uri;
                            return client.keep("resources/read", &read, &json!({"contents": [content]}));
                        }
                        let response = client.request("resources/read", read.clone()).await?;
                        if let Some(hash) = &hash {
                            let mut content = response["contents"][0].clone();
                            if let Some(content) = content.as_object_mut() {
                                content.remove("uri");
                            }
                            write(&client.home.join("cache").join("sha256").join(hash), content.to_string().as_bytes())?;
                        }
                        client.keep("resources/read", &read, &response)
                    }
                };
                let whole = stream::iter(missing).map(fetch).buffer_unordered(8).try_collect::<Vec<_>>().await;
                let whole = whole.and_then(|_| client.keep("resources/list", &params, &listed));
                if let Err(error) = &whole {
                    client.report(json!({"name": "one.client.cache", "error": format!("{error:#}")}));
                }
                whole.is_ok()
            }
        };
        Box::pin(async move {
            match kept {
                Some(kept) => if keeping.await { listed } else { kept },
                None => {
                    runtime.spawn(keeping);
                    listed
                }
            }
        })
    }

    /// Keeps `answer` as what `method` was last answered with. A tool's error isn't kept, as HTTP's `stale-if-error`
    /// has it: it says why it failed then, so a view opened later shows what was answered before it, and asks again,
    /// where it showed a day-old "couldn't be reached" as if it were now.
    /// An answer that says no device may keep it (`unkept`) isn't, and what was kept of it before goes.
    pub(crate) fn keep(&self, method: &str, params: &Value, response: &Value) -> Result<()> {
        if response["isError"] == true {
            return Ok(());
        }
        let file = self.cache_file(method, params);
        if unkept(response) {
            return match fs::remove_file(&file) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
                _ => Ok(()),
            };
        }
        write(&file, response.to_string().as_bytes())
    }

    /// What a server last answered `method` with.
    pub fn cached(&self, method: &str, params: &Value) -> Option<Value> {
        serde_json::from_slice(&fs::read(self.cache_file(method, params)).ok()?).ok()
    }

    fn cache_file(&self, method: &str, params: &Value) -> PathBuf {
        let key = json!([self.link().who, self.says, method, params]);
        self.home.join("cache").join(crate::hex(&Sha256::digest(key.to_string())))
    }

    /// Fetches each large file a tool answered with, by its link, and keeps it, unless it's kept already: a blob
    /// answered by link is never replaced. The answer then says where the client keeps the file, in the link's
    /// place: `/.file/<name>/<type>`, which is what a view asks this client for it by (`file`). The name is one
    /// that only what was given this answer knows.
    pub(crate) async fn keep_files(&self, result: &mut Value) -> Result<()> {
        let Some(parts) = result.get_mut("content").and_then(Value::as_array_mut) else { return Ok(()) };
        for part in parts.iter_mut().filter(|part| part["type"] == "resource_link") {
            let (Some(link), Some(blob)) = (part["uri"].as_str(), part["name"].as_str()) else { continue };
            let secret = self.key.to_bytes();
            let name = crate::hex(&Sha256::digest([secret.as_slice(), blob.as_bytes()].concat()));
            let file = self.home.join("files").join(&name);
            if !file.exists() {
                let web = crate::web()?;
                let fetched = async { web.get(link).send().await?.error_for_status()?.bytes().await };
                write(&file, &fetched.await.context("The file couldn't be fetched. Check this device is online.")?)?;
            }
            let kind = part["mimeType"].as_str().unwrap_or("application/octet-stream");
            part["uri"] = format!("/.file/{name}/{kind}").into();
        }
        Ok(())
    }

    /// A large file this client keeps, by what follows `/.file/` in where an answer said it is: what kind of file
    /// it is, and the file.
    pub fn file(&self, path: &str) -> Option<(String, Vec<u8>)> {
        let (name, kind) = path.split_once('/')?;
        let named = !name.is_empty() && name.bytes().all(|byte| byte.is_ascii_hexdigit());
        Some((kind.to_owned(), fs::read(self.home.join("files").join(name).as_path()).ok().filter(|_| named)?))
    }

    /// Sends a file that's too large to go in a call to where the network keeps it, for a tool of `app`: a
    /// server gives a short-lived link to send it by. Gives the name that tool takes for it. A send the store
    /// answers with a server error, or that never reaches it, is tried again with the same link, which lasts a
    /// minute, as AWS's SDKs try S3's (R2 answered 500 once on 25 Nov, and a network's installers weren't
    /// published); one that landed though its answer didn't is taken as sent, which the store says by refusing
    /// another (412, as it's only sent where nothing is yet).
    pub async fn upload(&self, app: &str, file: Vec<u8>) -> Result<String> {
        let response = self.request("tools/call", json!({"name": "upload", "arguments": {"app": app}})).await?;
        let text = response["content"][0]["text"].as_str().unwrap_or_default();
        if response["isError"] == true {
            bail!("{text}")
        }
        let to: Value = serde_json::from_str(text).context("the server didn't say where to send the file")?;
        let (Some(method), Some(url), Some(name)) = (to["method"].as_str(), to["url"].as_str(), to["upload"].as_str())
        else {
            bail!("the server didn't say where to send the file")
        };
        let (web, method) = (crate::web()?, reqwest::Method::from_bytes(method.as_bytes())?);
        let mut waits = [2, 4, 8].into_iter();
        let mut again = false;
        loop {
            let mut send = web.request(method.clone(), url).body(file.clone());
            for (header, value) in to["headers"].as_object().into_iter().flatten() {
                send = send.header(header, value.as_str().unwrap_or_default());
            }
            let sent = send.send().await;
            if let Some(wait) = waits.next().filter(|_| sent.as_ref().map_or(true, |sent| sent.status().is_server_error())) {
                tokio::time::sleep(std::time::Duration::from_secs(wait)).await;
                again = true;
                continue;
            }
            if !(again && sent.as_ref().is_ok_and(|sent| sent.status() == reqwest::StatusCode::PRECONDITION_FAILED)) {
                sent.and_then(reqwest::Response::error_for_status)
                    .context("The file couldn't be sent. Check this device is online, then try again.")?;
            }
            return Ok(name.to_owned());
        }
    }
}

/// Whether an answer says no device may keep it, as HTTP's `Cache-Control: no-store`: what an encrypted item holds
/// (an app's tool that says `no_store`).
fn unkept(response: &Value) -> bool {
    response["_meta"]["noStore"] == true
}

/// Writes a file whole, under a name no other write has, then gives it its name: another ask, or another program
/// of this client, may be reading it or keeping the same thing.
pub(crate) fn write(file: &Path, bytes: &[u8]) -> Result<()> {
    let folder = file.parent().context("what's kept is kept in a folder")?;
    fs::create_dir_all(folder)?;
    let mut writing = tempfile::NamedTempFile::new_in(folder)?;
    writing.write_all(bytes)?;
    // Named by std's rename, not tempfile's `persist`: on Windows, MoveFileEx alone is refused (Access is denied)
    // where another ask has the file open to read it, and std's rename then replaces it as POSIX's does.
    let written = writing.into_temp_path().keep()?;
    fs::rename(&written, file).inspect_err(|_| drop(fs::remove_file(&written)))?;
    Ok(())
}

/// One cached read in a `Subscription`, as stale-while-revalidate has it (SWR, TanStack Query, Apollo): the view is
/// always answered `response` at once, and a write, or a server saying something changed, asks again behind it
/// (`fetching`), telling the view when the answer comes back different.
struct Query {
    method: String,
    params: Value,
    /// The last answer the view was given.
    response: Value,
    /// How many times it was asked again after a write: an answer asked before the latest isn't shown over it.
    invalidated: u64,
    /// The generation `response` was fetched at.
    fetched: u64,
    /// The refetch a write started, which a refresh joins rather than asking again.
    fetching: Option<(u64, watch::Receiver<bool>)>,
    /// When a server last answered it.
    answered: Option<Instant>,
    /// How many times the view had been told something changed when it last read it (`Subscription::told`).
    read: u64,
}

/// How long a server's answer is taken as fresh when the view asks it again, as TanStack Query's `staleTime`: a view
/// asks everything again whenever one answer changes, and each of those asked the server again, whose answers changed
/// others, in waves ~200 ms apart until they settled (25 Nov, Settings: 177 `settings_updates` in half an hour). What
/// is known to have changed, by a write or a server's notice (`invalidate`, `refresh`), is asked again whatever this.
const FRESH: Duration = Duration::from_secs(2);

/// What one view has been answered since it opened. It asks through this, and every view gets the same, with
/// nothing to write: what only reads is answered at once from what was kept and asked again behind it, as
/// stale-while-revalidate is, so a view opens as fast while its servers restart as with them up; a write resolves as
/// soon as its own answer arrives and has the tools the view was answered asked again in the background; and reads
/// are also asked again when the user returns to the view or a server says something changed. When an answer comes
/// back different, the view is told to ask again, and is answered at once.
pub struct Subscription {
    client: Arc<Client>,
    /// What only reads, by what was asked, with the answer the view was last given and when it was asked again.
    responses: Mutex<HashMap<String, Query>>,
    /// Tells the view that what it was answered has changed.
    changed: Box<dyn Fn() + Send + Sync>,
    /// How many times the view has been told something changed: a view told reads again what it shows, so what it
    /// didn't read since is no longer shown, and isn't asked again (`refresh`).
    told: AtomicU64,
    /// What it asked with nothing kept, while a server's answer is awaited, by what was asked: the same asked again
    /// meanwhile waits for that answer, as TanStack Query shares a query in flight, where each was asked again (on 25
    /// Nov Settings asked one that took 7 s nine times over as its other answers came in).
    asking: Mutex<HashMap<String, watch::Receiver<Option<Result<Value, String>>>>>,
}

impl Subscription {
    pub fn new(client: Arc<Client>, changed: impl Fn() + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self { client, responses: Mutex::default(), changed: Box::new(changed), told: AtomicU64::new(0), asking: Mutex::default() })
    }

    /// Answers what the view asks: the result of `method`. A write resolves as soon as its own answer arrives.
    pub async fn request(self: &Arc<Self>, method: &str, params: Value) -> Result<Value> {
        if self.reads(method, &params).await {
            return self.read(method, params).await;
        }
        let response = self.client.request(method, params.clone()).await?;
        if changes_tools(method, &params) {
            self.client.refresh_listed();
        }
        self.invalidate();
        Ok(response)
    }

    /// Asks again, in the background, for each tool the view was answered, as a write may have changed what they
    /// answer (TanStack Query's `invalidateQueries`). An app's files aren't asked again for a tool's write: what
    /// changes them, an install or a deploy, says so (`notifications/one/changed`).
    fn invalidate(self: &Arc<Self>) {
        let mut spawned = Vec::new();
        {
            let mut responses = self.responses.lock().expect("no view panics");
            for (key, query) in responses.iter_mut().filter(|(_, query)| query.method == "tools/call") {
                query.invalidated += 1;
                let generation = query.invalidated;
                let (tx, rx) = watch::channel(false);
                query.fetching = Some((generation, rx));
                spawned.push((key.clone(), query.method.clone(), query.params.clone(), generation, tx));
            }
        }
        for (key, method, params, generation, tx) in spawned {
            let shown = self.clone();
            tokio::spawn(async move { shown.fetch(key, method, params, generation, Some(tx)).await });
        }
    }

    /// Asks the server again for everything the view still reads, or with `app`, the tools of that app, which is
    /// all a server says changed when it's one's call that did (`notifications/one/changed`), and tells the view as
    /// each answer changes. What the view hasn't read since it was last told something changed is no longer shown,
    /// as a screen it went on from, and is forgotten rather than asked again: read again, what was kept is shown at
    /// once and asked again behind it.
    pub async fn refresh(&self, app: Option<&str>) {
        let prefix = app.map(|app| format!("{app}_"));
        let mut asks = Vec::new();
        let mut waiting = Vec::new();
        let dropped;
        {
            let mut responses = self.responses.lock().expect("no view panics");
            let told = self.told.load(Ordering::Relaxed);
            let before = responses.len();
            responses.retain(|_, query| query.read >= told);
            dropped = before != responses.len();
            for (key, query) in responses.iter() {
                if !matches_app(&query.method, &query.params, prefix.as_deref()) {
                    continue;
                }
                // A write's refetch is already on its way to the server; join it rather than sending a duplicate
                // RPC when `notifications/one/changed` arrives for the same write.
                match &query.fetching {
                    Some((_, rx)) => waiting.push(rx.clone()),
                    None => asks.push((key.clone(), query.method.clone(), query.params.clone(), query.invalidated)),
                }
            }
        }
        let fetches = asks.into_iter().map(|(key, method, params, generation)| async move {
            self.fetch(key, method, params, generation, None).await;
        });
        let joins = waiting.into_iter().map(|mut rx| async move {
            let _ = rx.wait_for(|done| *done).await;
        });
        tokio::join!(join_all(fetches), join_all(joins));
        // What it reads that was forgotten as it raced the view reading it after it was told comes back as it's read
        // again, and what it no longer reads stays forgotten.
        if dropped {
            self.told.fetch_add(1, Ordering::Relaxed);
            (self.changed)();
        }
    }

    /// What the view was last answered, at once, or what was kept, asked again behind it; only what was never
    /// answered waits for a server.
    async fn read(self: &Arc<Self>, method: &str, params: Value) -> Result<Value> {
        let key = json!([method, params]).to_string();
        // What a write had asked again is waited for: what was kept from before it would undo what the view just did,
        // as a switch it turned on showing off again until the refetch came back (26 Nov, Virtual Office's door).
        let written = self.responses.lock().expect("no view panics").get(&key).and_then(|query| {
            query.fetching.as_ref().filter(|_| query.fetched < query.invalidated).map(|(_, rx)| rx.clone())
        });
        if let Some(mut written) = written {
            let _ = written.wait_for(|done| *done).await;
        }
        // What the view was answered is shown again at once, and asked again behind it unless it's being asked or was
        // just answered (`FRESH`): a view outlives its window, so one opened again, or a phone's back from behind
        // another app, would show forever what it was answered before (21 Nov: Sign In & Security reopened without the
        // passkey just made).
        if let Some(query) = self.responses.lock().expect("no view panics").get_mut(&key) {
            query.read = self.told.load(Ordering::Relaxed);
            if query.fetching.is_none() && query.answered.is_none_or(|at| at.elapsed() > FRESH) {
                let (tx, rx) = watch::channel(false);
                query.fetching = Some((query.invalidated, rx));
                let (shown, key, method, params, generation) = (self.clone(), key.clone(), method.to_owned(), params.clone(), query.invalidated);
                tokio::spawn(async move { shown.fetch(key, method, params, generation, Some(tx)).await });
            }
            return Ok(query.response.clone());
        }
        let (response, revalidate) = match self.client.cached(method, &params) {
            Some(cached) => (cached, true),
            None => (self.first(&key, method, &params).await?, false),
        };
        // What no device may keep isn't kept for the view either: it's asked for each time.
        if unkept(&response) {
            return Ok(response);
        }
        let mut responses = self.responses.lock().expect("no view panics");
        // Another read of the same may have been answered meanwhile, and asked again behind it.
        if let Some(query) = responses.get(&key) {
            return Ok(query.response.clone());
        }
        responses.insert(key.clone(), Query {
            method: method.to_owned(),
            params: params.clone(),
            response: response.clone(),
            invalidated: 0,
            fetched: 0,
            fetching: None,
            answered: (!revalidate).then(Instant::now),
            read: self.told.load(Ordering::Relaxed),
        });
        drop(responses);
        if revalidate {
            let shown = self.clone();
            let method = method.to_owned();
            tokio::spawn(async move { shown.fetch(key, method, params, 0, None).await });
        }
        Ok(response)
    }

    /// What a server answers to what had nothing kept, asked once however often it's asked while that's awaited.
    async fn first(&self, key: &str, method: &str, params: &Value) -> Result<Value> {
        let asker = {
            let mut asking = self.asking.lock().expect("no view panics");
            match asking.get(key).filter(|waiting| waiting.has_changed().is_ok()) {
                Some(waiting) => Err(waiting.clone()),
                None => {
                    let (tx, rx) = watch::channel(None);
                    asking.insert(key.to_owned(), rx);
                    Ok(tx)
                }
            }
        };
        match asker {
            Ok(tx) => {
                // Said in the app's log, as a read a window waits on: one a server holds, as it starts, holds the window.
                eprintln!("{} had nothing kept, so it waits for a server", asked(method, params));
                let fresh = self.client.fresh(method, params).await;
                self.asking.lock().expect("no view panics").remove(key);
                let _ = tx.send(Some(fresh.as_ref().map(Value::clone).map_err(|error| format!("{error:#}"))));
                fresh
            }
            Err(mut waiting) => {
                let answer = waiting.wait_for(Option::is_some).await.map(|answer| answer.clone().expect("it waited for one"));
                match answer {
                    Ok(answer) => answer.map_err(anyhow::Error::msg),
                    // Whoever asked first stopped waiting before it was answered: this asks itself.
                    Err(_) => self.client.fresh(method, params).await,
                }
            }
        }
    }

    async fn fetch(
        &self,
        key: String,
        method: String,
        params: Value,
        generation: u64,
        done: Option<watch::Sender<bool>>,
    ) {
        let fresh = self.client.fresh(&method, &params).await;
        let mut notify = false;
        {
            let mut responses = self.responses.lock().expect("no view panics");
            if let Some(query) = responses.get_mut(&key) {
                if query.fetching.as_ref().is_some_and(|(at, _)| *at == generation) {
                    query.fetching = None;
                }
                // With no server answering, what was kept stays what's shown. Ignore any out-of-order response
                // started before a newer invalidation or fetch.
                if let Ok(fresh) = &fresh
                    && unkept(fresh)
                {
                    // Kept before its tool said not to: the view asks again, and is answered by a server.
                    responses.remove(&key);
                    notify = true;
                } else if let Ok(fresh) = fresh
                    && generation >= query.invalidated
                    && generation >= query.fetched
                {
                    query.fetched = generation;
                    query.answered = Some(Instant::now());
                    if query.response != fresh {
                        query.response = fresh;
                        notify = true;
                    }
                }
            }
        }
        if let Some(tx) = done {
            let _ = tx.send(true);
        }
        if notify {
            self.told.fetch_add(1, Ordering::Relaxed);
            (self.changed)();
        }
    }

    /// Whether asking `method` only reads. A tool does when the server's list of tools says so.
    async fn reads(&self, method: &str, params: &Value) -> bool {
        match method {
            method if crate::resolve::READS.contains(&method) => true,
            "tools/call" => match self.client.reads(&json!({"method": method, "params": params})).await {
                Ok(reads) => reads,
                // Asked as a write, which waits for a server, as the app's log says.
                Err(error) => {
                    eprintln!("{} is asked as a write, since this client can't say whether it only reads: {error:#}", asked(method, params));
                    false
                }
            },
            _ => false,
        }
    }
}

/// What was asked, as the app's log says it: `tools/call settings_badge`, `resources/list`.
fn asked(method: &str, params: &Value) -> String {
    params["name"].as_str().map_or_else(|| method.to_owned(), |tool| format!("{method} {tool}"))
}

fn matches_app(method: &str, params: &Value, prefix: Option<&str>) -> bool {
    prefix.is_none_or(|prefix| method == "tools/call" && params["name"].as_str().is_some_and(|name| name.starts_with(prefix)))
}

/// Whether a write call may change the server's `tools/list`: One Core's own tools (no `_`) or `apps_*`.
fn changes_tools(method: &str, params: &Value) -> bool {
    method == "tools/call"
        && params["name"]
            .as_str()
            .is_some_and(|name| !name.contains('_') || name.starts_with("apps_"))
}

