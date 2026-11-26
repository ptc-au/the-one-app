//! How a device gets into its network and stays there: the network's address, in its home's `network`, and the token
//! it shows there, in `token` beside it (`Network`, `NetworkConfig`), asking to be let in by a code
//! (`DeviceAuthorization`, RFC 8628), and renewing its token while it's in (`sessions`).

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI64, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use data_encoding::BASE64URL_NOPAD;
use iroh::{EndpointAddr, EndpointId, RelayUrl, SecretKey};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::time::sleep;

use crate::{Client, BUILD, device_info, hex, web, name, cache::write, rpc::NOBODY, state::{State, Connection}, transport::{CONNECT, Link, accept}};

/// A network's address, and the token this machine shows there: what says it's one of the network's own.
#[derive(Clone, Deserialize)]
pub struct Network {
    pub address: String,
    pub token: String,
}

impl Network {
    /// The headers of an ask of `path` at the address, with `body`: `key`'s signature of it, and the token. The pieces
    /// there check both (`core/edge/ask.ts`), and a server's Elixir signs the same bytes (`OneCore.Edge`).
    pub fn signed(&self, key: &SecretKey, path: &str, body: &str) -> Result<[(&'static str, String); 4]> {
        let at = (millis(SystemTime::now())? + SKEW.load(Ordering::Relaxed)).to_string();
        let signature = key.sign(format!("one/ask/1\n{path}\n{at}\n{body}").as_bytes());
        Ok([
            ("one-key", key.public().to_string()),
            ("one-at", at),
            ("one-signature", hex(&signature.to_bytes())),
            ("one-token", self.token.clone()),
        ])
    }

    /// What a run of the client on the device with the key `device` shows the relay here, which `attestation` is the
    /// device's word for: the device's token, the device's key and the attestation, joined by dots.
    pub(crate) fn shown(&self, device: &SecretKey, attestation: &str) -> Self {
        Self { address: self.address.clone(), token: format!("{}.{}.{attestation}", self.token, device.public()) }
    }

    /// The servers acting for `of`, a user's or a group's prefix, as the presigner at the address says: the ones on their
    /// list and then the ones acting for the network, which act for everyone. Each is its key, reached through the
    /// relay there until a straighter path is found.
    pub(crate) async fn servers(&self, key: &SecretKey, of: &str) -> Result<Vec<EndpointAddr>> {
        let url = format!("{}/presigner/servers", self.address.trim_end_matches('/'));
        let (status, response) =
            ask(self, key, "/presigner/servers", "", || Ok(web()?.get(&url).timeout(CONNECT).query(&[("of", of)]))).await?;
        if !status.is_success() {
            bail!("{}", response["error"].as_str().unwrap_or("the presigner refused"))
        }
        let relay: RelayUrl = self.address.parse().with_context(|| format!("{} isn't an address", self.address))?;
        let keys = response["servers"].as_array().context("the presigner listed no servers")?;
        keys.iter()
            .map(|key| {
                let key: EndpointId = key.as_str().unwrap_or_default().parse().context("that isn't a server's key")?;
                Ok(EndpointAddr::new(key).with_relay_url(relay.clone()))
            })
            .collect()
    }
}

/// What a client keeps of its network, in the file `network` of its home: the network's address, which whatever
/// set the client up put there, where a device asks there to be let in, once it has looked, and once the device is
/// someone's, whose it is and the build it was when it got that, which it said as it asked. Its token to the relay
/// there is kept in the file `token` beside it (`keep_token`), so that anyone reading `network` for an address
/// prints nothing secret.
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct NetworkConfig {
    pub(crate) address: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    authorization_server: Option<AuthorizationServer>,
    /// The token this device shows its network's relay, kept in the file `token` of its home (`token`, `keep_token`),
    /// never in `network`.
    #[serde(skip)]
    pub(crate) token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) who: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) build: Option<String>,
}

/// Where a device asks its network to be let in, as the network's metadata says: the authorization server that its
/// protected resource names (RFC 9728), and that server's device authorization endpoint and token endpoint (RFC
/// 8414, RFC 8628).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct AuthorizationServer {
    device_authorization_endpoint: String,
    token_endpoint: String,
}

