//! A TURN server's relay, reached over TCP, by its IPv4 address, as WebRTC reaches one (its `session.rs`): what a
//! `video`'s and a `voice`'s connection reach the screen through, so neither needs an address of its own that the
//! screen can reach, nor a UDP port.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{IpAddr, SocketAddr, TcpStream, ToSocketAddrs};
use std::sync::Arc;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

use anyhow::{Context, anyhow, bail};
use serde::Deserialize;
use turn_client_proto::api::{TurnClientApi, TurnConfig, TurnEvent, TurnPollRet, TurnRecvRet};
use turn_client_proto::prelude::DelayedTransmitBuild;
use turn_client_proto::stun::agent::Transmit;
use turn_client_proto::tcp::TurnClientTcp;
use turn_client_proto::types::{TransportType, TurnCredentials};

/// How long the TURN server has to give an allocation, as the sender's.
const ALLOCATING: Duration = Duration::from_secs(4);

/// What a connection was given: its ICE servers, as `RTCConfiguration` has them.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Ice {
    ice_servers: Vec<IceServer>,
}

#[derive(Deserialize)]
struct IceServer {
    #[serde(deserialize_with = "one_or_many")]
    urls: Vec<String>,
    username: Option<String>,
    credential: Option<String>,
}

fn one_or_many<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Urls {
        One(String),
        Many(Vec<String>),
    }
    Ok(match Urls::deserialize(d)? {
        Urls::One(url) => vec![url],
        Urls::Many(urls) => urls,
    })
}

/// A TURN server's relay, reached over TCP, by its IPv4 address, as WebRTC's sender reaches it (its `session.rs`).
pub(crate) struct Turn {
    client: TurnClientTcp,
    stream: TcpStream,
    server: SocketAddr,
    local: SocketAddr,
    base: Instant,
    bound: HashSet<SocketAddr>,
    /// What the server sent: its bytes, or `None` once it closed, which wakes its connection to take them.
    heard: Receiver<Option<Vec<u8>>>,
}

impl Turn {
    /// A TCP connection to the first TURN server over TCP it was given, with its bytes read on a thread of their own
    /// which `wake`s its connection as one comes.
    pub(crate) fn connect(ice: &Ice, wake: Arc<dyn Fn() + Send + Sync>) -> anyhow::Result<Self> {
        let (url, server) = ice
            .ice_servers
            .iter()
            .flat_map(|server| server.urls.iter().map(move |url| (url, server)))
            .find(|(url, _)| url.starts_with("turn:") && url.ends_with("transport=tcp"))
            .ok_or_else(|| anyhow!("no TURN server over TCP was given"))?;
        let host = url["turn:".len()..].split('?').next().unwrap_or_default();
        let address = host
            .to_socket_addrs()
            .with_context(|| format!("couldn't find {host}"))?
            .find(SocketAddr::is_ipv4)
            .ok_or_else(|| anyhow!("{host} has no IPv4 address"))?;
        let stream = TcpStream::connect_timeout(&address, ALLOCATING)
            .with_context(|| format!("couldn't reach TURN at {address}"))?;
        stream.set_nodelay(true)?;
        let mut reading = stream.try_clone()?;
        let (gate, heard) = mpsc::channel();
        std::thread::Builder::new().name("turn".into()).spawn(move || {
            let mut buffer = vec![0; 65536];
            loop {
                match reading.read(&mut buffer) {
                    Ok(0) | Err(_) => {
                        let _ = gate.send(None);
                        wake();
                        break;
                    }
                    Ok(n) => {
                        if gate.send(Some(buffer[..n].to_vec())).is_err() {
                            break;
                        }
                        wake();
                    }
                }
            }
        })?;
        let local = stream.local_addr()?;
        let credentials =
            TurnCredentials::new(server.username.as_deref().unwrap_or(""), server.credential.as_deref().unwrap_or(""));
        let client = TurnClientTcp::allocate(local, address, TurnConfig::new(credentials));
        Ok(Self { client, stream, server: address, local, base: Instant::now(), bound: HashSet::new(), heard })
    }

    /// What the server sent since it was last asked: its bytes, or `None` once it closed.
    pub(crate) fn heard(&self) -> &Receiver<Option<Vec<u8>>> {
        &self.heard
    }

    /// Where the connection to it is from, which its local candidate is made of.
    pub(crate) fn local(&self) -> SocketAddr {
        self.local
    }

    /// Takes the client's events it has now, which a connection has no use for once its allocation is made.
    pub(crate) fn events(&mut self) {
        while self.client.poll_event().is_some() {}
    }

    /// Waits for the TURN server to give the relay's address.
    pub(crate) fn allocate(&mut self) -> anyhow::Result<SocketAddr> {
        let until = Instant::now() + ALLOCATING;
        loop {
            self.flush()?;
            while let Some(event) = self.client.poll_event() {
                match event {
                    TurnEvent::AllocationCreated(_, relay) => return Ok(relay),
                    TurnEvent::AllocationCreateFailed(_) => bail!("the TURN server refused an allocation"),
                    _ => {}
                }
            }
            let wait = until.saturating_duration_since(Instant::now()).min(self.wait());
            match self.heard.recv_timeout(wait) {
                Ok(Some(bytes)) => drop(self.receive(&bytes)),
                Ok(None) | Err(RecvTimeoutError::Disconnected) => bail!("the TURN server closed its connection"),
                Err(RecvTimeoutError::Timeout) if Instant::now() >= until => {
                    bail!("it couldn't reach TURN within {} seconds", ALLOCATING.as_secs())
                }
                Err(RecvTimeoutError::Timeout) => {}
            }
        }
    }

