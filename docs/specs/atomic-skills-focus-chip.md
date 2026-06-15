# Spec — `project_chip` (consumidor do `focus.json` do atomic-skills)

> Initiative: `atomic-skills-focus-chip`. Consumidor no claudebar do contrato
> publicado pela skill `atomic-skills:project`. **Desktop-only** (layout `full`).
>
> Contrato canônico: `~/atomic-skills/meta/schemas/focus.schema.json`
> Spec do produtor: `~/atomic-skills/docs/design/statusline-focus-integration.md`
> Handoff original (consumidor): `docs/atomic-skills-focus-integration.md`

## 1. Objetivo

A cada render, ler **um** arquivo plano `<git-root>/.atomic-skills/focus.json` e
mostrar um chip glanceável:

```
◇ atomic-skills-focus-chip · F0 1/1 · 0/5
└GLYPH_PROJECT  └plano (slug)         └fase i/n  └tasks done/total
```

Estados: fresco · com bloqueio (`⚠N`, cor blocked) · com drift (`⌁`) · stale (`~`, cor dim).

Não-objetivos: mostrar no `compact`; calcular qualquer coisa da árvore YAML; mostrar
`nextAction` (longo demais — fica no dashboard).

## 2. Contrato consumido (resumo do schema)

`focus.json` (`additionalProperties:false`), campos usados pelo chip:
`schemaVersion` (const `"0.1"`), `plan {slug,title,status}|null`,
`phase {id,index,total,...}|null`, `tasks {done,total,blocked}`,
`flags {drift,...}`, `sources[] {path, lastUpdated}`.

Estados especiais → **renderiza nada** (no-op, fail-open):
- arquivo ausente (caso comum p/ usuários sem atomic-skills → default **on** é seguro);
- `plan: null` (sem plano ativo);
- `schemaVersion != "0.1"` (versão desconhecida → degradar gracioso, nunca quebrar);
- jq falha / JSON inválido.

## 3. Correções sobre o snippet do handoff/produtor (por que reimplementar)

Os snippets bash do handoff e do spec do produtor **não rodam como estão**:

1. **Separadores do `jq` perdidos.** Usam `join("")`, `+ "" +`, `IFS=$'\0'` — os control
   chars `\001/\002/\003` viraram strings vazias na transcrição, então não há delimitador e
   `read`/`tr` não separam nada. Além disso o bash **não aceita NUL (`\0`) como `IFS`**.
   → **Correção:** `jq ... | @tsv`. 1ª linha = campos de render (TAB-sep, escaping nativo do
   `@tsv`); linhas seguintes = um source por linha (`path<TAB>lastUpdated`). `\n` separa
   registros, TAB separa colunas. Robusto, bash-3.2 compatível, sem control chars frágeis.
2. **`$GIT_ROOT` inexistente.** `statusline.sh` nunca computa o git-root (só faz
   `git rev-parse --git-dir` como probe booleano) e `identity_row` não o recebe.
   → **Correção:** computar `git rev-parse --show-toplevel` em `main()` (só quando
   `CHIP_PROJECT` on) e passar `git_root=` para `identity_row`.
3. **Campo de staleness.** O contrato usa `lastUpdated:` (camelCase, layout nested). O claudebar
   está em layout flat-legado (`last_updated:`). → **Correção:** grep tolerante a ambos
   (`^(lastUpdated|last_updated):`) — superset do contrato; habilita dogfood no próprio repo.

## 4. `project_chip()` — comportamento

Assinatura: `project_chip <git-root>`. Espelha `update_chip()`.