impl AuthorizationServer {
    /// Looks for it at the network's address, `address`.
    async fn discovered(address: &str) -> Result<Self> {
        let web = web()?;
        let read = |url: String| {
            let web = web.clone();
            async move {
                anyhow::Ok(web.get(url).timeout(CONNECT * 3).send().await?.error_for_status()?.json::<Value>().await?)
            }
        };
        let resource = read(format!("{}/.well-known/oauth-protected-resource", address.trim_end_matches('/'))).await?;
        let issuer =
            resource["authorization_servers"][0].as_str().context("the network names no authorization server")?;
        let issuer: reqwest::Url = issuer.parse().with_context(|| format!("{issuer} isn't an address"))?;
        let at = format!(
            "{}/.well-known/oauth-authorization-server{}",
            issuer.origin().ascii_serialization(),
            issuer.path()
        );
        serde_json::from_value(read(at.trim_end_matches('/').to_owned()).await?)
            .context("the network's authorization server lets no device in by a code")
    }
}

/// A code a device that isn't in its network is let in by, as the network's authorization server gave it (RFC 8628),
/// which it asked for naming its key as its `client_id` and signing what it asked with it, so the code is only ever
/// for this key. A device's person sees the `link` and `code`, and nothing else of it is said anywhere.
#[derive(Clone, Serialize)]
pub struct DeviceAuthorization {
    /// Where its person lets it in: a page at the network's address, carrying the code.
    pub link: String,
    /// The code, as it's shown: WDJB-MJHT.
    pub code: String,
    /// Where it asks for its answer.
    #[serde(skip)]
    token_endpoint: String,
    #[serde(skip)]
    key: SecretKey,
    /// What the device asks for its answer with, which only it was given.
    #[serde(skip)]
    device_code: String,
    /// How long it waits between asks.
    #[serde(skip)]
    interval: Duration,
    /// When the code ends, as the authorization server said.
    #[serde(skip)]
    expires: Instant,
}

impl PartialEq for DeviceAuthorization {
    fn eq(&self, other: &Self) -> bool {
        self.device_code == other.device_code
    }
}

impl std::fmt::Debug for DeviceAuthorization {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeviceAuthorization").field("link", &self.link).field("code", &self.code).finish_non_exhaustive()
    }
}

impl DeviceAuthorization {
    /// Asks the network's authorization server for a code to let the device with `key` in by, under this
    /// machine's name, and the `command` that ran it if a terminal did, which the network lists it by.
    async fn request(server: &AuthorizationServer, key: &SecretKey, command: Option<&str>) -> Result<Self> {
        Self::requested(server, key, command, None).await
    }

    /// Asks the network at `address` for a code its owner adds the server whose key is `key` to the network's list
    /// by, with a passkey at its address, under this machine's name (the scope `server`): what `add_server` does, for a
    /// network with no server on to ask (`apps/sign-in/edge/auth.ts`). Its owner sees the `link` and `code`, and
    /// `approved` waits for them.
    pub async fn server(address: &str, key: &SecretKey) -> Result<Self> {
        Self::requested(&AuthorizationServer::discovered(address).await?, key, None, Some("server")).await
    }

    /// Waits for the code's answer, as `wait_for_approval` does with nothing to tell it sooner.
    pub async fn approved(&self) -> Result<(), NotApproved> {
        self.wait_for_approval(&tokio::sync::Notify::new()).await
    }

    async fn requested(server: &AuthorizationServer, key: &SecretKey, command: Option<&str>, scope: Option<&str>) -> Result<Self> {
        let mut ask = vec![("client_id", key.public().to_string()), ("name", name())];
        ask.extend(command.map(|command| ("command", command.to_owned())));
        ask.extend(scope.map(|scope| ("scope", scope.to_owned())));
        let ask = serde_urlencoded::to_string(ask)?;
        let (given, response) = ask_edge(&server.device_authorization_endpoint, key, FORM, ask).await?;
        let (true, Some(link), Some(code), Some(device_code)) = (
            given,
            response["verification_uri_complete"].as_str(),
            response["user_code"].as_str(),
            response["device_code"].as_str(),
        ) else {
            bail!("{}", response["error_description"].as_str().unwrap_or("the network's edge gave this device no code"))
        };
        let halves: Vec<String> = code.as_bytes().chunks(4).map(|half| String::from_utf8_lossy(half).into()).collect();
        Ok(Self {
            link: link.to_owned(),
            code: halves.join("-"),
            token_endpoint: server.token_endpoint.clone(),
            key: key.clone(),
            device_code: device_code.to_owned(),
            interval: Duration::from_secs(response["interval"].as_u64().unwrap_or(5)),
            expires: Instant::now() + Duration::from_secs(response["expires_in"].as_u64().unwrap_or(30 * 60)),
        })
    }

