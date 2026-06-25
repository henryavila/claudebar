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

  if (config.quota) {
    for (const [key, val] of Object.entries(config.quota)) {
      if (key === 'enabled') lines.push(`QUOTA_ENABLED=${val ? 1 : 0}`);
      else if (key === 'refresh_interval_minutes') lines.push(`QUOTA_REFRESH_INTERVAL_MINUTES=${val}`);
    }
  }

  return lines.join('\n') + (lines.length ? '\n' : '');
}
