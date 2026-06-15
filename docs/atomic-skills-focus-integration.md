# Handoff — indicador de foco do `atomic-skills:project` no claudebar

> **Status: IMPLEMENTADO e shipado** (branch `feat/atomic-skills-focus-chip`).
> Este doc descreve o **consumidor real** (não é mais spec a implementar). Fonte de
> verdade do consumidor: `docs/specs/atomic-skills-focus-chip.md`. Contrato do
> produtor: `~/atomic-skills/docs/design/statusline-focus-integration.md` +
> `~/atomic-skills/meta/schemas/focus.schema.json`.
>
> **Produtor** (repo `~/atomic-skills`): emite `.atomic-skills/focus.json` a cada
> mutação de estado + SessionStart/Stop.
>
> **Decisão de produto:** chip **desktop-only** (layout `full`). NÃO renderiza no
> `compact` (mobile) — sem espaço vertical.

---

## 1. O que é

A skill `atomic-skills:project` rastreia trabalho em 3 níveis (plano → fase → task) e
publica uma **projeção plana**, `.atomic-skills/focus.json`. O claudebar lê **um**
arquivo e renderiza um chip glanceável "onde estou", sem andar na árvore YAML.

O chip vive na **2ª linha** (`fuel_row`, após os medidores ctx/5h/7d — mais espaço
horizontal que a linha 1):

```
ctx ▰▰▰▱▱▱▱▱▱▱ 31%   5h ▰▱▱▱▱▱▱▱▱▱ 12%   7d ▰▰▰▰▱▱▱▱▱▱ 40%   ◉ atomic-skills-focus-chip · F0 1/1 · 5/5
                                                              └glifo └plano (id completo)  └fase i/n └tasks done/total
```

---

## 2. O contrato: `.atomic-skills/focus.json`

Arquivo único, plano, na **raiz do repo**. Paths em `sources[]` são relativos à raiz.
Schema canônico: `~/atomic-skills/meta/schemas/focus.schema.json`. Exemplo:

```json
{
  "schemaVersion": "0.1",
  "generatedAt": "2026-06-15T18:45:00Z",
  "projectId": "atomic-skills",
  "plan":  { "slug": "skills-restructuring", "title": "Reestruturação das skills", "status": "active" },
  "phase": { "id": "F0", "slug": "...", "title": "Pente fino", "index": 1, "total": 6, "status": "active" },
  "tasks": { "done": 0, "total": 7, "blocked": 0 },
  "gates": { "met": 0, "total": 1 },
  "nextAction": "Start T0.1: ...",
  "flags": { "drift": false, "multipleActivePlans": true },
  "sources": [
    { "path": ".atomic-skills/projects/.../plan.md", "lastUpdated": "2026-06-15T16:29:10Z" },
    { "path": ".atomic-skills/projects/.../phases/f0-....md", "lastUpdated": "2026-06-15T13:54:20Z" }
  ]
}
```

Estados especiais → **renderiza nada** (no-op, fail-open):
- **arquivo ausente** (caso comum p/ usuários sem atomic-skills → **default on** é seguro);
- **`plan: null`** (sem plano ativo);
- **`schemaVersion != "0.1"`** (versão desconhecida → degrada, nunca quebra);
- jq falha / JSON inválido.

Campos `phase`, `tasks`, `gates` podem ser `null` no schema — o consumidor usa
fallbacks (`// 0`, `// false`) e **não crasha** nesses casos.

---

## 3. Frescor: o bloco `sources` (oráculo de staleness, camada 4)

`focus.json` é dado **derivado**. O produtor regenera em write-through + hooks
SessionStart/Stop — cobre o que acontece dentro do Claude Code. **Não cobre:**
`git checkout`/`merge` no meio da sessão, edição em editor externo, outro processo.

O consumidor fecha isso **sem regenerar**: para cada `source`, relê a linha
`lastUpdated:` do frontmatter e compara string-a-string com o valor gravado.
Bateu → mostra os números; não bateu (ou source sumiu) → glifo stale (`~`, cor dim).

- **`lastUpdated`, NÃO mtime** — `git checkout` reseta mtime → daria falso-stale.
  `lastUpdated` é conteúdo (viaja com o git, bumpado em toda mutação).
- O consumidor aceita **`lastUpdated:` E `last_updated:`** (camelCase do layout nested
  do produtor + snake_case do layout flat legado) — superset do contrato.
- **Comparação só quando ambos os lados têm valor** — lado vazio = indeterminado →
  assume fresco (evita falso-stale por divergência de layout). Source ausente → stale.

---

## 4. Implementação no `statusline.sh` (shipado)

