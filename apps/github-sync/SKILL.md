---
name: github-sync
description: Read when someone asks why a repo in Git Repos is on GitHub too, why a push was refused by GitHub, or to connect the network to a GitHub team's repos.
metadata:
  title: "GitHub Sync"
  subtitle: "Your team's GitHub repos, in your network"
  about: "Keeps every repo your GitHub team works on in your network's Git Repos, both ways: what's pushed on GitHub shows up within a minute, and what's pushed here goes to GitHub first, under GitHub's own rules. Pull requests opened here are opened on GitHub."
  category: Developer tools
---

GitHub Sync keeps each repo a GitHub team may push to in the network's Git Repos, as `network/made/git-repos/<its
name>`, and GitHub stays the one source of truth.

- Within a minute of a push to GitHub, its branches and tags are in the network's repo. A repo the team gets write on
  starts syncing, and one it loses stops; its copy here stays as it was.
- A push to a synced repo here goes to GitHub first, and is kept only if GitHub takes it, so GitHub's branch rules
  hold. One GitHub refuses is refused, with GitHub's words. If GitHub moved since you fetched, git says `fetch first`.
- A pull request pushed here (`git push origin HEAD:refs/pull/<name>`) is the branch `pull/<name>` on GitHub, with a
  pull request from it that says who opened it. It's merged on GitHub; closing it here closes it there.
- Who pushes is Git Repos' sharing, as for any repo: GitHub Sync adds no rules of its own, and nobody needs a GitHub
  account.
- `repos` says which repos sync and when each last did, as its page in Settings shows. `sync` syncs them now.
- `connect` is done once, by the network's owner: it takes the code GitHub's manifest flow sends back once the
  GitHub App is made, keeps the app's private key in the network's Vault, and says where to install the app.
