#!/usr/bin/env bash
# Dev helper — preview candidate glyphs for the project focus chip, rendered in
# YOUR terminal's Nerd Font. Run it in a real shell (not via a tool result) so
# the Private-Use-Area glyphs actually render:
#
#     bash test/glyph-preview.sh
#
# Each row shows: index · the glyph · the full chip mock (in chip color) ·
# codepoint + Nerd Font name + concept. A box/▯/tofu means that glyph is NOT in
# your installed Nerd Font — pick one that renders cleanly.
set -uo pipefail

esc=$'\033'
C_PROJECT=${C_PROJECT:-39}        # same default as the statusline chip
DIM=240
SLUG="atomic-skills-focus-chip"   # full id, as it renders on row 2
TAIL="· F0 1/1 · 5/5"

# index | codepoint(hex) | nf name | concept
glyphs=(
  "25C7|◇  (U+25C7)|losango Unicode — o do handoff (NÃO Nerd Font, neutro)"
  "F140|nf-fa-bullseye (U+F140)|alvo concêntrico = FOCO  ← recomendado"
  "F192|nf-fa-dot-circle-o (U+F192)|alvo preenchido = foco (variante mais cheia)"
  "F05B|nf-fa-crosshairs (U+F05B)|mira = focar/apontar"
  "F0E8|nf-fa-sitemap (U+F0E8)|hierarquia plano→fase→task"
  "F024|nf-fa-flag (U+F024)|marco / objetivo"
  "F11E|nf-fa-flag-checkered (U+F11E)|linha de chegada / meta"
  "F14E|nf-fa-compass (U+F14E)|orientação / 'você está aqui'"
  "F041|nf-fa-map-marker (U+F041)|pin de localização"
  "F124|nf-fa-location-arrow (U+F124)|seta de posição"
  "F02E|nf-fa-bookmark (U+F02E)|marcador"
  "F0AE|nf-fa-tasks (U+F0AE)|lista de tarefas"
  "F219|nf-fa-diamond (U+F219)|losango Nerd Font (se gostou da forma do ◇)"
  "F135|nf-fa-rocket (U+F135)|lançamento / iniciativa"
  "F277|nf-fa-map-signs (U+F277)|placa / roadmap"
)

printf '\n  Candidatos para o glifo do chip de foco — escolha pelo índice:\n\n'
i=1
for entry in "${glyphs[@]}"; do
    IFS='|' read -r cp label concept <<<"$entry"
    glyph=$(printf "\u$cp")
    # rendered chip mock, in chip color
    chip="${esc}[38;5;${C_PROJECT}m${glyph} ${SLUG} ${TAIL}${esc}[0m"
    # index + glyph alone (so width/tofu is obvious) + mock + metadata
    printf '  %2d.  [%s]   %s\n' "$i" "$glyph" "$chip"
    printf '       %s[38;5;%dm%s — %s%s[0m\n\n' "$esc" "$DIM" "$label" "$concept" "$esc"
    i=$((i+1))
done

printf '  Me diga o número (ou o nome) do que você quer e eu fixo no statusline.\n\n'