Espelha `update_chip()`: arquivo existe → renderiza; senão `return 0`. O **git-root é
resolvido sem subprocesso** (`resolve_git_root`, walk em bash a partir do CWD — mais
barato que `git rev-parse --show-toplevel`, importa porque roda a cada render).

```bash
# resolve_git_root DIR — walk up from DIR; prints first ancestor with a .git entry.
resolve_git_root() {
    local d=$1 prev
    while [[ -n "$d" && "$d" != "/" ]]; do
        [[ -e "$d/.git" ]] && { printf '%s' "$d"; return 0; }
        prev=$d; d=${d%/*}
        [[ "$d" == "$prev" ]] && break   # relative path, no slash → stop (no infinite loop)
    done
    [[ -e "/.git" ]] && { printf '/'; return 0; }
    return 1
}

# project_chip ROOT — desktop-only; called from fuel_row() (row 2).
project_chip() {
    (( CHIP_PROJECT )) || return 0
    local root=$1
    [[ -n "$root" ]] || return 0
    local f="$root/.atomic-skills/focus.json"
    [[ -f "$f" ]] || return 0
    have jq || return 0

    # One jq pass. Line 1 = render fields joined by U+001F (unit separator — a
    # NON-whitespace char, so bash `read` does NOT collapse empty fields; a TAB
    # would, and a schema-valid empty phase.id would then shift every column).
    # Following lines = one source each as "path<US>lastUpdated".
    local US=$'\037' data
    data=$(jq -rj '
        def row: join("\u001f");
        if (.plan == null) or (.schemaVersion != "0.1") then "SKIP\n"
        else
          ([ .plan.slug, (.phase.id // ""), (.phase.index // 0 | tostring),
             (.phase.total // 0 | tostring), (.tasks.done // 0 | tostring),
             (.tasks.total // 0 | tostring), (.tasks.blocked // 0 | tostring),
             (.flags.drift // false | tostring),
             (.flags.multipleActivePlans // false | tostring) ] | row), "\n",
          ( [ .sources[]? | [ .path, (.lastUpdated // "") ] | row ] | join("\n") )
        end' "$f" 2>/dev/null) || return 0
    [[ -z "$data" || "$data" == "SKIP" ]] && return 0

    local slug="" pid="" pidx="" ptot="" tdone="" ttot="" tblk="" drift="" multi=""
    local stale=0 first=1 line path recorded current
    while IFS= read -r line; do
        if (( first )); then
            IFS=$US read -r slug pid pidx ptot tdone ttot tblk drift multi <<<"$line"
            first=0; continue
        fi
        [[ -z "$line" ]] && continue
        (( stale )) && continue
        IFS=$US read -r path recorded <<<"$line"
        [[ -z "$path" ]] && continue
        local sf="$root/$path"
        if [[ ! -f "$sf" ]]; then stale=1; continue; fi
        current=$(grep -m1 -E '^(lastUpdated|last_updated):' "$sf" \
                  | sed -E 's/^[^:]+:[[:space:]]*//; s/[[:space:]]+$//; s/^["'\'']//; s/["'\'']$//')
        [[ -n "$current" && -n "$recorded" && "$current" != "$recorded" ]] && stale=1
    done <<<"$data"

    [[ -z "$slug" ]] && return 0
    [[ "$tblk" =~ ^[0-9]+$ ]] || tblk=0
    [[ "$drift" == "true" ]] || drift=false

    # Full id by default (row 2 has room); PROJECT_SLUG_MAX>0 caps as a guard.
    local max=${PROJECT_SLUG_MAX:-0} slug_disp=$slug
    if (( max > 0 )) && (( ${#slug} > max )); then slug_disp=${slug:0:max}"…"; fi
    local marker=""; [[ "$multi" == "true" ]] && marker=" ${GLYPH_MULTIPLAN}"
    local body="${GLYPH_PROJECT} ${slug_disp}${marker} · ${pid} ${pidx}/${ptot} · ${tdone}/${ttot}"
    (( tblk > 0 )) && body+=" ⚠${tblk}"
    [[ "$drift" == "true" ]] && body+=" ${GLYPH_DRIFT}"

    local color=$C_PROJECT
    (( tblk > 0 )) && color=$C_PROJECT_BLOCKED
    if (( stale )); then color=$C_PROJECT_STALE; body+=" ~"; fi
    fg "$color" "$body"
}
```

Render por estado:

| estado | saída |
|--------|-------|
| fresco | `◉ atomic-skills-focus-chip · F0 1/6 · 0/7` |
| com bloqueio | `◉ … · F0 1/6 · 2/7 ⚠1` (cor blocked) |
| com drift | `◉ … · F0 1/6 · 3/7 ⌁` |
| **stale** | `◉ … · F0 1/6 · 0/7 ~` (cor dim) |
| **>1 plano ativo** | `◉ atomic-skills-focus-chip  · F0 1/6 · 0/7` (marcador `` após o slug) |

