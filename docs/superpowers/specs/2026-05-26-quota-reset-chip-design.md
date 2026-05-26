# Quota Reset Countdown — Design Spec

| | |
|---|---|
| **Data** | 2026-05-26 |
| **Status** | Aprovado, aguardando implementação |
| **Escopo** | Adicionar countdown "tempo até reset" nos chips 5h e 7d do `fuel_row` |
| **Não-escopo** | Session duration, skip-permissions indicator, OAuth API fallback, extra/overage usage |
| **Branch alvo** | `feat/quota-reset-chip` (criar a partir de `main`) |
| **Tamanho estimado** | ~1.5h impl + tests. PR pequeno. |

---

## 1. Contexto e motivação

`statusline.sh` hoje renderiza, na row 2 (`fuel_row`):

```
ctx ▰▰▱▱▱▱▱▱▱▱ 23%   5h ▰▰▰▰▰▰▱▱▱▱ 64%   7d ▰▰▰▰▰▱▱▱▱▱ 51%
```

O `%` informa **saturação** ("estou perto do limite?") mas não informa **horizonte temporal** ("dá pra trabalhar mais 2 horas ou tenho 20 minutos?"). O usuário precisa abrir `/usage` no Claude Code pra obter o ETA de reset.

**Achado-chave**: as fixtures (`test/fixtures/01-calm.json`) já contêm `rate_limits.{five_hour,seven_day}.resets_at` como Unix timestamp — campo emitido pelo Claude Code mas **descartado** pelo `statusline.sh` atual.

Implementar countdown a partir desse campo é mudança cirúrgica: zero deps novas, zero network, função pura de stdin → texto colorido.

## 2. Não-objetivos

| Feature | Razão da exclusão |
|---------|-------------------|
| Session duration inline (`session 2h15m`) | DESIGN.md original (linha 306) rejeitou: rate-limit bars já comunicam progressão. Reset timer reforça isso. Revisitável em issue futura. |
| Skip-permissions indicator (⚡) | Útil mas independente — abrir branch própria. |
| Extra/overage usage (`$ used`) | Só faz sentido pra plano pay-as-you-go. Não é o caso do user-alvo. |
| OAuth API fallback (`api.anthropic.com/api/oauth/usage`) | Adiciona `curl` como dep, network failure mode, token discovery. Quebra filosofia "zero npm/python". Só justificável se stdin NÃO entregar `resets_at` (verificação one-shot da seção 11). |
| Reset time absoluto (`reset 18:42`) | Countdown relativo é mais útil pra decisão "dá pra continuar?". Tetos práticos (5h max, 7d max) tornam timezone irrelevante. |

## 3. Decisões consolidadas

| Decisão | Valor | Razão |
|---------|-------|-------|
| **Layout** | Countdown ANTES do bar, separador `·`, sem parens | Co-localização semântica (countdown qualifica a window). Parens questionados (noisy); `·` é leve. |
| **Formato** | Magnitude-aware: `3d04h` / `4h12m` / `42m18s` / `45s` / `now` / `30d+` | Sempre 2 unidades, zero-pad menor. Largura previsível ~5 chars. |
| **Cor** | Dim fixo (`C_REPO=245`, mesma cor do label) | Countdown = metadata silenciosa. Bar+% já são o sinal de ação; herdar zona vira redundância (3 vermelhos no chip crítico). |
| **Visibilidade** | Sempre que `resets_at` presente | Simples, previsível. Sem trigger mental. |
| **Fonte dos dados** | Stdin do Claude Code (`rate_limits.*.resets_at`) | Zero deps, zero I/O extra. Verificável em 5min antes de codar. |
| **Clock pra testes** | Env var `CLAUDEBAR_NOW_FOR_TESTING` | Snapshots determinísticos sem mocar `date`. |

## 4. Arquitetura

