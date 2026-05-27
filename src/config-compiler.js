const COLOR_KEY_MAP = {
  effort_high: 'C_EFFORT_HI',
  effort_xhigh: 'C_EFFORT_XHI',
  separator: 'C_SEP',
};

export function compileConfig(config) {
  const lines = [];

  if (config.colors) {
    for (const [key, val] of Object.entries(config.colors)) {
      const varName = COLOR_KEY_MAP[key] || `C_${key.toUpperCase()}`;
      lines.push(`${varName}=${val}`);
    }
  }

  if (config.thresholds) {
    for (const [key, val] of Object.entries(config.thresholds)) {
      lines.push(`THRESHOLD_${key.toUpperCase()}=${val}`);
    }
  }

  if (config.chips) {
    for (const [key, val] of Object.entries(config.chips)) {
      lines.push(`CHIP_${key.toUpperCase()}=${val ? 1 : 0}`);
    }
  }

  if (config.layout) {
    for (const [key, val] of Object.entries(config.layout)) {
      lines.push(`LAYOUT_${key.toUpperCase()}=${val}`);
    }
  }

  if (config.glyphs) {
    for (const [key, val] of Object.entries(config.glyphs)) {
      lines.push(`GLYPH_${key.toUpperCase()}=${val}`);
    }
  }

  return lines.join('\n') + (lines.length ? '\n' : '');
}