    /// Waits for this device's person to answer, asking the network's authorization server as often as it allows,
    /// and at once when told it's approved (`Client::approved`), and again after an ask that wasn't answered, as a
    /// phone that's offline for a moment asks: `Ok` once they approved it, or why it isn't, if they stopped it or its
    /// code ended first.
    async fn wait_for_approval(&self, told: &tokio::sync::Notify) -> Result<(), NotApproved> {
        let mut interval = self.interval;
        loop {
            tokio::select! {
                _ = sleep(interval) => {}
                // Told it's approved (`Client::approved`).
                _ = told.notified() => {}
            }
            if Instant::now() > self.expires {
                return Err(NotApproved::Expired);
            }
            let ask = serde_urlencoded::to_string([
                ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                ("device_code", &self.device_code),
                ("client_id", &self.key.public().to_string()),
            ])
            .expect("a form of strings is one");
            let Ok((given, response)) = ask_edge(&self.token_endpoint, &self.key, FORM, ask).await else { continue };
            match response["error"].as_str() {
                _ if given => return Ok(()),
                Some("slow_down") => interval += Duration::from_secs(5),
                Some("access_denied") => return Err(NotApproved::Denied),
                // A code the network has forgotten has ended, as the sign-in page says of one (`unknown`): a code is forgotten once
                // an ask is answered with how it ended, so asking again, as after an answer that was lost, finds none. A device
                // that is told so asks whether it's in (`admit`), which says if it was approved, as it does for any end.
                Some("expired_token" | "invalid_grant") => return Err(NotApproved::Expired),
                // Still waiting, or an answer that isn't one, which is asked again.
                _ => {}
            }
        }
    }
}

/// Why a device isn't in its network now, where it says: its person stopped it where they signed in, its code ended
/// first, or it was in and was removed since. The app says it on the sign-in page it shows the next code on, told it
/// as `why`, in these same words (`apps/sign-in/edge/page`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NotApproved {
    Denied,
    Expired,
    Removed,
}

impl NotApproved {
    /// How the sign-in page is told it.
    pub fn why(self) -> &'static str {
        match self {
            Self::Denied => "denied",
            Self::Expired => "expired",
            Self::Removed => "removed",
        }
    }
}

impl std::fmt::Display for NotApproved {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Denied => "It was denied where you signed in.",
            Self::Expired => "Its code expired before it was approved. Try again.",
            Self::Removed => "This device was removed from your network.",
        })
    }
}

impl std::error::Error for NotApproved {}

/// What a device sends where it asks to be let in, as RFC 8628 has it.
const FORM: &str = "application/x-www-form-urlencoded";

/// Asks the network's edge at `url`, with `body` signed by `key`. Gives whether it agreed, and what it said.
async fn ask_edge(url: &str, key: &SecretKey, content_type: &str, body: String) -> Result<(bool, Value)> {
    let parsed: reqwest::Url = url.parse().with_context(|| format!("{url} isn't an address"))?;
    let network = Network { address: parsed.origin().ascii_serialization(), token: String::new() };
    let request = || Ok(web()?.post(url).timeout(CONNECT * 3).header("content-type", content_type).body(body.clone()));
    let (status, response) = ask(&network, key, parsed.path(), &body, request).await?;
    Ok((status.is_success(), response))
}

/// How far this device's clock is from the edge's, in milliseconds, as the edge last said (`ask`).
static SKEW: AtomicI64 = AtomicI64::new(0);

fn millis(time: SystemTime) -> Result<i64> {
    Ok(time.duration_since(UNIX_EPOCH)?.as_millis().try_into()?)
}

