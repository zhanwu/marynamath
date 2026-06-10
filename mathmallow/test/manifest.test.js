'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const APP_ROOT = path.join(__dirname, '..');

const manifest = JSON.parse(
  fs.readFileSync(path.join(APP_ROOT, 'capabilities.json'), 'utf8')
);

/**
 * Load the client-side widget registry in a minimal sandbox that stubs just
 * enough of the DOM for the module body to run. We only need the WIDGETS map's
 * keys (the renderer fns are never called here), so document methods can be
 * no-ops that return chainable stubs.
 */
function loadRegistryWidgets() {
  const stubEl = () => {
    const el = {
      style: {},
      setAttribute() {},
      getAttribute() { return ''; },
      appendChild() {},
      attributes: [],
    };
    return el;
  };
  const sandbox = {
    window: {},
    document: {
      createElementNS: stubEl,
      createElement: stubEl,
      createDocumentFragment: stubEl,
      importNode: stubEl,
    },
    DOMParser: function () { this.parseFromString = () => ({ documentElement: null }); },
    console,
  };
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(APP_ROOT, 'public', 'widgets', 'registry.js'), 'utf8');
  vm.runInContext(code, sandbox);
  assert.ok(sandbox.window.WIDGETS, 'registry did not expose window.WIDGETS');
  return Object.keys(sandbox.window.WIDGETS).sort();
}

test('manifest schema is well-formed', () => {
  assert.strictEqual(manifest.schema_version, '1.0');
  assert.deepStrictEqual(manifest.question_types, ['numeric', 'multiple_choice', 'true_false']);
  assert.deepStrictEqual(manifest.render_kinds, ['none', 'widget', 'image', 'svg']);
  assert.ok(Array.isArray(manifest.widgets) && manifest.widgets.length > 0);
});

test('manifest and implemented widget registry are in sync (no drift)', () => {
  const registryWidgets = loadRegistryWidgets();
  const manifestWidgets = manifest.widgets.map((w) => w.name).sort();

  const inManifestNotRegistry = manifestWidgets.filter((w) => !registryWidgets.includes(w));
  const inRegistryNotManifest = registryWidgets.filter((w) => !manifestWidgets.includes(w));

  assert.deepStrictEqual(
    inManifestNotRegistry, [],
    'widgets advertised in manifest but not implemented: ' + inManifestNotRegistry.join(', ')
  );
  assert.deepStrictEqual(
    inRegistryNotManifest, [],
    'widgets implemented but missing from manifest: ' + inRegistryNotManifest.join(', ')
  );
  assert.deepStrictEqual(registryWidgets, manifestWidgets);
});

test('manifest includes the v1 starter catalog', () => {
  const names = manifest.widgets.map((w) => w.name);
  for (const required of [
    'analog-clock', 'number-line', 'fraction-bar', 'fraction-circle',
    'array-dots', 'base-ten-blocks', 'shape', 'bar-model',
    'coordinate-grid', 'bar-chart',
  ]) {
    assert.ok(names.includes(required), `manifest missing starter widget ${required}`);
  }
});

test('every manifest widget declares params and canInput', () => {
  for (const w of manifest.widgets) {
    assert.ok(typeof w.name === 'string' && w.name);
    assert.ok(typeof w.description === 'string');
    assert.ok(w.params && typeof w.params === 'object');
    assert.strictEqual(typeof w.canInput, 'boolean');
  }
});