```
1. (( CHIP_PROJECT )) || return 0
2. f="$root/.atomic-skills/focus.json"; [[ -f "$f" ]] || return 0
3. data = jq -r '<filtro @tsv>' "$f" 2>/dev/null   # falha → return 0
4. 1ª linha "SKIP" (plan null OU schemaVersion!=0.1) → return 0
5. parse 1ª linha (TAB): slug pid pidx ptot tdone ttot tblk drift
6. para cada linha-source restante (path<TAB>recorded):
     sf="$root/$path"
     [[ ! -f "$sf" ]] → stale; break
     current = grep -m1 -E '^(lastUpdated|last_updated):' | strip
     [[ -n "$current" && "$current" != "$recorded" ]] → stale; break
     (current vazio = indeterminado → NÃO marca stale; evita falso-stale)
7. render:
     slug truncado a 18 chars + "…"
     body = "◇ <slug> · <pid> <pidx>/<ptot> · <tdone>/<ttot>"
     tblk>0 → body += " ⚠<tblk>" ; color = C_PROJECT_BLOCKED
     drift==true → body += " ⌁" (GLYPH_DRIFT)
     stale → color = C_PROJECT_STALE ; body += " ~"
     fg "$color" "$body"
```

Filtro jq:

```jq
if (.plan == null) or (.schemaVersion != "0.1") then "SKIP"
else
  ([ .plan.slug, (.phase.id // ""), (.phase.index // 0 | tostring),
     (.phase.total // 0 | tostring), (.tasks.done // 0 | tostring),
     (.tasks.total // 0 | tostring), (.tasks.blocked // 0 | tostring),
     (.flags.drift // false | tostring) ] | @tsv),
  ( .sources[]? | [ .path, (.lastUpdated // "") ] | @tsv )
end
```

## 5. Placement

Em `identity_row()`, **após** o grupo repo/branch/dirty e **antes** do chip de PR — o
foco de projeto é estado de repositório e lê melhor junto do estado git. (Diverge do D2 do
produtor, "antes de tmux"; o grupo de sessão model/effort/agent/tmux fica mais coeso e o
chip de foco ganha o seu próprio grupo `·`.) Segue a regra de ownership de separador: o chip
dona o `·` que o precede. **Nunca** chamado de `compact_row*`.

`main()` computa o git-root e passa `git_root=`:
```bash
local GIT_ROOT=""
if (( CHIP_PROJECT )) && have git && git rev-parse --git-dir >/dev/null 2>&1; then
    GIT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
fi
# ... identity_row ... git_root="$GIT_ROOT"
```

## 6. Config (TOML → bash)

- `assets/statusline.sh`: `readonly CHIP_PROJECT=${CHIP_PROJECT:-1}`; cores
  `C_PROJECT` (39), `C_PROJECT_STALE` (244), `C_PROJECT_BLOCKED` (220); glifos
  `GLYPH_PROJECT` (◇) e `GLYPH_DRIFT` (⌁) — byte-escapes, igual `GLYPH_UPDATE`.
- `src/toml-parser.js` (validação): `project` em `chips`; `project`/`project_stale`/
  `project_blocked` em `colors`; `project`/`drift` em `glyphs`.
- `assets/toml-parser.sh` e `src/config-compiler.js`: **sem mudança** — mapeiam
  qualquer chave genericamente (`C_PROJECT`, `GLYPH_DRIFT`, `CHIP_PROJECT`).
- `assets/default-config.toml`: entradas comentadas com os defaults.

## 7. Performance (orçamento <50ms)

`[[ -f ]]` + 1 `jq` + até 2×`grep -m1`. Arquivo ausente: 1 `stat` falho ⇒ ~0.
Validar com `test/perf.sh` com o chip ligado.

## 8. Testes

- `test/unit/test-project-chip.sh`: source `statusline.sh`, chama `project_chip "$tmp"`
  com `.atomic-skills/focus.json` montado em tmpdir. Estados: fresco, blocked, drift,
  stale (par focus.json + source com `last_updated` divergente), null-plan, ausente,
  schemaVersion desconhecida, `CHIP_PROJECT=0`.
- Fixtures `test/fixtures/focus-*.json` (reuso pelos asserts).
- Perf: `test/perf.sh` permanece <50ms com `CHIP_PROJECT=1`.

## 9. Dogfood

Autorar `.atomic-skills/focus.json` real do claudebar refletindo a initiative
`atomic-skills-focus-chip` (degenerada 1-fase F0), `sources[]` → o arquivo da
initiative (campo `last_updated`). O chip acende ao vivo enquanto construímos.
