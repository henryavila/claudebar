import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { migrateConfig, parseSchemaVersion, CURRENT_SCHEMA_VERSION } from '../../src/config-migrator.js';

describe('config-migrator', () => {
  it('returns same config for current version', () => {
    const config = { colors: { model: 99 } };
    const { config: migrated, version } = migrateConfig(config, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(migrated, config);
    assert.equal(version, CURRENT_SCHEMA_VERSION);
  });

  it('does not mutate original config', () => {
    const config = { colors: { model: 99 } };
    const original = structuredClone(config);
    migrateConfig(config, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(config, original);
  });

  it('parseSchemaVersion extracts version from header', () => {
    assert.equal(parseSchemaVersion('# claudebar config v1\n[colors]\nmodel = 99'), 1);
    assert.equal(parseSchemaVersion('# claudebar config v3\n[colors]'), 3);
  });

  it('parseSchemaVersion defaults to 1 when no header', () => {
    assert.equal(parseSchemaVersion('[colors]\nmodel = 99'), 1);
  });
});
