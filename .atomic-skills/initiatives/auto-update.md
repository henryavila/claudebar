---
initiative_id: auto-update
status: shipped
started: 2026-06-01
last_updated: 2026-06-01T12:30:00Z
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
next_action: "SHIPPED — PR #12 merged → main (ed8d492); release v1.2.0 publicado no npm via OIDC (latest=1.2.0). Opcional: rodar `update` na máquina real p/ ativar chip+hook localmente."
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

## Progresso (sessão 2026-06-01, cont.)

- ✅ **Fase 1 / decideUpdate** — `src/auto-update.js` criado com `decideUpdate(installed, latest, mode)`
  + helpers puros `parseSemver`/`compareCore` (sem npm `semver`). 11 testes red→green em
  `test/cli/auto-update.test.js` cobrindo os 10 casos da test list (patch/minor/major × patch/all/off,
  igual, downgrade, lixo não-semver sem throw, pré-release nunca auto-aplica).
- ✅ **Fase 1 / registro de hook** — `ensureAutoUpdateHook`/`removeAutoUpdateHook` em `src/settings.js`
  (SessionStart-ONLY, marker `auto-update`, `AUTO_UPDATE_HOOK_COMMAND = node ~/.config/claudebar/auto-update.mjs`).
  Espelha o heal mas single-event. +12 testes em `test/cli/settings.test.js` (coexiste com heal,
  idempotente, remove sem tocar no heal, nunca em UserPromptSubmit). Suíte CLI: **97/97 green**.
- ✅ **Config `[update]`** — decisão travada: seção `[update]` (parser é section-scoped). Adicionada a
  `VALID_SECTIONS`/`VALID_KEYS` + coerção numérica do `auto_update_interval_hours` + validação
  (`patch|all|off`, inteiro ≥1) em `src/toml-parser.js`. Seção comentada em `assets/default-config.toml`.
- ✅ **runAutoUpdate + I/O** — em `src/auto-update.js`: `runAutoUpdate` (config→portão timestamp→fetch→
  decide→apply/notify, deps injetadas, nunca throw), `fetchLatestVersion` (fetch nativo, null em falha),
  `applyUpdate` (spawn `npx @latest update` detached, log), `readConfig` (best-effort→defaults).
  Exports `DEFAULT_MODE='patch'`, `DEFAULT_INTERVAL_HOURS=24`. +9 testes (throttle, offline silencioso,
  timestamp sempre fresco, notify grava `.update-available`, off inerte, up-to-date limpa stale).
- ✅ **Hook `assets/auto-update.mjs`** — SessionStart-only, 2 modos: bare→re-spawna `--run` DETACHED e
  sai 0 na hora (sessão nunca espera rede); `--run`→worker faz o check. Silencioso/best-effort.
  +2 testes em `test/cli/auto-update-hook.test.js`.
- ✅ **Wiring** — `install.js`/`update.js` copiam o payload (auto-update.mjs+auto-update.js+toml-parser.js)
  e registram o hook; `update` faz back-fill em TODO update (antes do gate de versão, igual heal);
  `uninstall.js` remove o hook. +5 testes (install×2, update back-fill, uninstall preserva alheios).
- ✅ **Instalador interativo** — `install.js` `promptAutoUpdateMode` (readline, TTY-safe: sem TTY→null→
  mantém default; nunca bloqueia CI) + `applyAutoUpdateMode` (ativa a linha comentada do template);
  só pergunta em install fresh, nunca clobbera config existente. dep `chooseMode` injetável. +3 testes.

**Fase 1: 119 CLI + 38 bash green.**

## Progresso — FASE 2 (chip + config + doctor)

- ✅ **Chip `⬆ vX`** — `update_chip()` em `assets/statusline.sh` lê `~/.config/claudebar/.update-available`
  (override `CLAUDEBAR_UPDATE_FILE`), renderiza `⬆ v<ver>` em `C_UPDATE` (dourado 220, glyph U+2B06).
  Aparece no fim do `identity_row` e do `compact_row1`. Toggle `CHIP_UPDATE` (default 1). Configurável
  via `[chips] update`, `[colors] update`, `[glyphs] update` (adicionados a VALID_KEYS + default-config).
  +1 unit test `test/unit/test-update-chip.sh` (presente/oculto/ausente/blank/integração).
- ✅ **`config auto-update [patch|all|off]`** — `configAutoUpdate()` em `src/config.js` (set valida e grava;
  sem arg reporta o modo efetivo; gera config.toml default se ausente). Roteado no `main(args)`. Usa o
  helper PURO `setModeInToml(content, mode)` em `auto-update.js` (ativa/substitui a linha onde quer que
  esteja, nunca toca no interval). install.js refatorado p/ reusar o mesmo helper. +4 testes config +4 puros.
- ✅ **doctor** — check `auto-update` reporta `mode=X` + payload+hook presentes (falha→manda rodar update).
  +2 testes em `doctor.test.js`. Help do CLI (`bin/cli.js`) documenta o subcomando.
- ✅ Smoke real: chip renderiza dourado após o branch; `config auto-update all` grava `auto_update = "all"`
  (parse confirma); modo inválido rejeitado sem escrever.

**Total acumulado: 129 testes CLI + 39 bash, 100% green.** Falta só deploy-na-máquina-real + commit/PR.

## Estado ao entrar na sessão nova

- A PR do self-heal (bug 1 + bug 2) já cobre `ensure-statusline.mjs` + dual-event
  (`HEAL_HOOK_EVENTS`) em `src/settings.js`. **Reusar esse padrão** pro auto-update hook.
- `src/update.js` roda o self-heal payload em TODO update (antes do early-return de
  versão) — bom ponto de referência pro fluxo de cópia de assets.
- Node 18+ é requisito (tem `fetch`). Projeto é **dependency-free** (só builtins) —
  manter assim (nada de `semver` npm; escrever um compare simples e testá-lo).
