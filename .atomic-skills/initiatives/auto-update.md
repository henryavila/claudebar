---
initiative_id: auto-update
status: active
started: 2026-06-01
last_updated: 2026-06-01T11:44:49Z
branch:
worktree:
plan_link:
wip_limit: 2
scope_paths:
  - src/auto-update.js
  - assets/auto-update.mjs
  - src/settings.js
  - src/install.js
  - assets/default-config.toml
  - test/cli/
stack:
  - {id: 1, title: "Auto-update: aplica hotfix sozinho (throttled, background) + instalador interativo", type: initiative, opened_at: 2026-06-01T11:44:49Z}
tasks: {}
parked: []
emerged: []
next_action: "Fase 1, red-first: escrever testes de decideUpdate() (semver) em test/cli/auto-update.test.js antes de qualquer código"
---

# Auto-update — usuário recebe correções na hora

> HANDOFF (sessão 2026-06-01). Todo o design abaixo já foi decidido com o usuário.
> Numa sessão nova: leia este arquivo, confirme o plano, e comece a Fase 1 pela
> função `decideUpdate` com testes red-first. Não re-discuta o design já travado.

## Motivação (caso de uso já comprovado)

Nesta mesma sessão o usuário ficou preso na claudebar v1.1.0 (sem o heal-hook) e
só destravou rodando `update` na mão. Com auto-update, a correção (que virou a PR
do self-heal) teria chegado sozinha. O objetivo: ao lançar uma correção, o usuário
tem acesso imediato sem rodar `npx … update` manualmente.

## Decisões TRAVADAS (não re-perguntar)

1. **Modo default:** `patch` — auto-aplica só hotfix (1.1.x); minor/major (1.X.0 /
   X.0.0) apenas **notificam** (gravam estado pra um chip na statusline). Ligado por
   padrão (opt-out).
2. **Instalador interativo:** em TTY, mostra "versão instalada" + "disponível" e
   pergunta o modo: `1) só hotfixes [recomendado]  2) todas as versões  3) desligado`.
   Em CI/sem-TTY cai no default (`patch`, ligado) sem travar.
3. **Config** (em `assets/default-config.toml`, consolidado num campo):
   - `auto_update = "patch"   # "patch" | "all" | "off"`
   - `auto_update_interval_hours = 24`
4. **Cadência:** 1×/dia (configurável). Checagem **só no SessionStart**, NUNCA no
   UserPromptSubmit nem no statusline.sh (orçamento <1ms no render path).
5. **Overhead:** portão por timestamp (`~/.config/claudebar/.last-update-check`) —
   se < intervalo, retorna na hora (um stat). Quando vence, dispara processo
   **detached** (`nohup … &`) que checa rede e aplica. Nunca bloqueia a sessão;
   offline → falha em silêncio e atualiza o timestamp (não re-tenta em loop).

## Arquitetura — núcleo puro + I/O fino

| Peça | O quê | Arquivo |
|---|---|---|
| `decideUpdate(installed, latest, mode)` | função **PURA** semver → `{action:'apply'\|'notify'\|'none', reason}`. Coração testável. | `src/auto-update.js` (novo) |
| `fetchLatestVersion()` | `fetch` nativo (Node 18+) em `https://registry.npmjs.org/@henryavila/claudebar/latest`, lê `.version`. NÃO spawna npm. | idem |
| `applyUpdate()` | spawn `npx -y @henryavila/claudebar@latest update` detached, log em `~/.config/claudebar/.auto-update.log` | idem |
| `runAutoUpdate()` | orquestra: lê config (modo+intervalo) → portão timestamp → fetch → decide → apply/notify. Best-effort, try/catch tudo. | idem |
| hook `auto-update.mjs` | SessionStart-only: spawna `runAutoUpdate` detached e sai 0 em silêncio (stdout vai pro contexto). Separado do heal. | `assets/auto-update.mjs` (novo) |
| registro | `ensureAutoUpdateHook` / `removeAutoUpdateHook` (SessionStart). Seguir o padrão de `ensureHealHook` (marker substring, idempotente por evento). | `src/settings.js` |
| leitura de config no node | precisa do modo+intervalo no lado node. Reusar `src/toml-parser.js` (parser TOML JS já existe) lendo `~/.config/claudebar/config.toml`. | — |
| instalador | prompt `readline` nativo, TTY-safe; grava o modo escolhido no config.toml | `src/install.js` + `src/update.js` (registrar o hook, igual heal) |

### Segurança (o único risco real)
A **decisão** (atualizar? qual nível?) roda no código local JÁ instalado (confiável)
— só lê uma string de versão da rede. Só o passo `applyUpdate` puxa código novo via
`npx @latest`, que é exatamente o que o `update` manual já faz. Mitigações: modo
`off` disponível, backup automático do `update`, e em `patch` só patch entra sozinho.

## Test list — Fase 1, `decideUpdate(installed, latest, mode)` (RED-FIRST)

Pura, sem I/O → casos semver determinísticos (mutação que quebra cada um entre []):

1. patch↑ em modo `patch` → `apply`            [trocar 'apply' por 'notify']
2. minor↑ em modo `patch` → `notify`           [se virar 'apply', auto-aplica feature: errado]
3. major↑ em modo `patch` → `notify`           [idem]
4. patch↑ em modo `all` → `apply`              [-]
5. minor↑/major↑ em modo `all` → `apply`       [-]
6. qualquer↑ em modo `off` → `none`            [off tem que ser inerte]
7. latest == installed → `none` (qualquer modo) [evita update inútil]
8. latest < installed (downgrade) → `none`     [nunca regredir]
9. versão inválida/não-semver (latest ou installed) → `none` + sem throw [defensivo: rede pode devolver lixo]
10. pré-release (ex 1.2.0-rc.1) → `none`/notify, não auto-aplicar  [não puxar rc sozinho]

Depois: testes de `runAutoUpdate` com `fetchLatestVersion` e `applyUpdate` mockados
(throttle respeitado; offline → none silencioso; timestamp sempre atualizado).
E em `test/cli/settings.test.js`: `ensureAutoUpdateHook` registra/idempotente/preserva;
`removeAutoUpdateHook` remove e mantém alheios (espelhar os testes do heal).

## Escopo

- **Fase 1 (MVP):** tudo da tabela — auto-aplica patch 1×/dia + grava `.update-available`
  (versão) pra minor/major. Instalador interativo. Hook registrado por install/update.
- **Fase 2:** chip "⬆ vX" na `statusline.sh` lendo `.update-available`; subcomando
  `config` pra trocar o modo depois; talvez `doctor` reportar status do auto-update.

## Estado ao entrar na sessão nova

- A PR do self-heal (bug 1 + bug 2) já cobre `ensure-statusline.mjs` + dual-event
  (`HEAL_HOOK_EVENTS`) em `src/settings.js`. **Reusar esse padrão** pro auto-update hook.
- `src/update.js` roda o self-heal payload em TODO update (antes do early-return de
  versão) — bom ponto de referência pro fluxo de cópia de assets.
- Node 18+ é requisito (tem `fetch`). Projeto é **dependency-free** (só builtins) —
  manter assim (nada de `semver` npm; escrever um compare simples e testá-lo).