```
Claude Code stdin JSON
  └─ rate_limits.five_hour.{used_percentage, resets_at}
  └─ rate_limits.seven_day.{used_percentage, resets_at}
            │
            ▼
       main()  ── jq extract (4 vars: pct + resets_at × 2 windows)
            │
            ▼
       fuel_row(... five_hour_resets_at=N, seven_day_resets_at=N)
            │
            ▼
       per chip:  [label] [· countdown if resets_at present] [bar] [pct%]
                                              │
                                              ▼
                                  format_countdown(seconds_remaining)
                                  ├─ ≥ 2592001s → "30d+"     (cap defensivo)
                                  ├─ ≥ 86400s   → "XdYYh"    (zero-pad horas)
                                  ├─ ≥ 60s      → "XhYYm"    (zero-pad ambos; X pode ser 0)
                                  └─ < 60s      → "now"
```

### 4.1 Mudanças no `statusline.sh`

1. **Bloco `jq` ganha 2 linhas** (extração de `RESETS_AT_5H` e `RESETS_AT_7D` com fallback `// ""`).
2. **Novo helper `now_epoch()`** — retorna `$CLAUDEBAR_NOW_FOR_TESTING` se numérico, senão `date +%s`.
3. **Novo helper `format_countdown SECONDS`** — função pura, magnitude-aware (~20 LOC).
4. **`fuel_row` aceita 2 kwargs novas** (`five_hour_resets_at`, `seven_day_resets_at`) e appenda `· $countdown` quando presentes (antes do bar, dim).

### 4.2 Output esperado

**Estado calm** (uso baixo, muito tempo até reset):
```
ctx ▰▰▰▱▱▱▱▱▱▱ 32%   5h · 2h18m  ▰▰▱▱▱▱▱▱▱▱ 18%   7d · 5d09h  ▰▰▱▱▱▱▱▱▱▱ 21%
```

**Estado crítico** (uso alto, pouco tempo restante):
```
ctx ▰▰▰▰▰▰▰▰▱▱ 89%   5h · 0h32m  ▰▰▰▰▰▰▰▰▰▱ 92%   7d · 1d04h  ▰▰▰▰▰▰▰▰▱▱ 88%
```

**Estado pós-reset** (resets_at no passado, stdin desatualizado):
```
ctx ▰▰▰▱▱▱▱▱▱▱ 32%   5h · now    ▰▱▱▱▱▱▱▱▱▱  5%   7d · 5d09h  ▰▰▱▱▱▱▱▱▱▱ 21%
```

## 5. Especificação `format_countdown`

```
format_countdown SECONDS_REMAINING → string

Input:  inteiro (pode ser negativo)
Output: string entre 3-6 caracteres ASCII

Regras (2 níveis + edge cases):
  s < 60                 → "now"     (3 chars)
  60 ≤ s < 86400         → "XhYYm"   (5-6 chars; X pode ser 0)
  86400 ≤ s ≤ 2592000    → "XdYYh"   (5-6 chars)
  s ≥ 2592001            → "30d+"    (4 chars, cap defensivo)
```

**Exemplos por faixa**:

| Segundos | Output | Faixa |
|----------|--------|-------|
| -100, 0, 30, 59 | `now` | s < 60 |
| 60 | `0h01m` | min < 1h |
| 720 (12 min) | `0h12m` | 5h window quase resetando |
| 1920 (32 min) | `0h32m` | 5h window próximo |
| 3600 (1h) | `1h00m` | exatamente 1h |
| 8280 (2h18m) | `2h18m` | uso normal |
| 14880 (4h08m) | `4h08m` | máximo da 5h window |
| 86399 (1d - 1s) | `23h59m` | quase 1 dia |
| 86400 (1 dia) | `1d00h` | exatamente 1 dia |
| 100800 (1d04h) | `1d04h` | 7d uso médio |
| 324000 (3d18h) | `3d18h` | 7d uso baixo |
| 464400 (5d09h) | `5d09h` | 7d quase fresh |
| 604800 (7 dias) | `7d00h` | 7d window máximo |
| 2592001+ | `30d+` | cap defensivo |