/// Sends what `request` makes, signed by `key` as an ask of `path` with `body` at `network`'s edge, and gives its
/// status and what it said. One the edge refuses for this device's clock (`RequestTimeTooSkewed`, as S3 says) is
/// signed again by the edge's clock, its `Date`, and sent once more, as AWS's SDKs do: the device keeps how far its
/// clock is from the edge's for every ask after.
async fn ask(
    network: &Network,
    key: &SecretKey,
    path: &str,
    body: &str,
    request: impl Fn() -> Result<reqwest::RequestBuilder>,
) -> Result<(reqwest::StatusCode, Value)> {
    let mut again = true;
    loop {
        let mut ask = request()?;
        for (name, value) in network.signed(key, path, body)? {
            ask = ask.header(name, value);
        }
        let sent = ask.send().await?;
        let status = sent.status();
        let date = sent.headers().get(reqwest::header::DATE).and_then(|date| httpdate::parse_http_date(date.to_str().ok()?).ok());
        let response: Value = sent.json().await?;
        // The edge's `Date` is to the second, so its time is taken as the middle of that second.
        if let Some(edge) = date.filter(|_| again && response["code"] == "RequestTimeTooSkewed") {
            SKEW.store(millis(edge)? + 500 - millis(SystemTime::now())?, Ordering::Relaxed);
            again = false;
            continue;
        }
        return Ok((status, response));
    }
}

/// The file a client's token is kept in, beside its `network`: it holds the token and nothing else, and only this
/// module reads or writes it (`token`, `keep_token`, `forget_token`).
fn token_file(home: &Path) -> PathBuf {
    home.join("token")
}

/// The token kept in `home`, where it's there.
fn token(home: &Path) -> Option<String> {
    fs::read_to_string(token_file(home)).ok()
}

