---
initiative_id: overlay-time-marker
status: active
started: 2026-06-17
last_updated: 2026-06-17T14:05:00Z
branch: feat/overlay-time-marker
worktree:
plan_link:
summary: "Marcador de tempo (│) das barras 5h/7d vira OVERLAY: ocupa 1 das N células em vez de inserido; cinza até ser alcançado, cor da zona ao ser consumido."
wip_limit: 2
scope_paths:
  - assets/statusline.sh
  - test/unit/test-pip-bar.sh
  - test/unit/test-pip-bar-compact.sh
  - test/unit/test-compact-rows.sh
  - test/fixtures/
  - test/expected/

stack:
  - {id: 1, title: "Converter o marcador de tempo de INSERIDO para OVERLAY (pipe = célula, cinza→cor-da-zona ao ser alcançado) em pip_bar + pip_bar_compact, via TDD", type: initiative, opened_at: 2026-06-17T13:40:00Z}

tasks:
  T1: {id: T1, title: "RED: reescrever testes de marcador (overlay 10/5 cels) + testes de cor do pipe (cinza não-alcançado / zona alcançado) em test-pip-bar.sh e test-pip-bar-compact.sh", status: done, closed_at: 2026-06-17T13:55:00Z, last_updated: 2026-06-17T13:55:00Z}
  T2: {id: T2, title: "GREEN: pip_bar + pip_bar_compact — marcador overlay (│ ocupa célula marker; filled>marker → zone_color, senão C_REPO), clamp 0..N-1", status: done, closed_at: 2026-06-17T14:00:00Z, last_updated: 2026-06-17T14:00:00Z}
  T3: {id: T3, title: "Regenerar fixtures golden afetadas (largura do marcador caiu de N+1 para N) + rodar suíte completa", status: done, closed_at: 2026-06-17T14:05:00Z, last_updated: 2026-06-17T14:05:00Z}

parked: []

emerged: []

next_action: "Implementação COMPLETA na branch feat/overlay-time-marker. 203 CLI + 42 bash/fixtures verde, 0 falhas. DESIGN.md atualizado. Pronto para commit + PR + release (aguardando o OK do usuário)."
---

# overlay-time-marker — pipe do tempo como célula (overlay), não inserido

## Contexto

As barras 5h/7d têm um marcador de tempo (`│`) que hoje é **INSERIDO** entre os
pips (`pip_bar`/`pip_bar_compact` em `assets/statusline.sh`): a régua fica com
N+1 caracteres (10 pips + 1 pipe) e o pipe vive *fora* da grade de células, com
cor fixa `C_REPO`. Isso gerou: (a) o problema de largura já corrigido em
v1.3.3/1.3.4 (o pipe alargava cada chip em 1 célula); (b) ambiguidade de leitura
— "encostou" vs "passou" não se distinguia bem.

## Decisão (validada visualmente — Opção B dos previews)

O marcador vira **OVERLAY**: ocupa **uma das N células** (régua fixa em N). O `│`
substitui o pip da célula `marker`. Regra de cor:

- **não alcançado** (`filled <= marker`): pipe **cinza** (`C_REPO`). Inclui o caso
  "encostou" (`filled == marker`): blocos antes do pipe cheios, mas o pipe ainda
  não foi consumido → não chegou.
- **alcançado/passou** (`filled > marker`): pipe na **cor da zona** (`zone_color`:
  verde <60 / amarelo 60-89 / vermelho ≥90). "Para chegar no pipe, ele tem que
  ficar diferente."

`marker` agora é um **índice de célula** em `[0, N-1]` (clamp interno), não mais um
slot `[0, N]`. Mantém-se a fórmula `elapsed*N/WINDOW` nos callers.

## Consequências

- Largura do marcador cai de **N+1 → N** (resolve de vez a fragilidade de largura;
  o pip "sob" o pipe é substituído pelo `│`, não somado).
- A cor do pipe passa a carregar informação (não é mais enfeite cinza fixo): a
  faixa de ~10% em que o pipe esconde o próprio preenchimento é desambiguada pela
  transição cinza→cor.
- Fixtures golden com marcador ativo mudam (largura/seq) → regenerar.

## Previews validados (throwaway, /tmp)

- `claudebar-pipe-preview.sh`, `-geometry.sh`, `-overlay.sh`, `-10cell.sh` —
  usados na discussão; geometria INSERIDO vs OVERLAY e opções de cor.

## Testabilidade

- Glifos (string ANSI-stripped): posição do `│` na célula + largura N.
- Cor (inspeção ANSI): `C_REPO` quando não alcançado, `zone_color` quando passou.