**Decisões**:
- **2 níveis de magnitude** (dias+horas OU horas+minutos), NÃO 4 níveis. Razão: 5h window real nunca passa `4h59m`, então pra ela sempre cabe em `XhYYm` (com X possivelmente 0). 7d window vai de `6d23h` até `0h01m` — sempre cabe em um dos 2 formatos. Não precisa de `XXmYYs` ou `XXs` separados.
- **`now` para s < 60** em vez de `0h00m` — comunica "iminente" com mais clareza. Cobre janela de race entre reset real e refresh do stdin.
- **Zero-pad em AMBAS as unidades de `XhYYm`** quando ambas são <10 (`0h09m`, `1h00m`). Razão: `0h32m` mantém forma consistente; mostrar `0h32m` em vez de `0h32m` evita confusão visual.
- **Zero-pad só na unidade menor de `XdYYh`** (`3d04h`, não `03d04h`). Razão: dias podem chegar a 30, então 2 dígitos em "X" não fazem sentido genérico. Hora menor sim, por consistência.
- **Sem espaço entre unidades** (`4h12m`, não `4h 12m`) — preserva "isso é UMA coisa só" visualmente.
- **Largura**: tipicamente 5 chars (`2h18m`, `5d09h`), 6 chars no extremo (`10h05m`, `23h59m`).

## 6. Cor e posição

### 6.1 Paleta

| Elemento | Cor (256-color) | Variável |
|----------|-----------------|----------|
| Label `ctx` / `5h` / `7d` | 245 (cinza claro) | `C_REPO` |
| Separador `·` | 245 | `C_REPO` |
| Countdown (`2h18m`, `now`, `30d+`) | **245** | `C_REPO` (mesma do label) |
| Bar pip filled | 76 / 220 / 196 | `C_BAR_GREEN` / `C_BAR_YELLOW` / `C_BAR_RED` (zona) |
| Bar pip empty | 238 | `C_BAR_DIM` |
| `%` valor | 76 / 220 / 196 | zona (`zone_color`) |

### 6.2 Espaçamento entre elementos

**Chip COM countdown** (5 segmentos):
```
{label} {space} {·} {space} {countdown} {2_spaces} {bar} {space} {pct%}
   5h     ' '   ·   ' '      2h18m      '  '       ▰▰... ' '    18%
```

**Chip SEM countdown** (ex: `ctx`, ou `5h` sem `resets_at`) — 3 segmentos:
```
{label} {space} {bar} {space} {pct%}
  ctx    ' '    ▰▰... ' '     32%
```

**A diferença das 2 spaces vs 1 space é intencional**: o gap maior visualmente agrupa `[label · countdown]` como "metadata cluster" separado do `[bar pct%]` "metric cluster". Quando countdown ausente, o cluster colapsa em só `label` e 1 space basta.

### 6.3 Justificativa cor dim

Hierarquia funcional do chip:
- `bar` = sinal de saturação (ação imediata)
- `%` = quantificação numérica (precisão)
- `countdown` = info de planejamento (metadata)

Funções diferentes merecem peso visual diferente. Três elementos coloridos pela mesma zona seria redundância.

## 7. Edge cases & failure modes

| Cenário | Comportamento |
|---------|---------------|
| `resets_at` ausente no stdin | Hide countdown. Chip renderiza `5h ▰▰▰...▱ 51%` (estado atual preservado). |
| `resets_at: null` ou `0` | Hide silencioso (igual ausente). |
| `resets_at < now` (já resetou) | Mostra `now` em dim. Cobre janela curta entre reset real e refresh do stdin. |
| `resets_at > now + 30 dias` | Mostra `30d+` (cap). Evita render gigante. |
| `used_percentage` ausente, `resets_at` presente | Hide chip 5h/7d inteiro (preserva comportamento atual). |
| `used_percentage` presente, `resets_at` ausente | Renderiza só `5h ▰▰▰ 51%` (sem countdown). |
| `CLAUDEBAR_NOW_FOR_TESTING` set | `now_epoch()` retorna esse valor. Permite snapshots determinísticos. |
| `CLAUDEBAR_NOW_FOR_TESTING` não-numérico | Fallback defensivo a `date +%s`. |
| jq falha / malformed JSON | Cai no `minimal_fallback` existente. Sem mudança. |
| Clock skew (sistema vs server) | Confia no clock local. Skew de minutos é tolerável; skew de horas é problema do user. |