/// Keeps `token` in `home`, in the file beside `network` that holds nothing else, which its owner alone may read.
fn keep_token(home: &Path, token: &str) -> Result<()> {
    let file = token_file(home);
    write(&file, token.as_bytes())?;
    #[cfg(unix)]
    fs::set_permissions(&file, std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    Ok(())
}

/// Drops the token kept in `home`, where it was kept: a device that's nobody's, or someone else's, has none.
fn forget_token(home: &Path) -> Result<()> {
    match fs::remove_file(token_file(home)) {
        Err(error) if error.kind() != ErrorKind::NotFound => return Err(error.into()),
        _ => Ok(()),
    }
}

impl NetworkConfig {
    /// What a client of the network at `address` keeps before it has joined it.
    pub(crate) fn at(address: &str) -> Self {
        Self { address: address.to_owned(), authorization_server: None, token: None, who: None, build: None }
    }

    /// What's kept in `home`, where there's a `network` in it: `network`, and the token in `token` beside it. A
    /// `network` from before the token had a file of its own still holds it: it's moved to `token` now, once, and
    /// `network` is written again without it.
    pub(crate) fn read(home: &Path) -> Result<Option<Self>> {
        let kept = match fs::read(home.join("network")) {
            Ok(kept) => kept,
            Err(error) if error.kind() == ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error).with_context(|| format!("couldn't read {}", home.join("network").display())),
        };
        let mut kept: Value = serde_json::from_slice(&kept).context("`network` isn't a network's address")?;
        let mut config: Self = serde_json::from_value(kept.clone()).context("`network` isn't a network's address")?;
        config.token = token(home);
        if let Some(held) = kept.as_object_mut().and_then(|kept| kept.remove("token")) {
            config.token = config.token.or_else(|| held.as_str().map(str::to_owned));
            config.write(home)?;
        }
        Ok(Some(config))
    }

    /// Keeps this in `home`: the token in `token` beside `network`, or it dropped where this has none, and `network`,
    /// which holds nothing secret. It's the only way `network` is written.
    fn write(&self, home: &Path) -> Result<()> {
        match &self.token {
            Some(token) => keep_token(home, token)?,
            None => forget_token(home)?,
        }
        write(&home.join("network"), &serde_json::to_vec(self)?)
    }

    /// How long the token this client has lasts before it's renewed, by when it says it ends: nothing if it has none.
    fn left(&self) -> Duration {
        self.ends().duration_since(SystemTime::now() + RENEW).unwrap_or_default()
    }

    /// When the token this client has ends, as it says: at once if it has none.
    pub(crate) fn ends(&self) -> SystemTime {
        let claims = self.token.as_ref().and_then(|token| BASE64URL_NOPAD.decode(token.as_bytes()).ok());
        let until =
            claims.and_then(|claims| serde_json::from_slice::<Value>(&claims).ok()).and_then(|claims| claims["until"].as_u64());
        UNIX_EPOCH + Duration::from_millis(until.unwrap_or_default())
    }

    /// Asks the network's edge for this device's token, signed with its key, and keeps it in `home` with whose
    /// device it is (`store_token`). Gives whether the device is someone's. One that's nobody's drops its token,
    /// which nothing takes now, and keeps whose it was and what it kept for them: the edge's word alone takes
    /// nothing else from it, and what it kept goes only once someone else signs in on it.
    async fn admit(&mut self, key: &SecretKey, home: &Path, command: Option<&str>) -> Result<bool> {
        let ask = json!({"jsonrpc": "2.0", "id": 1, "method": "one/token", "params": {"build": device_info(command)}});
        let mcp = format!("{}/mcp", self.address.trim_end_matches('/'));
        let (_, response) = ask_edge(&mcp, key, "application/json", ask.to_string()).await?;
        if response["error"]["code"] == NOBODY {
            if self.token.take().is_some() {
                self.write(home)?;
            }
            return Ok(false);
        }
        if response["result"].is_null() {
            bail!("{}", response["error"]["message"].as_str().unwrap_or("the network's edge gave this device no token"))
        }
        self.store_token(&response["result"], home)?;
        Ok(true)
    }

    /// Asks the network's authorization server for a code this device is let in by, signed with its key.
    async fn device_code(&mut self, key: &SecretKey, home: &Path, command: Option<&str>) -> Result<DeviceAuthorization> {
        let server = match self.authorization_server.clone() {
            Some(server) => server,
            None => AuthorizationServer::discovered(&self.address).await?,
        };
        let requested = DeviceAuthorization::request(&server, key, command).await;
        // What it found is kept for the next time, and what didn't answer is looked for again then.
        self.authorization_server = requested.is_ok().then_some(server);
        self.write(home)?;
        requested
    }

    /// Keeps a token this device was given, `{token, who}`, in `home`. Once the device is someone else's, what it kept
    /// of whoever's it was goes.
    fn store_token(&mut self, given: &Value, home: &Path) -> Result<()> {
        let (Some(token), Some(who)) = (given["token"].as_str(), given["who"].as_str()) else {
            bail!("this device was given no token")
        };
        let someone_else = self.who.as_deref() != Some(who);
        (self.token, self.who, self.build) = (Some(token.to_owned()), Some(who.to_owned()), Some(BUILD.to_owned()));
        if someone_else { self.keep(home) } else { self.write(home) }
    }

    /// Keeps this in `home`, and nothing it kept for whoever's the device was before.
    fn keep(&self, home: &Path) -> Result<()> {
        for cached in ["cache", "files"] {
            match fs::remove_dir_all(home.join(cached)) {
                Err(error) if error.kind() != ErrorKind::NotFound => return Err(error.into()),
                _ => {}
            }
        }
        self.write(home)
    }
}

/// How long before a device's token ends it asks for the next one: half of what a server gives one
/// (`OneCore.Edge`), so a device that's taken out of its network uses its relay for an hour at most.
const RENEW: Duration = Duration::from_secs(30 * 60);

/// How soon a token that couldn't be asked for is asked for again: the device may be offline.
const AGAIN: Duration = Duration::from_secs(60);