    fn now(&self) -> turn_client_proto::stun::Instant {
        turn_client_proto::stun::Instant::from_std(self.base)
    }

    /// How long until the client has something to do: a request to send again, or the allocation to refresh.
    pub(crate) fn wait(&mut self) -> Duration {
        match self.client.poll(self.now()) {
            TurnPollRet::WaitUntil(at) => at.to_std(self.base).saturating_duration_since(Instant::now()),
            _ => Duration::from_secs(1),
        }
    }

    /// Sends the client's requests.
    pub(crate) fn flush(&mut self) -> anyhow::Result<()> {
        let now = self.now();
        let _ = self.client.poll(now);
        while let Some(transmit) = self.client.poll_transmit(now) {
            self.stream.write_all(transmit.data.as_ref())?;
        }
        Ok(())
    }

    /// The peers' data in bytes from the TURN server, the rest being the client's own.
    pub(crate) fn receive(&mut self, bytes: &[u8]) -> Vec<(SocketAddr, Vec<u8>)> {
        let now = self.now();
        let mut data = vec![];
        if let TurnRecvRet::PeerData(peer) =
            self.client.recv(Transmit::new(bytes, TransportType::Tcp, self.server, self.local), now)
        {
            data.push((peer.peer, peer.data().to_vec()));
        }
        while let Some(peer) = self.client.poll_recv(now) {
            data.push((peer.peer, peer.data().to_vec()));
        }
        data
    }

    pub(crate) fn permit(&mut self, ip: IpAddr) {
        let _ = self.client.create_permission(TransportType::Udp, ip, self.now());
    }

    /// Sends `data` to `peer` through the relay, over a channel once the peer has one. One the relay doesn't let
    /// through yet is let through, and its packet dropped, as ICE sends again.
    pub(crate) fn send(&mut self, peer: SocketAddr, data: &[u8]) -> anyhow::Result<()> {
        let now = self.now();
        if !self.client.have_permission(TransportType::Udp, peer.ip()) {
            self.permit(peer.ip());
            return self.flush();
        }
        if self.bound.insert(peer) {
            let _ = self.client.bind_channel(TransportType::Udp, peer, now);
            self.flush()?;
        }
        if let Ok(Some(transmit)) = self.client.send_to(TransportType::Udp, peer, data, now) {
            self.stream.write_all(&transmit.data.build())?;
        }
        Ok(())
    }
}

/// The IP addresses of the candidates in an SDP.
pub(crate) fn candidates(sdp: &str) -> HashSet<IpAddr> {
    sdp.lines()
        .filter_map(|line| line.strip_prefix("a=candidate:"))
        .filter_map(|candidate| candidate.split_whitespace().nth(4)?.parse().ok())
        .collect()
}

/// An SDP whose candidate lines str0m reads: its parser takes the attributes after `typ` in one order only (`raddr`,
/// `tcptype`, `generation`, `network-id`, `ufrag`, `network-cost`) and drops a whole line that has them in any other,
/// as Cloudflare's SFU writes `ufrag` before `generation`. A dropped line is a candidate no ICE check is ever sent to,
/// so a call or a video stays unconnected. The attributes it knows are written in its order, the ones it doesn't are
/// left out, and every other line is as it was.
pub(crate) fn readable(sdp: &str) -> String {
    let mut out = String::with_capacity(sdp.len());
    for (at, line) in sdp.split("\r\n").enumerate() {
        if at > 0 {
            out.push_str("\r\n");
        }
        match readable_candidate(line) {
            Some(candidate) => out.push_str(&candidate),
            None => out.push_str(line),
        }
    }
    out
}

/// The attributes str0m's candidate parser takes, in the order it takes them.
const CANDIDATE_ATTRIBUTES: [&str; 7] =
    ["raddr", "rport", "tcptype", "generation", "network-id", "ufrag", "network-cost"];

/// A candidate line with its attributes in str0m's order, or none where the line isn't one.
fn readable_candidate(line: &str) -> Option<String> {
    // `candidate:<foundation> <component> <transport> <priority> <address> <port> typ <kind>`, then the attributes.
    let candidate = line.strip_prefix("a=candidate:")?;
    let (head, rest) = candidate.split_once(" typ ")?;
    let mut fields = rest.split_whitespace();
    let kind = fields.next()?;
    let rest: Vec<&str> = fields.collect();
    let attributes: HashMap<&str, &str> = rest.chunks_exact(2).map(|pair| (pair[0], pair[1])).collect();
    let mut out = format!("a=candidate:{head} typ {kind}");
    for name in CANDIDATE_ATTRIBUTES {
        if let Some(value) = attributes.get(name) {
            out.push(' ');
            out.push_str(name);
            out.push(' ');
            out.push_str(value);
        }
    }
    Some(out)
}