### Placement

Em `fuel_row()` (linha 2), **após** os medidores e antes do `\n` final. O git-root é
computado em `main()` (só quando `CHIP_PROJECT` on) e passado como `git_root=`:

```bash
# em main(), junto da derivação de BRANCH/DIRTY:
local GIT_ROOT=""
if (( CHIP_PROJECT )) && [[ -n "$CWD" ]]; then
    GIT_ROOT=$(resolve_git_root "$CWD") || GIT_ROOT=""
fi
# ... fuel_row ... git_root="$GIT_ROOT"

# em fuel_row(), após os 3 bars:
if (( CHIP_PROJECT )) && [[ -n "$git_root" ]]; then
    local proj; proj=$(project_chip "$git_root")
    [[ -n "$proj" ]] && { printf '   '; printf '%s' "$proj"; }
fi
```

**NÃO** renderiza em `compact_row1/2/3` — desktop-only.

---

## 5. Config (TOML → bash)

- `assets/statusline.sh`: `readonly CHIP_PROJECT=${CHIP_PROJECT:-1}`; cores
  `C_PROJECT` (39), `C_PROJECT_STALE` (244), `C_PROJECT_BLOCKED` (220); glifos
  `GLYPH_PROJECT` (U+F192 nf-fa-dot-circle-o), `GLYPH_DRIFT` (U+2301 ⌁),
  `GLYPH_MULTIPLAN` (U+F0C5 nf-fa-clone) — byte-escapes, como os demais glifos.
- `src/toml-parser.js` (validação): `project` em `chips`; `project`/`project_stale`/
  `project_blocked` em `colors`; `project`/`drift`/`multiplan` em `glyphs`.
- `assets/toml-parser.sh` e `src/config-compiler.js`: **sem mudança** — mapeiam
  qualquer chave genericamente (`CHIP_PROJECT`, `C_PROJECT*`, `GLYPH_*`).
- `assets/default-config.toml`: entradas comentadas (glifos PUA ficam `""`, mesma
  convenção de pencil/git/tmux; o default real vem dos bytes no `statusline.sh`).

---

## 6. Performance (orçamento <50ms/render)

`[[ -f ]]` + 1 `jq` + até N×`grep -m1`. **Sem subprocesso git** (git-root via walk em
bash). Arquivo ausente: alguns `stat` + 1 `[[ -f ]]` falho ⇒ ~0. Validado em
`test/perf.sh` com o chip on (dentro do orçamento).

---

## 7. Testes

`test/unit/test-project-chip.sh` (self-contained): faz `source statusline.sh` e chama
`project_chip "$tmp"` com `.atomic-skills/focus.json` montado em tmpdir. Casos: fresco,
blocked, drift, **multipleActivePlans**, stale (source ausente + `lastUpdated` divergente),
`last_updated` legado, **phase:null** (regressão — não crasha), `plan.slug` vazio,
`recorded` vazio, id completo, `PROJECT_SLUG_MAX`, null-plan, schemaVersion desconhecida,
`CHIP_PROJECT=0`, arquivo ausente, root vazio.

> **NÃO** usar `test/fixtures/focus-*.json`: aquele diretório é o runner de fixtures de
> input do statusline (roda contra snapshots) e tentaria executá-los como testes. Os
> fixtures de foco ficam inline no unit test. `test/run-fixture.sh` seta `CHIP_PROJECT=0`
> para o chip (estado de repo) não vazar nos snapshots.

`test/glyph-preview.sh`: helper de dev para comparar candidatos de glifo renderizados.

---

## 8. Checklist de PR

- [x] `project_chip()` em `statusline.sh`, chamado só de `fuel_row()` (linha 2)
- [x] staleness por `lastUpdated`/`last_updated` (não mtime); source ausente → stale; lado vazio → fresco
- [x] git-root via `resolve_git_root` (walk em bash, sem subprocesso; âncora = raiz, não CWD)
- [x] separador jq = U+001F (não TAB) — preserva campos vazios (`phase:null` não crasha)
- [x] id completo por default (`PROJECT_SLUG_MAX` opt-in)
- [x] `CHIP_PROJECT` + cores/glifos no config (TOML + toml-parser.js + statusline.sh)
- [x] no-op gracioso: arquivo ausente, `plan:null`, `schemaVersion` desconhecida, JSON inválido
- [x] marcador `` (nf-fa-clone) quando `flags.multipleActivePlans`
- [x] fixtures inline + perf <50ms com o chip on
- [x] **não** renderiza em `compact_row*`
- [x] review 2 camadas (1 CRITICAL `phase:null` + correções) — verdict SHIP