/// Moves a device on where it is with its network (`State`), for as long as its client is open: asks for its token
/// while it's opening, renews it while it's in, and waits for its person to approve it while it shows a code. One
/// whose network didn't answer as it opened is asked about again as its network is (`reconnecting`). A server saying
/// the device is nobody's asks the address too (`Client::taken_out`), through the same `admit`. Each waits for the
/// device to be in or out, not for what its network answers meanwhile.
pub(crate) async fn sessions(client: std::sync::Weak<Client>) {
    // Why it asks for a new code, when it does: its last one was denied or expired.
    let mut why = None;
    // How long until it renews its token, while it's in.
    let mut renews = None;
    loop {
        let Some(open) = client.upgrade() else { return };
        let mut state = open.state.subscribe();
        let now = state.borrow_and_update().clone();
        let moved = |state: &State| !state.same_session(&now);
        match &now {
            State::Opening { .. } => {
                renews = Some(open.admit(&now, why.take()).await);
                drop(open);
                if state.wait_for(moved).await.is_err() {
                    return;
                }
            }
            State::SignedIn { .. } => {
                // A network on one machine has no token to renew. Renewing says which build this is and its command (`device_info`),
                // which its network keeps as the device's one record of it: so it's renewed as it starts and each
                // time it's back online, as well as before it ends, and the device's record is the program that last
                // started or came back, not one that last renewed up to half an hour before.
                if open.config().is_none() {
                    drop(open);
                    if state.wait_for(moved).await.is_err() {
                        return;
                    }
                    continue;
                }
                let left = renews.take().unwrap_or(Duration::ZERO);
                drop(open);
                let offline = now.connection() != Connection::Online;
                let back = |state: &State| offline && state.connection() == Connection::Online;
                tokio::select! {
                    _ = sleep(left) => {}
                    changed = state.wait_for(|state| moved(state) || back(state)) => match changed.map(|state| moved(&state)) {
                        Err(_) => return,
                        Ok(true) => continue,
                        Ok(false) => {}
                    },
                }
                let Some(open) = client.upgrade() else { return };
                renews = Some(open.renew(&now).await);
            }
            State::SignIn { code, .. } => {
                let approval = open.approval.clone();
                drop(open);
                let answered = tokio::select! {
                    answered = code.wait_for_approval(&approval) => answered,
                    changed = state.wait_for(moved) => if changed.is_err() { return } else { continue },
                };
                let Some(open) = client.upgrade() else { return };
                why = answered.err();
                open.moved(|_| Some(State::Opening { connection: Connection::Connecting }));
            }
        }
    }
}

impl Client {
    /// Asks its network's edge one MCP request at `/mcp`, signed by this device's key, and gives its answer: what
    /// only the edge answers, as the page an assistant shows an app's tool in (`core/edge/mcp/mcp.ts`), which none
    /// of the network's servers has.
    pub async fn ask_edge(&self, message: &[u8]) -> Result<Vec<u8>> {
        let address = self.address.as_deref().context("A network on one machine has no edge")?;
        let body = String::from_utf8(message.to_vec())?;
        let url = format!("{}/mcp", address.trim_end_matches('/'));
        let (_, response) = ask_edge(&url, &self.key, "application/json", body).await?;
        Ok(serde_json::to_vec(&response)?)
    }

    /// Signs this device out, as its person does once they've removed it from their devices: what it kept of
    /// theirs goes now, as it would for someone else signing in on it, and it opens again as a device that isn't in.
    pub async fn sign_out(&self) -> Result<()> {
        let _one = self.admitting.lock().await;
        let mut config = self.config().context("A device signs out of a network with an address")?;
        (config.token, config.who) = (None, None);
        config.keep(&self.home)?;
        self.moved(|_| Some(State::Opening { connection: Connection::Connecting }));
        Ok(())
    }

    /// What this client keeps of its network, as it is now in its home, where every client of the device keeps
    /// it: nothing for a network on one machine.
    fn config(&self) -> Option<NetworkConfig> {
        let address = self.address.as_deref()?;
        Some(NetworkConfig::read(&self.home).ok().flatten().unwrap_or_else(|| NetworkConfig::at(address)))
    }