**Garantia geral**: nenhuma adição quebra renderização atual. Se algo der errado no parse/format, o chip retorna ao estado pré-feature (% sem countdown).

## 8. Performance

| Item | Impacto |
|------|---------|
| 2 extrações jq extras (dentro do mesmo invocation) | ~0ms |
| `format_countdown` (aritmética pura) | ~0ms |
| `now_epoch` (1 chamada `date +%s`) | ~0.5ms |
| **Total estimado** | **<1ms** |

Budget atual: 50ms cold, 26ms warm. Folga preservada.

## 9. Testing strategy

### 9.1 Unit tests — `test/unit/test_format_countdown.sh` (novo)

Source `statusline.sh` e testa `format_countdown SECONDS` direto. ~25 casos cobrindo:

| Categoria | Casos representativos |
|-----------|----------------------|
| Edge "now" (s < 60) | `-9999→now`, `-1→now`, `0→now`, `30→now`, `59→now` |
| Transição now → XhYYm | `60→0h01m` (não `now`), `61→0h01m` |
| Faixa XhYYm (X=0) | `60→0h01m`, `720→0h12m`, `1920→0h32m`, `3540→0h59m` |
| Faixa XhYYm (X>0) | `3600→1h00m`, `8280→2h18m`, `14880→4h08m`, `86399→23h59m` |
| Transição XhYYm → XdYYh | `86399→23h59m`, `86400→1d00h` |
| Faixa XdYYh | `86400→1d00h`, `100800→1d04h`, `324000→3d18h`, `464400→5d09h`, `604800→7d00h` |
| Zero-pad em XhYYm | `3601→1h00m` (não `1h0m`), `60→0h01m` (não `0h1m`), `3661→1h01m` |
| Zero-pad em XdYYh | `86460→1d00h` (não `1d0h`), `90000→1d01h` |
| Edge superior | `2592000→30d00h`, `2592001→30d+`, `99999999→30d+` |

### 9.2 Unit tests — `test/unit/test_now_epoch.sh` (novo)

- Sem override → diff < 2s de `date +%s` (sanity)
- Com `CLAUDEBAR_NOW_FOR_TESTING=12345` → retorna `12345`
- Com override vazio → fallback a `date +%s`
- Com override não-numérico (`abc`) → fallback a `date +%s` (defensive)

### 9.3 Fixtures — 3 novas + update das 12 existentes

**Constante única em `test/run-all.sh`**: `export CLAUDEBAR_NOW_FOR_TESTING=1830000000`.

**Fixtures novas**:

| Arquivo | Conteúdo | Countdown esperado |
|---------|----------|-------------------|
| `15-countdown-fresh.json` | 5h: 22%, `resets_at = FROZEN_NOW + 15120` (4h12m). 7d: 45%, `resets_at = FROZEN_NOW + 534240` (6d04h). | `4h12m`, `6d04h` |
| `16-countdown-critical.json` | 5h: 92%, `resets_at = FROZEN_NOW + 720` (12m). 7d: 88%, `resets_at = FROZEN_NOW + 14400` (4h). | `12m00s`, `4h00m` |
| `17-resets-at-missing.json` | 5h: 51%, sem `resets_at`. 7d: 42%, sem `resets_at`. | (nenhum — graceful absence) |

**Updates necessários**: fixtures `01` a `12` (que têm `resets_at` arbitrário hoje) precisam recalcular `resets_at = FROZEN_NOW + offset` consistente com o "mood" da fixture. Heurística de offsets:

| Mood da fixture | Offset 5h sugerido | Offset 7d sugerido | Output esperado |
|-----------------|--------------------|--------------------|------------------|
| `*-calm` (uso baixo) | `15120` (4h12m) | `534240` (6d04h) | "muito tempo, relaxado" |
| `*-caution` (uso médio) | `7200` (2h00m) | `324000` (3d18h) | "metade da window" |
| `*-danger` (uso alto) | `1920` (32m) | `100800` (1d04h) | "fim da window próximo" |
| Outras (PR, agent, tmux, no-*) | usar o mood mais próximo | idem | preservar coerência |

