---
name: remote-shell
description: Read before running commands, starting background processes, or copying/downloading/uploading files on one of the user's own devices with remote-shell.
metadata:
  title: "Remote Shell"
  subtitle: "Run commands and copy files on your devices"
  about: "Lets your AI run commands and copy files across your own devices, from anywhere. Every command and transfer is logged on the device it ran on."
  category: Devices
---

Run a shell command on one of your own devices with `run`; give `device`, a name `services` gives the servers
running RemoteShell.Runner, to choose which, or it runs on the device asked if that has Remote Shell, and otherwise
on the first that's up. It runs as the user that device's server runs as, in their home folder unless `dir` says,
and reads no input. Every command and transfer is logged on the device it ran on.

## Background processes

To leave a process running after `run` returns (as with `ssh`), detach it and redirect its output, and print its PID
so you can stop it later:

    nohup python3 -m http.server 8123 >/tmp/http.log 2>&1 & echo $!

Stop it later with `kill <pid>`. Only the call's own foreground process group is stopped if the call times out.

## Copying and transferring files

- `copy` copies a file or folder of any size between two devices, keeping file modes:
  `from: "<device>:<path>"`, `to: "<device>:<path>"` (like `scp`/`rsync`; `~` expands to home, relative paths are
  from home). Copying a file into an existing folder keeps its name; copying a folder into an existing folder places
  it inside unless `from` ends with `/`.
- `download` fetches a file from a device to where you are (or a folder as a `.tar.gz` archive): the CLI writes it to
  stdout (`one remote-shell download --device MacBook --path ~/shot.png > shot.png`), and MCP returns a
  `resource_link` the client can download.
- `upload` sends a file from where you are to a device: the CLI takes `--file-from <local path>`, and MCP takes a
  `file` name from the `upload` tool (`app: "remote-shell"`).

A device has Remote Shell once its service is installed there: `install_service --app remote-shell --service
RemoteShell.Runner --server <key>`. It runs any command and copies any file for everyone that device's server acts for,
so it's for a device whose server acts for you alone, or for people you'd hand a terminal to.