    /// Asks its network's address for this device's token, one ask at a time, while it's still where `from` is with
    /// its network (`State::same_session`), and moves it on by what that says (`State::moves_to`): in, with the
    /// token, or out, with a code to be let in by. Only the address says a device is nobody's, never a server alone,
    /// and an address that doesn't answer takes nothing from one that's in: it carries on with the token it has, and
    /// one with none stays opening, while its network is offline. `why` is why it asks for a new code, if it does: its
    /// last one was denied or expired. Gives how long until it asks again, while it's in.
    pub(crate) async fn admit(&self, from: &State, why: Option<NotApproved>) -> Duration {
        let _one = self.admitting.lock().await;
        let Some(mut config) = self.config().filter(|_| self.state.borrow().same_session(from)) else { return AGAIN };
        let failed = match config.admit(&self.key, &self.home, self.terminal()).await {
            Ok(true) => match self.relink(&config).await {
                Ok(()) => {
                    // Its address answered, which says nothing of whether its servers talk with it.
                    self.moved(|now| match now.connection() {
                        Connection::Behind(why) => now.with(Connection::Behind(why)),
                        _ => Some(State::SignedIn { connection: Connection::Online }),
                    });
                    self.rewatch().await;
                    return config.left();
                }
                Err(error) => error,
            },
            Ok(false) => {
                let removed = config.who.is_some().then_some(NotApproved::Removed);
                match config.device_code(&self.key, &self.home, self.terminal()).await {
                    Ok(code) => {
                        self.moved(|_| Some(State::SignIn { code: Box::new(code), why: why.or(removed) }));
                        return AGAIN;
                    }
                    Err(error) => error,
                }
            }
            Err(error) => error,
        };
        let failed = failed.context(format!("Couldn't join the network at {}", config.address));
        // A device that's in carries on with the token it has, and asks again soon.
        let signed_in = matches!(from, State::SignedIn { .. }) || config.token.is_some();
        if !signed_in {
            self.report(json!({"name": "one.client.join", "error": format!("{failed:#}")}));
        }
        let connection = Connection::Offline;
        self.moved(|now| match signed_in {
            true => Some(State::SignedIn { connection }),
            false => now.with(connection),
        });
        AGAIN
    }

    /// Asks for this device's next token while it's in, as it was `now`. A server gives one to a device that's
    /// someone's. One that can't be reached, as where the token this has ended, is asked at the network's address,
    /// which also says whether the device is nobody's now (`admit`). Gives how long until it asks again.
    async fn renew(&self, now: &State) -> Duration {
        let Some(mut config) = self.config() else { return AGAIN };
        // No server takes a token that has ended, so that's asked at the address straight away.
        let given = match config.ends() > SystemTime::now() {
            true => self.request("one/token", json!({"build": device_info(self.terminal())})).await.ok(),
            false => None,
        };
        let Some(given) = given else { return self.admit(now, None).await };
        let _one = self.admitting.lock().await;
        let renewed = async {
            config.store_token(&given, &self.home)?;
            self.relink(&config).await
        };
        match renewed.await {
            Ok(()) => {
                self.rewatch().await;
                config.left()
            }
            Err(_) => AGAIN,
        }
    }

    /// Makes the run's endpoint again to show the token `config` now has, since iroh shows a relay the token an
    /// endpoint was made with. The new one has a key of its own too, as the old one is still there. The old endpoint
    /// goes once its token ends, so what was asked over it finishes, and what's asked from now on is asked from the
    /// new one, whose run the device now attests to.
    async fn relink(&self, config: &NetworkConfig) -> Result<()> {
        let token = config.token.clone().context("this device was given no token")?;
        let network = Network { address: config.address.clone(), token };
        let new = Link::run(&self.key, Some(network), config.who.clone()).await?;
        accept(new.endpoint.clone(), self.me.clone());
        let old = std::mem::replace(&mut *self.link.write().expect("no renewal panics"), new);
        self.reach.lock().await.open = None;
        tokio::spawn(async move {
            sleep(RENEW).await;
            old.endpoint.close().await
        });
        Ok(())
    }

    /// Says again that this client is watching, if it is, as servers reach it where its run now is (`relink`).
    async fn rewatch(&self) {
        if self.watching.load(Ordering::Relaxed) {
            self.watch(true).await;
        }
    }

    /// Whose device this is, while it's in its network: the user it signed in as.
    pub fn who(&self) -> Option<String> {
        if !matches!(*self.state.borrow(), State::SignedIn { .. }) {
            return None;
        }
        self.link().who
    }
}
