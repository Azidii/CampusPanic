import dns from 'node:dns';
import { isIP } from 'node:net';

export const DEFAULT_MONGODB_URI = 'mongodb://127.0.0.1:27017/mainDB';
export const resolveMongoUri = (env = process.env) => {
  const uri = env.MONGODB_URI?.trim() || DEFAULT_MONGODB_URI;
  // MongoDB otherwise silently selects test when an Atlas/replica-set URI omits its path.
  return uri.replace(/^(mongodb(?:\+srv)?:\/\/[^/?]+)\/?(\?[^#]*)?$/, '$1/mainDB$2');
};

class MongoConnectionError extends Error {
  constructor(category, message) {
    super(message);
    this.name = 'MongoConnectionError';
    this.code = `MONGODB_${category.replaceAll('-', '_').toUpperCase()}`;
  }
}

export const validateMongoUri = (uri) => {
  if (typeof uri === 'string' && /<[^>]+>/.test(uri)) {
    throw new MongoConnectionError('invalid-uri', 'Replace the MongoDB connection placeholders in DSP-Website/.env.');
  }
  if (typeof uri !== 'string' || !/^mongodb(?:\+srv)?:\/\/\S+$/.test(uri)) {
    throw new MongoConnectionError('invalid-uri', 'MONGODB_URI must be a valid mongodb:// or mongodb+srv:// connection string. Check DSP-Website/.env.');
  }
};

const validDnsServer = (value) => {
  if (isIP(value)) return true;
  const match = value.match(/^\[([^\]]+)\]:(\d+)$/) || value.match(/^([^:]+):(\d+)$/);
  return Boolean(match && isIP(match[1]) && Number(match[2]) >= 1 && Number(match[2]) <= 65535);
};

// This changes only this Node process, never the operating system DNS settings.
// No override is applied unless the user explicitly configures it.
export const configureMongoDns = (env = process.env, resolver = dns) => {
  const value = env.MONGODB_DNS_SERVERS?.trim();
  if (!value) return;
  const servers = value.split(',').map(server => server.trim());
  if (servers.some(server => !validDnsServer(server))) {
    throw new MongoConnectionError('dns-config', 'MONGODB_DNS_SERVERS must contain comma-separated DNS server IP addresses, optionally with ports.');
  }
  try {
    resolver.setServers(servers);
  } catch {
    throw new MongoConnectionError('dns-config', 'Cannot configure MONGODB_DNS_SERVERS. Check each DNS server IP address and optional port.');
  }
};

// Driver errors may contain credentials. Inspect them only to choose a fixed,
// safe message, and never attach the original error as a publicly logged cause.
export const mongoConnectionError = (error) => {
  if (error instanceof MongoConnectionError) return error;

  const details = [];
  const pending = [error];
  const seen = new Set();
  while (pending.length && seen.size < 100) {
    const item = pending.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    details.push(item);
    pending.push(item.cause, item.reason, item.error, item.originalError);
    if (item.servers instanceof Map) pending.push(...item.servers.values());
  }

  const has = predicate => details.some(predicate);
  if (has(item => item.code === 18 || item.codeName === 'AuthenticationFailed' || /authentication failed|bad auth/i.test(item.message || ''))) {
    return new MongoConnectionError('authentication', 'MongoDB rejected authentication. Check the database username/password and authSource in DSP-Website/.env; percent-encode reserved characters in credentials.');
  }
  if (has(item => /MongoParseError|MongoInvalidArgumentError/.test(item.name || ''))) {
    return new MongoConnectionError('invalid-uri', 'MongoDB rejected MONGODB_URI. Check the connection string format and percent-encode reserved characters in credentials.');
  }
  if (has(item => ['ENOTFOUND', 'EAI_AGAIN', 'ENODATA', 'ESERVFAIL', 'EREFUSED'].includes(item.code) || /querySrv|queryTxt|getaddrinfo/.test(item.syscall || '') || /querySrv|queryTxt/.test(item.message || ''))) {
    return new MongoConnectionError('dns', 'MongoDB DNS lookup failed. Check the connection hostname and DNS resolver. Atlas mongodb+srv connections require DNS SRV/TXT lookups; configure MONGODB_DNS_SERVERS with working DNS server IP addresses if the system resolver is unavailable.');
  }
  if (has(item => item.code === 'ECONNREFUSED')) {
    return new MongoConnectionError('connection-refused', 'MongoDB refused the connection. Start the MongoDB service and verify its host and port. For Atlas, check cluster availability and network access.');
  }
  if (has(item => /CERT|TLS|SSL/.test(String(item.code || '')) || /certificate|TLS handshake/i.test(item.message || ''))) {
    return new MongoConnectionError('tls', 'MongoDB TLS connection failed. Check the system clock, trusted certificates and network TLS inspection. Keep certificate verification enabled.');
  }
  return new MongoConnectionError('network', 'Cannot reach MongoDB. Check database availability, the connection address, network/firewall and, for Atlas, the IP access list. Persistent database storage is required.');
};
