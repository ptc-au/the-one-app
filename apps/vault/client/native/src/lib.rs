//! `one vault run --handle <handle> [--env NAME] -- <command> [args…]`: runs a command with a handle's secret
//! (`vault_handle`), as 1Password's `op run` and Doppler's `doppler run --` run one with theirs, so whoever ran it,
//! an agent, holds only the handle. The Vault answers the secret sealed to this device's key (`vault_redeem`), which
//! only this program opens, and it goes to the command alone: on its input, or in the variable `--env` names. What the
//! command prints has `<concealed>` in place of it, as `op run` conceals what it hands over.

use std::process::{ExitCode, Stdio};

use anyhow::{Context, Result, bail};
use client::Client;
use data_encoding::BASE64;
use serde_json::json;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

/// What a command's output has in place of the secret.
const CONCEALED: &[u8] = b"<concealed>";

/// Runs the command `args` names after `--`, with the secret of the handle `--handle` names, once.
pub async fn run(client: &Client, args: &[String]) -> Result<ExitCode> {
    let usage = || format!("{} vault run --handle <handle> [--env NAME] -- <command> [args…]", client::command());
    let at = args.iter().position(|arg| arg == "--").with_context(usage)?;
    let (flags, command) = (&args[..at], &args[at + 1..]);
    let (mut handle, mut env) = (None, None);
    for pair in flags.chunks(2) {
        match pair {
            [flag, value] if flag == "--handle" => handle = Some(value.as_str()),
            [flag, value] if flag == "--env" => env = Some(value.as_str()),
            _ => bail!("{}", usage()),
        }
    }
    let (Some(handle), [program, args @ ..]) = (handle, command) else { bail!("{}", usage()) };

    let secret = redeemed(client, handle).await?;
    let mut child = tokio::process::Command::new(program);
    child.args(args).stdout(Stdio::piped()).stderr(Stdio::piped());
    match env {
        Some(name) => child.env(
            name,
            String::from_utf8(secret.clone()).context("the secret isn't text, so it goes on the command's input")?,
        ),
        None => child.stdin(Stdio::piped()),
    };
    let mut child = child.spawn().with_context(|| format!("couldn't run {program}"))?;
    if let Some(mut input) = child.stdin.take() {
        // A command that doesn't read it all still runs: what it didn't read is let go.
        let _ = input.write_all(&secret).await;
    }
    let (stdout, stderr) = (child.stdout.take().expect("piped"), child.stderr.take().expect("piped"));
    let (printed, errors, status) = tokio::join!(
        conceal(stdout, tokio::io::stdout(), &secret),
        conceal(stderr, tokio::io::stderr(), &secret),
        child.wait()
    );
    printed?;
    errors?;
    Ok(ExitCode::from(status?.code().unwrap_or(1).clamp(0, 255) as u8))
}

/// The handle's secret, spent: the Vault seals it to this device's key, for this handle alone.
async fn redeemed(client: &Client, handle: &str) -> Result<Vec<u8>> {
    let result = client.request("tools/call", json!({"name": "vault_redeem", "arguments": {"handle": handle}})).await?;
    if result["isError"] == true {
        bail!("{}", result["content"][0]["text"].as_str().unwrap_or("The Vault didn't hand it over."));
    }
    let sealed = result["structuredContent"]["sealed"].as_str().context("the Vault answered no sealed secret")?;
    let sealed = BASE64.decode(sealed.as_bytes()).context("the Vault's answer isn't base64")?;
    client::sealed::open(client.device_key(), &format!("one/vault/1/handle\n{handle}"), &sealed)
}

/// Copies what a command prints to `to`, with `CONCEALED` in place of the secret. What could be the start of it is
/// held back until what follows says whether it is.
async fn conceal(mut from: impl AsyncRead + Unpin, mut to: impl AsyncWrite + Unpin, secret: &[u8]) -> Result<()> {
    let mut held = Vec::new();
    let mut chunk = vec![0; 16 * 1024];
    loop {
        let read = from.read(&mut chunk).await?;
        held.extend_from_slice(&chunk[..read]);
        let (out, kept) = concealed(&held, secret, read == 0);
        to.write_all(&out).await?;
        to.flush().await?;
        held = kept;
        if read == 0 {
            return Ok(());
        }
    }
}

/// `held` with `CONCEALED` in place of each whole `secret`, and, unless it's the end, the end of it that could
/// start one, held back.
fn concealed(held: &[u8], secret: &[u8], end: bool) -> (Vec<u8>, Vec<u8>) {
    if secret.is_empty() {
        return (held.to_vec(), Vec::new());
    }
    let mut out = Vec::with_capacity(held.len());
    let mut rest = held;
    while let Some(at) = rest.windows(secret.len()).position(|window| window == secret) {
        out.extend_from_slice(&rest[..at]);
        out.extend_from_slice(CONCEALED);
        rest = &rest[at + secret.len()..];
    }
    let kept = if end { 0 } else { (1..secret.len()).rev().find(|&n| rest.ends_with(&secret[..n])).unwrap_or(0) };
    out.extend_from_slice(&rest[..rest.len() - kept]);
    (out, rest[rest.len() - kept..].to_vec())
}
