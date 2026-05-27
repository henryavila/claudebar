const VALID_SECTIONS = ['layout', 'chips', 'thresholds', 'colors', 'glyphs'];

const VALID_KEYS = {
  layout: ['force', 'refresh_interval'],
  chips: ['model', 'effort', 'tmux', 'repo', 'branch', 'worktree', 'dirty', 'pr', 'agent', 'ctx_bar', 'five_hour_bar', 'seven_day_bar', 'countdown', 'time_marker'],
  thresholds: ['warning', 'critical'],
  colors: ['model', 'model_dim', 'effort_low', 'effort_med', 'effort_high', 'effort_xhigh', 'effort_max', 'repo', 'worktree', 'branch', 'dirty', 'clean', 'pr_pending', 'pr_approved', 'pr_changes', 'pr_draft', 'bar_green', 'bar_yellow', 'bar_red', 'bar_dim', 'agent', 'tmux', 'separator'],
  glyphs: ['sparkle', 'pencil', 'git', 'pr', 'tmux', 'gear', 'worktree'],
};

export function parseTOML(content) {
  const config = {};
  let section = null;

  for (const raw of content.split('\n')) {
    let line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;

    const sectionMatch = line.match(/^\[([a-z_]+)\]$/);
    if (sectionMatch) {
      section = sectionMatch[1];
      config[section] ??= {};
      continue;
    }

    const kvMatch = line.match(/^([a-z_]+)\s*=\s*(.+)$/);
    if (kvMatch && section) {
      const key = kvMatch[1];
      let val = kvMatch[2].trim();
      val = val.replace(/^["']|["']$/g, '');

      if (section === 'chips') {
        config[section][key] = val === 'true';
      } else if (section === 'colors' || section === 'thresholds') {
        const num = Number(val);
        config[section][key] = Number.isFinite(num) ? num : val;
      } else if (section === 'layout' && key === 'refresh_interval') {
        config[section][key] = Number(val);
      } else {
        config[section][key] = val;
      }
    }
  }

  return config;
}

export function validateConfig(config) {
  const errors = [];

  for (const section of Object.keys(config)) {
    if (!VALID_SECTIONS.includes(section)) {
      errors.push({ message: `[${section}] — not a valid section` });
      continue;
    }

    for (const [key, val] of Object.entries(config[section])) {
      if (!VALID_KEYS[section].includes(key)) {
        errors.push({ message: `[${section}] ${key} — not a valid key` });
        continue;
      }

      if (section === 'colors') {
        if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val > 255) {
          errors.push({ message: `[colors] ${key} = ${val} — must be integer 0-255` });
        }
      }

      if (section === 'thresholds') {
        if (typeof val !== 'number' || !Number.isInteger(val) || val < 0 || val > 100) {
          errors.push({ message: `[thresholds] ${key} = ${val} — must be integer 0-100` });
        }
      }

      if (section === 'chips') {
        if (typeof val !== 'boolean') {
          errors.push({ message: `[chips] ${key} = ${val} — must be true or false` });
        }
      }

      if (section === 'layout' && key === 'force') {
        if (!['auto', 'compact', 'full'].includes(val)) {
          errors.push({ message: `[layout] force = ${val} — must be auto, compact, or full` });
        }
      }
    }
  }

  if (config.thresholds) {
    const { warning, critical } = config.thresholds;
    if (warning !== undefined && critical !== undefined && warning >= critical) {
      errors.push({ message: `[thresholds] warning (${warning}) must be < critical (${critical})` });
    }
  }

  return errors.length === 0 ? { valid: true } : { valid: false, errors };
}

export function serializeTOML(config) {
  const lines = [];
  for (const section of VALID_SECTIONS) {
    if (!config[section]) continue;
    lines.push(`[${section}]`);
    for (const [key, val] of Object.entries(config[section])) {
      if (typeof val === 'boolean') {
        lines.push(`${key} = ${val}`);
      } else if (typeof val === 'number') {
        lines.push(`${key} = ${val}`);
      } else {
        lines.push(`${key} = "${val}"`);
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
