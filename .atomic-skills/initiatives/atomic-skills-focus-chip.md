---
initiative_id: atomic-skills-focus-chip
status: active
started: 2026-06-15
last_updated: 2026-06-15T19:05:00Z
branch: feat/atomic-skills-focus-chip
worktree:
plan_link:
summary: "Chip desktop-only que lê .atomic-skills/focus.json e mostra plano · fase i/n · tasks done/total, com staleness por lastUpdated."
wip_limit: 2
scope_paths:
  - assets/statusline.sh
  - src/toml-parser.js
  - assets/default-config.toml
  - test/unit/test-project-chip.sh
  - test/fixtures/
  - docs/specs/atomic-skills-focus-chip.md
  - .atomic-skills/focus.json

stack:
  - {id: 1, title: "Implementar project_chip() consumindo focus.json (contrato atomic-skills) + config + staleness + testes + dogfood live", type: initiative, opened_at: 2026-06-15T18:35:00Z}

tasks:
  T1: {id: T1, title: "Spec corrigida do consumidor (jq US-sep, git-root walk, grep lastUpdated|last_updated)", status: done, closed_at: 2026-06-15T18:45:00Z, last_updated: 2026-06-15T18:45:00Z}
  T2: {id: T2, title: "project_chip() + resolve_git_root em main + placement em identity_row", status: done, closed_at: 2026-06-15T18:45:00Z, last_updated: 2026-06-15T18:45:00Z}
  T3: {id: T3, title: "Config: defaults statusline.sh + VALID_KEYS toml-parser.js + default-config.toml", status: done, closed_at: 2026-06-15T18:45:00Z, last_updated: 2026-06-15T18:45:00Z}
  T4: {id: T4, title: "Dogfood: focus.json real do claudebar (esta initiative) p/ teste ao vivo", status: done, closed_at: 2026-06-15T18:45:00Z, last_updated: 2026-06-15T18:45:00Z}
  T5: {id: T5, title: "Testes: test-project-chip.sh + run-fixture CHIP_PROJECT=0 + perf <50ms", status: done, closed_at: 2026-06-15T18:45:00Z, last_updated: 2026-06-15T18:45:00Z}
  T6: {id: T6, title: "Refino visual (linha 2, id completo, glifo dot-circle), marcador multipleActivePlans (nf-fa-clone) + handoff reconciliado", status: done, closed_at: 2026-06-15T19:05:00Z, last_updated: 2026-06-15T19:05:00Z}

parked: []

emerged: []

next_action: "Tudo implementado + review 2 camadas (SHIP) + visual aprovado pelo usuário + handoff reconciliado. Falta: commit + bump 1.4.0 + abrir PR."
---

# atomic-skills focus chip — indicador de foco do projeto na statusline

## Contexto

A skill `atomic-skills:project` publica `.atomic-skills/focus.json` (projeção plana
do "onde estou": plano → fase → task). Contrato canônico:
`~/atomic-skills/meta/schemas/focus.schema.json` + spec do produtor
`~/atomic-skills/docs/design/statusline-focus-integration.md`. Decisão de produto:
chip **desktop-only** (layout `full`), nunca no `compact`.

O claudebar (consumidor) lê **um** arquivo e renderiza um chip glanceável; nunca
anda na árvore YAML. Frescor garantido: nunca exibir dado velho como fresco
(oráculo de staleness por `lastUpdated`, camada 4).

## Por que spec própria (não o snippet do handoff)

O handoff (`docs/atomic-skills-focus-integration.md`) e o próprio spec do produtor
trazem um snippet bash com 2 bugs que impedem rodar: (1) os separadores do `jq`
(`\001/\002/\003`) foram perdidos como strings vazias (`join("")`, `+ "" +`), e
(2) referenciam um `$GIT_ROOT` que não existe em `statusline.sh` (e `IFS=$'\0'`
não funciona no bash). Reimplementação limpa: `jq ... @tsv` (TAB entre campos,
`\n` entre registros), git-root computado via `git rev-parse --show-toplevel`,
e grep tolerante a `lastUpdated:`/`last_updated:` (superset do contrato → permite
dogfood no próprio repo flat do claudebar).

## Decisões

- **jq → @tsv**: 1ª linha = campos de render (TAB-sep); linhas seguintes = um source
  por linha (`path<TAB>lastUpdated`). Robusto e bash-3.2 compatível (sem control chars).
- **git-root**: computado em `main()` só quando `CHIP_PROJECT` on; passado para
  `identity_row` como `git_root=`. Fallback: nenhum root → não renderiza.
- **staleness**: relê `^(lastUpdated|last_updated):` de cada source; source ausente
  → stale; valor divergente → stale; campo ausente/indeterminado → assume fresco
  (evita falso-stale perpétuo por divergência de layout).
- **placement**: chip próprio após o grupo repo/branch/dirty e antes do PR — estado
  de projeto vive junto do estado git. (Diverge do D2 do produtor "antes de tmux";
  ver spec para racional.)
- **dogfood**: autorar `.atomic-skills/focus.json` real do claudebar refletindo esta
  initiative, para o chip acender ao vivo enquanto construímos.

## Links

- Handoff (consumidor): `docs/atomic-skills-focus-integration.md`
- Spec corrigida: `docs/specs/atomic-skills-focus-chip.md`
- Contrato produtor: `~/atomic-skills/docs/design/statusline-focus-integration.md`
