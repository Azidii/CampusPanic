import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { DEFAULT_MONGODB_URI, configureMongoDns, mongoConnectionError, resolveMongoUri, validateMongoUri } from '../config/mongoConfig.js';
import { checkDB } from '../scripts/check-db.js';

test('MongoDB URI preserves the configured database and trims only surrounding whitespace', () => {
  assert.equal(resolveMongoUri({ MONGODB_URI: 'mongodb+srv://user:secret@cluster.example/?authSource=admin' }), 'mongodb+srv://user:secret@cluster.example/mainDB?authSource=admin');
  assert.equal(resolveMongoUri({ MONGODB_URI: 'mongodb://host1:27017,host2:27017?replicaSet=rs' }), 'mongodb://host1:27017,host2:27017/mainDB?replicaSet=rs');
  assert.equal(resolveMongoUri({ MONGODB_URI: 'mongodb://127.0.0.1:27017/isolated_test' }), 'mongodb://127.0.0.1:27017/isolated_test');
  for (const value of [undefined, '', '   ']) assert.equal(resolveMongoUri({ MONGODB_URI: value }), DEFAULT_MONGODB_URI);
  assert.equal(resolveMongoUri({ MONGODB_URI: '  mongodb+srv://user:secret@cluster.example/kept?authSource=admin  ' }), 'mongodb+srv://user:secret@cluster.example/kept?authSource=admin');
  assert.doesNotThrow(() => validateMongoUri(DEFAULT_MONGODB_URI));
  for (const value of ['https://example.com', 'mongodb://', 'mongodb://bad host/db', 'mongodb+srv://<user>:<password>@example.com/db']) {
    assert.throws(() => validateMongoUri(value), { code: 'MONGODB_INVALID_URI' });
  }
});

test('DNS override is opt-in and supports IPv4, IPv6 and explicit ports', () => {
  const calls = [];
  const resolver = { setServers: servers => calls.push(servers) };
  configureMongoDns({}, resolver);
  configureMongoDns({ MONGODB_DNS_SERVERS: '   ' }, resolver);
  assert.deepEqual(calls, []);
  configureMongoDns({ MONGODB_DNS_SERVERS: ' 1.1.1.1, 8.8.8.8:53, 2001:4860:4860::8888, [2001:4860:4860::8844]:53 ' }, resolver);
  assert.deepEqual(calls, [['1.1.1.1', '8.8.8.8:53', '2001:4860:4860::8888', '[2001:4860:4860::8844]:53']]);
});

test('invalid DNS configuration fails before changing any resolver', () => {
  for (const value of ['resolver.example', '1.1.1.1,', '999.2.3.4', '1.1.1.1:0', '1.1.1.1:65536']) {
    assert.throws(() => configureMongoDns({ MONGODB_DNS_SERVERS: value }, { setServers: () => assert.fail('invalid settings must not be applied') }), { code: 'MONGODB_DNS_CONFIG' });
  }
  assert.throws(() => configureMongoDns({ MONGODB_DNS_SERVERS: '1.1.1.1' }, { setServers: () => { throw new Error('private-detail'); } }), caught => caught.code === 'MONGODB_DNS_CONFIG' && !inspect(caught).includes('private-detail'));
});

test('driver errors are classified through nested causes and server descriptions without retaining secrets', () => {
  const secret = 'mongodb+srv://private-user:private-password@private-cluster/db';
  const cases = [
    [{ code: 18, message: secret }, 'AUTHENTICATION'],
    [{ cause: { code: 'ECONNREFUSED', syscall: 'querySrv', message: secret } }, 'DNS'],
    [{ code: 'ENOTFOUND', message: secret }, 'DNS'],
    [{ reason: { servers: new Map([['server', { error: { code: 'ECONNREFUSED', message: secret } }]]) } }, 'CONNECTION_REFUSED'],
    [{ name: 'MongoParseError', message: secret }, 'INVALID_URI'],
    [{ cause: { code: 'CERT_HAS_EXPIRED', message: secret } }, 'TLS'],
    [{ message: secret }, 'NETWORK']
  ];
  for (const [original, category] of cases) {
    const error = mongoConnectionError(original);
    assert.equal(error.code, `MONGODB_${category}`);
    assert.equal(error.cause, undefined);
    assert.ok(!inspect(error).includes('private-'));
  }
  const cyclic = { message: secret };
  cyclic.cause = cyclic;
  assert.equal(mongoConnectionError(cyclic).code, 'MONGODB_NETWORK');
});

const fixture = (overrides = {}) => {
  const calls = [];
  const logs = [];
  const client = {
    connect: async (uri, options) => { calls.push(['connect', uri, options]); },
    connection: { name: 'existing_database', db: { command: async command => { calls.push(['command', command]); } } },
    disconnect: async () => { calls.push(['disconnect']); },
    ...overrides
  };
  return { client, calls, logs, logger: { log: message => logs.push(message), error: message => logs.push(message) } };
};

test('standalone check needs no application secrets and pings the persistent default without writing data', async () => {
  const state = fixture();
  assert.equal(await checkDB({ ...state, env: {}, resolver: { setServers: () => assert.fail('no DNS override requested') } }), true);
  assert.deepEqual(state.calls, [['connect', DEFAULT_MONGODB_URI, { serverSelectionTimeoutMS: 10000 }], ['command', { ping: 1 }], ['disconnect']]);
  assert.match(state.logs[0], /existing_database/);
});

test('standalone check configures DNS before connecting and preserves the configured database', async () => {
  const state = fixture();
  const uri = 'mongodb+srv://user:secret@cluster.example/existing_database';
  const resolver = { setServers: servers => state.calls.push(['dns', servers]) };
  assert.equal(await checkDB({ ...state, resolver, env: { MONGODB_URI: ` ${uri} `, MONGODB_DNS_SERVERS: '1.1.1.1,8.8.8.8' } }), true);
  assert.deepEqual(state.calls.slice(0, 2), [['dns', ['1.1.1.1', '8.8.8.8']], ['connect', uri, { serverSelectionTimeoutMS: 10000 }]]);
});

test('standalone check rejects placeholders and invalid DNS before connecting', async () => {
  for (const env of [{ MONGODB_URI: 'mongodb+srv://<user>:<password>@cluster.example/db' }, { MONGODB_DNS_SERVERS: 'not-an-ip' }]) {
    const state = fixture();
    assert.equal(await checkDB({ ...state, env }), false);
    assert.deepEqual(state.calls, [['disconnect']]);
    assert.match(state.logs[0], /MONGODB_(INVALID_URI|DNS_CONFIG)/);
  }
});

test('standalone check reports failed ping and disconnect safely', async () => {
  const privateError = Object.assign(new Error('mongodb://private-user:private-password@private-host/db'), { code: 18 });
  const state = fixture({ connection: { db: { command: async () => { throw privateError; } } }, disconnect: async () => { throw privateError; } });
  assert.equal(await checkDB({ ...state, env: {} }), false);
  assert.equal(state.logs.length, 2);
  for (const line of state.logs) {
    assert.match(line, /MONGODB_AUTHENTICATION/);
    assert.ok(!line.includes('private-'));
  }
});
