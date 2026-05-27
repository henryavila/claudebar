const CURRENT_SCHEMA_VERSION = 1;

const migrations = {
  // Future migrations go here:
  // 2: (config) => { /* v1 → v2 */ return config; },
};

export function migrateConfig(config, fromVersion) {
  let current = structuredClone(config);
  for (let v = fromVersion + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    if (migrations[v]) current = migrations[v](current);
  }
  return { config: current, version: CURRENT_SCHEMA_VERSION };
}

export function parseSchemaVersion(tomlContent) {
  const match = tomlContent.match(/^#\s*claudebar config v(\d+)/m);
  return match ? Number(match[1]) : 1;
}

export { CURRENT_SCHEMA_VERSION };
