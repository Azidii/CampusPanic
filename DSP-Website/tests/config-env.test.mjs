import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../config/config.js', import.meta.url), 'utf8');
// Run the actual config body with dotenv/path bootstrapping removed so real .env is never loaded.
const body = source.slice(source.indexOf('const requiredSecret')).replace('export const config =', 'const config =');
const load = values => new Function('process', body + '\nreturn config;')({ env: values });
const fixture = { JWT_SECRET: 'test-only-jwt', DEVICE_API_KEY: 'test-only-device', ADMIN_PASSWORD: 'test-only-admin' };

test('required secrets have no source-code fallback', () => {
  const config = load(fixture);
  assert.equal(config.jwtSecret, fixture.JWT_SECRET);
  assert.equal(config.deviceApiKey, fixture.DEVICE_API_KEY);
  assert.equal(config.admin.password, fixture.ADMIN_PASSWORD);
  for (const name of Object.keys(fixture)) {
    for (const missing of [undefined, '', '   ']) {
      assert.throws(() => load({ ...fixture, [name]: missing }), new RegExp(name));
    }
  }
});
