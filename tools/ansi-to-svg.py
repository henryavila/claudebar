#!/usr/bin/env python3
"""Convert ANSI-colored text (with 256-color FG/BG support) to SVG.

Usage:
    cat input.ansi | tools/ansi-to-svg.py [TITLE] > output.svg

Limitations:
- Only handles 256-color FG (codes 38;5;N) and BG (codes 48;5;N) + reset (0).
- Does NOT handle bold, blink, italic, underline (silently ignored).
- Nerd Font private-use glyphs (U+E000-F8FF) only render if viewer has a Nerd Font.
"""
import html
import re
import sys

# 256-color palette
LEVELS = [0, 95, 135, 175, 215, 255]
BASIC_COLORS = [
    "#000000", "#cd0000", "#00cd00", "#cdcd00",
    "#1e90ff", "#cd00cd", "#00cdcd", "#e5e5e5",
    "#7f7f7f", "#ff5555", "#50fa7b", "#ffff55",
    "#5c5cff", "#ff79c6", "#8be9fd", "#ffffff",
]


def color256(n: int) -> str:
    if n < 16:
        return BASIC_COLORS[n]
    if n < 232:
        n0 = n - 16
        r = LEVELS[n0 // 36]
        g = LEVELS[(n0 // 6) % 6]
        b = LEVELS[n0 % 6]
        return f"#{r:02x}{g:02x}{b:02x}"
    v = (n - 232) * 10 + 8
    return f"#{v:02x}{v:02x}{v:02x}"


ANSI_RE = re.compile(r"\x1b\[([\d;]*)m")
DEFAULT_FG = "#e0e0e0"


def parse_runs(line: str):
    """Yield (text_chunk, fg, bg) runs from one ANSI-colored line."""
    fg, bg = DEFAULT_FG, None
    pos = 0
    buf = ""
    for m in ANSI_RE.finditer(line):
        buf += line[pos : m.start()]
        if buf:
            yield buf, fg, bg
            buf = ""
        codes_raw = m.group(1)
        codes = codes_raw.split(";") if codes_raw else ["0"]
        i = 0
        while i < len(codes):
            try:
                c = int(codes[i] or "0")
            except ValueError:
                i += 1
                continue
            if c == 0:
                fg, bg = DEFAULT_FG, None
            elif c == 38 and i + 2 < len(codes) and codes[i + 1] == "5":
                fg = color256(int(codes[i + 2]))
                i += 2
            elif c == 48 and i + 2 < len(codes) and codes[i + 1] == "5":
                bg = color256(int(codes[i + 2]))
                i += 2
            elif 30 <= c <= 37:
                fg = BASIC_COLORS[c - 30]
            elif 40 <= c <= 47:
                bg = BASIC_COLORS[c - 40]
            elif 90 <= c <= 97:
                fg = BASIC_COLORS[c - 90 + 8]
            i += 1
        pos = m.end()
    buf += line[pos:]
    if buf:
        yield buf, fg, bg


def render_svg(text: str, title: str = "") -> str:
    # Layout constants
    char_w = 8.6  # monospace char width in px @ 14px font
    line_h = 20
    pad_x = 16
    pad_y = 14
    bg_color = "#1e1e2e"  # Catppuccin Mocha base
    title_h = 26 if title else 0

    lines = text.rstrip("\n").split("\n")
    if not lines:
        lines = [""]

    # Width = max stripped-line width
    stripped = [ANSI_RE.sub("", line) for line in lines]
    max_cols = max((len(s) for s in stripped), default=10)
    width = int(max_cols * char_w + pad_x * 2)
    height = int(len(lines) * line_h + pad_y * 2 + title_h)

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'font-family="JetBrains Mono, Fira Code, Menlo, Consolas, monospace" font-size="14">',
        f'<rect width="{width}" height="{height}" rx="6" fill="{bg_color}"/>',
    ]

    y0 = pad_y
    if title:
        out.append(
            f'<text x="{pad_x}" y="{y0 + 14}" fill="#888" font-size="11" '
            f'font-style="italic">{html.escape(title)}</text>'
        )
        y0 += title_h

    for li, line in enumerate(lines):
        baseline = y0 + (li + 1) * line_h - 6
        col = 0
        for chunk, fg, bg in parse_runs(line):
            chunk_w = len(chunk) * char_w
            x = pad_x + col * char_w
            if bg is not None:
                out.append(
                    f'<rect x="{x:.1f}" y="{baseline - 14:.1f}" '
                    f'width="{chunk_w:.1f}" height="{line_h}" fill="{bg}"/>'
                )
            out.append(
                f'<text x="{x:.1f}" y="{baseline:.1f}" fill="{fg}" '
                f'xml:space="preserve">{html.escape(chunk)}</text>'
            )
            col += len(chunk)

    out.append("</svg>")
    return "\n".join(out)


def main():
    title = sys.argv[1] if len(sys.argv) > 1 else ""
    sys.stdout.write(render_svg(sys.stdin.read(), title))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