Regerar `test/expected/*.txt` correspondentes. Fixtures `13` e `14` (sem rate_limits) — zero mudança.

### 9.4 Regressão

- `13-no-rate-limits.json` e `14-no-rate-limits-no-pr.json`: output **idêntico** ao atual. Teste de regressão (countdown não vaza pra chips inexistentes).
- `17-resets-at-missing.json`: prova que `%` sem `resets_at` renderiza igual ao "antes da feature".

### 9.5 Performance — `test/perf.sh`

Rerun. Validar `<50ms warm`. Esperado `~26-27ms` (delta <1ms vs hoje).

### 9.6 Portabilidade — `test/portability.sh`

Nada novo. `date +%s` é portable POSIX. Aritmética inteira de epoch também.

## 10. Arquivos afetados

| Arquivo | Mudança | LOC estimado |
|---------|---------|-------------|
| `statusline.sh` | Helpers + jq + fuel_row | +30 |
| `test/unit/test_format_countdown.sh` | Novo | ~80 |
| `test/unit/test_now_epoch.sh` | Novo | ~30 |
| `test/fixtures/15-countdown-fresh.json` | Novo | ~16 |
| `test/fixtures/16-countdown-critical.json` | Novo | ~16 |
| `test/fixtures/17-resets-at-missing.json` | Novo | ~14 |
| `test/fixtures/01-12*.json` | Recalcular `resets_at` | (alteração pontual) |
| `test/expected/01-12*.txt` | Regerar com countdown | (snapshot) |
| `test/run-all.sh` | Export `CLAUDEBAR_NOW_FOR_TESTING` | +1 |
| `DESIGN.md` | Seção "Countdown semantics" + atualizar tabela de fields | +30 |
| `CHANGELOG.md` | Entrada v1.1.0 | +5 |
| `README.md` | Mencionar countdown no features list | +2 |

## 11. Verificação one-shot pré-implementação

**Bloqueador**: o plano todo assume que Claude Code real envia `rate_limits.*.resets_at` no stdin. As fixtures têm — mas fixture ≠ realidade.

**Protocolo de verificação** (5min, antes de qualquer commit de impl):

1. Editar `statusline.sh` localmente, adicionar 1 linha no início do `main()`:
   ```bash
   tee /tmp/claudebar-stdin-debug.json
   ```
   (substitui `input=$(cat)` por `input=$(tee /tmp/claudebar-stdin-debug.json)`)

2. Acionar render em sessão Claude Code real (qualquer mensagem assistant).

3. Inspecionar:
   ```bash
   jq '.rate_limits' /tmp/claudebar-stdin-debug.json
   ```

4. **Decisão**:
   - **`resets_at` presente** → reverter debug, seguir plano.
   - **`resets_at` ausente** → escalar pro Plan B (OAuth endpoint cacheado) e refazer este spec.

## 12. Out of scope / future work

| Item | Razão de adiamento |
|------|-------------------|
| Session duration | Rejeitado em DESIGN.md original; reset timer cobre o caso de planejamento. Revisitar se houver demanda. |
| Skip-permissions indicator (⚡) | Independente — abrir branch própria. ~5 LOC. |
| Extra/overage `$ usage` | Só pra pay-as-you-go (não é o caso atual). |
| OAuth fallback | Só se verificação §11 falhar. |
| Reset absoluto (`reset 18:42`) | Toggle config futuro se houver pedido. |
| Multi-row fuel_row (1 chip por linha) | Quebra filosofia 2-row do DESIGN.md. |

## 13. Referências

- Implementação atual: [`statusline.sh`](../../../statusline.sh)
- Filosofia & decisões originais: [`DESIGN.md`](../../../DESIGN.md)
- Análise comparativa (ccstatusline + claude-statusline + claudebar): conversa de brainstorming 2026-05-26
- Preview de cores rodável: `/tmp/claudebar-color-preview.sh` (criado durante brainstorming, descartável)
- Fixtures existentes: [`test/fixtures/`](../../../test/fixtures/)
- Endpoint OAuth (Plan B, caso necessário): `https://api.anthropic.com/api/oauth/usage`
