---
initiative_id: npm-distribution
status: active
started: 2026-05-26
last_updated: 2026-05-27T00:59:42Z
branch:
worktree:
plan_link: docs/superpowers/specs/2026-05-26-config-system-design.md
wip_limit: 2
scope_paths:
  - .

stack:
  - {id: 1, title: "Package claudebar as npm with npx CLI and TOML config", type: initiative, opened_at: 2026-05-27T00:59:42Z}

tasks: {}

parked: []

emerged: []

next_action: "Create package.json and bin/cli.js scaffold per spec architecture"
---

# Package claudebar as npm with npx CLI and TOML config

## Context

claudebar currently ships as a standalone bash script installed via `install.sh`. The config system spec (`docs/superpowers/specs/2026-05-26-config-system-design.md`) defines a full redesign: TOML-based configuration at `~/.config/claudebar/config.toml`, compiled to `config.sh` at runtime, managed via an `npx @henryavila/claudebar` CLI with `install`, `update`, `config`, `doctor`, and `uninstall` subcommands.

The spec was committed on 2026-05-26 (commit `91ac087`) but no implementation artifacts exist yet — no `package.json`, no `bin/` or `src/` directories, no TOML parser. This is the clear next phase of the project after v1.1.0 features (responsive layout, quota countdown) shipped.

Key architectural decisions already made in the spec: Node.js 18+ CLI runtime, TOML config format (flat sections, no nested arrays), `~/.config/claudebar/` install target, GitHub Actions CI/CD with OIDC trusted publishing to npm, <1ms config loading budget.

## Decisions

_(record decisions here as they are made)_

## Links

- Spec: `docs/superpowers/specs/2026-05-26-config-system-design.md`
