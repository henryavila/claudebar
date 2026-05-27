#!/usr/bin/env bash
# Minimal TOML → bash variable compiler for claudebar config.
# Supports: [section] headers, key = value, # comments, booleans.
# Does NOT support: nested tables, arrays, multi-line strings.
# Uses tr for uppercasing (bash 3.2 compatible).

compile_config() {
    local file=$1
    local section=""

    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%%#*}"
        line=$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        [[ -z "$line" ]] && continue

        if [[ "$line" =~ ^\[([a-z_]+)\]$ ]]; then
            section="${BASH_REMATCH[1]}"
            continue
        fi

        if [[ "$line" =~ ^([a-z_]+)[[:space:]]*=[[:space:]]*(.*) ]]; then
            local key="${BASH_REMATCH[1]}"
            local val="${BASH_REMATCH[2]}"
            val=$(printf '%s' "$val" | sed "s/^[\"']//;s/[\"']$//;s/[[:space:]]*$//")
            local upper_key
            upper_key=$(printf '%s' "$key" | tr '[:lower:]' '[:upper:]')

            case "$section" in
                colors)
                    local var
                    case "$key" in
                        effort_high)  var="C_EFFORT_HI" ;;
                        effort_xhigh) var="C_EFFORT_XHI" ;;
                        separator)    var="C_SEP" ;;
                        *)            var="C_${upper_key}" ;;
                    esac
                    printf '%s=%s\n' "$var" "$val"
                    ;;
                thresholds) printf 'THRESHOLD_%s=%s\n' "$upper_key" "$val" ;;
                chips)
                    case "$val" in
                        true)  val=1 ;; false) val=0 ;;
                    esac
                    printf 'CHIP_%s=%s\n' "$upper_key" "$val"
                    ;;
                layout) printf 'LAYOUT_%s=%s\n' "$upper_key" "$val" ;;
                glyphs) printf 'GLYPH_%s=%s\n' "$upper_key" "$val" ;;
            esac
        fi
    done < "$file"
}
