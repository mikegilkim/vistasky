import { createHash, createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const sessionLifetime = 24 * 60 * 60 * 1000;
const maxRequestBytes = 16 * 1024;
const googleJwksUrl = 'https://www.googleapis.com/oauth2/v3/certs';
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);
const privateFiles = new Set(['package.json', 'package-lock.json', 'server.js', 'server.ts']);

function send(res, status, message, method) {
  const body = Buffer.from(message);
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': body.length,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  res.end(method === 'HEAD' ? undefined : body);
}

function sendJson(res, status, value, extraHeaders = {}) {
  const body = Buffer.from(JSON.stringify(value));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...extraHeaders,
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxRequestBytes) {
        tooLarge = true;
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) return;
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

function isText(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength;
}

function isPlace(value) {
  return value && typeof value === 'object' &&
    Object.keys(value).every((key) => ['name', 'admin1', 'country', 'latitude', 'longitude'].includes(key)) &&
    isText(value.name, 80) && value.name.length > 0 &&
    isText(value.admin1 ?? '', 80) &&
    isText(value.country ?? '', 80) &&
    Number.isFinite(value.latitude) && value.latitude >= -90 && value.latitude <= 90 &&
    Number.isFinite(value.longitude) && value.longitude >= -180 && value.longitude <= 180;
}

function isPreferences(value) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every((key) => ['saved', 'unit', 'last', 'theme'].includes(key)) &&
    Array.isArray(value.saved) && value.saved.length <= 50 &&
    value.saved.every(isPlace) &&
    (value.unit === 'celsius' || value.unit === 'fahrenheit') &&
    isPlace(value.last) &&
    (value.theme === 'light' || value.theme === 'dark');
}

async function googleSigningKeys(forceRefresh = false) {
  if (!forceRefresh && googleSigningKeys.cached && googleSigningKeys.expiresAt > Date.now()) {
    return googleSigningKeys.cached;
  }
  const response = await fetch(googleJwksUrl, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`Google signing-key request failed (${response.status}).`);
  const body = await response.json();
  if (!Array.isArray(body.keys)) throw new Error('Google returned an invalid signing-key set.');
  const cacheControl = response.headers.get('cache-control') || '';
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/i)?.[1] || 300);
  googleSigningKeys.cached = body.keys;
  googleSigningKeys.expiresAt = Date.now() + Math.max(30, Math.min(maxAge, 3600)) * 1000;
  return body.keys;
}

async function verifyGoogleCredential(credential, clientId) {
  if (typeof credential !== 'string' || credential.length > 12000) {
    throw new Error('Google did not return a valid sign-in credential.');
  }
  const parts = credential.split('.');
  if (parts.length !== 3) throw new Error('Google returned a malformed sign-in credential.');

  let header, claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new Error('Google returned a malformed sign-in credential.');
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('Google returned an unsupported sign-in credential.');
  }

  let keys = await googleSigningKeys();
  let key = keys.find((candidate) => candidate.kid === header.kid && candidate.alg === 'RS256');
  if (!key) {
    keys = await googleSigningKeys(true);
    key = keys.find((candidate) => candidate.kid === header.kid && candidate.alg === 'RS256');
  }
  if (!key) throw new Error('Google signing key was not found.');

  const publicKey = createPublicKey({ key, format: 'jwk' });
  const validSignature = verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    publicKey,
    Buffer.from(parts[2], 'base64url'),
  );
  const now = Math.floor(Date.now() / 1000);
  if (!validSignature ||
      !['accounts.google.com', 'https://accounts.google.com'].includes(claims.iss) ||
      claims.aud !== clientId ||
      !Number.isFinite(claims.exp) || claims.exp <= now ||
      !Number.isFinite(claims.iat) || claims.iat > now + 300 ||
      typeof claims.sub !== 'string' || claims.sub.length === 0 || claims.sub.length > 255) {
    throw new Error('Google sign-in could not be verified.');
  }
  return claims;
}

function createPreferencesStore(dataDir) {
  const dataFile = join(dataDir, 'preferences.json');
  let writes = Promise.resolve();

  async function readAll() {
    try {
      return JSON.parse(await readFile(dataFile, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }

  return {
    async get(subject) {
      const all = await readAll();
      return all[subject] || null;
    },
    update(subject, value) {
      const operation = writes.then(async () => {
        const all = await readAll();
        if (value === null) delete all[subject];
        else all[subject] = value;
        await mkdir(dataDir, { recursive: true });
        const tempFile = join(dataDir, `.preferences-${randomUUID()}.tmp`);
        try {
          await writeFile(tempFile, JSON.stringify(all), { mode: 0o600 });
          await rename(tempFile, dataFile);
        } catch (error) {
          await unlink(tempFile).catch(() => {});
          throw error;
        }
      });
      writes = operation.catch(() => {});
      return operation;
    },
  };
}

function createSupabaseStore({ url, serviceRoleKey, fetchImpl }) {
  let baseUrl;
  try {
    baseUrl = new URL(url);
  } catch {
    throw new Error('SUPABASE_URL must be a valid HTTPS URL.');
  }
  if (baseUrl.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(baseUrl.hostname)) {
    throw new Error('SUPABASE_URL must use HTTPS.');
  }

  async function request(table, query, { method = 'GET', body, prefer } = {}) {
    const endpoint = new URL(`/rest/v1/${table}`, baseUrl);
    endpoint.search = new URLSearchParams(query).toString();
    const headers = {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      Accept: 'application/json',
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (prefer) headers.Prefer = prefer;

    let response;
    try {
      response = await fetchImpl(endpoint, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      const error = new Error(`Supabase ${table} request could not be completed.`);
      error.status = 503;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(`Supabase ${table} request failed (${response.status}).`);
      error.status = 503;
      throw error;
    }
    if (response.status === 204 || method === 'DELETE') return null;
    return response.json();
  }

  return {
    async createSession(tokenHash, subject, expiresAt) {
      await request('vistasky_sessions', {
        expires_at: `lt.${new Date().toISOString()}`,
      }, { method: 'DELETE' });
      await request('vistasky_sessions', { on_conflict: 'token_hash' }, {
        method: 'POST',
        body: [{ token_hash: tokenHash, subject, expires_at: new Date(expiresAt).toISOString() }],
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
    },
    async getSession(tokenHash) {
      const rows = await request('vistasky_sessions', {
        token_hash: `eq.${tokenHash}`,
        expires_at: `gt.${new Date().toISOString()}`,
        select: 'subject,expires_at',
        limit: '1',
      });
      return rows[0] ? { subject: rows[0].subject, expiresAt: Date.parse(rows[0].expires_at) } : null;
    },
    async deleteSession(tokenHash) {
      await request('vistasky_sessions', { token_hash: `eq.${tokenHash}` }, { method: 'DELETE' });
    },
    async get(subject) {
      const rows = await request('vistasky_preferences', {
        account_id: `eq.${subject}`,
        select: 'preferences',
        limit: '1',
      });
      return rows[0]?.preferences ?? null;
    },
    async update(subject, value) {
      if (value === null) {
        await request('vistasky_preferences', { account_id: `eq.${subject}` }, { method: 'DELETE' });
        return;
      }
      await request('vistasky_preferences', { on_conflict: 'account_id' }, {
        method: 'POST',
        body: [{ account_id: subject, preferences: value }],
        prefer: 'resolution=merge-duplicates,return=minimal',
      });
    },
  };
}

export function createAppHandler({
  googleClientId = process.env.GOOGLE_CLIENT_ID || '',
  dataDir = process.env.DATA_DIR || join(root, '.data'),
  supabaseUrl = process.env.SUPABASE_URL || '',
  supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  supabaseFetch = fetch,
  googleCredentialVerifier = verifyGoogleCredential,
} = {}) {
  const resolvedDataDir = resolve(dataDir);
  const relativeDataDir = relative(root, resolvedDataDir);
  const isWithinApp = relativeDataDir === '' ||
    (relativeDataDir !== '..' && !relativeDataDir.startsWith(`..${sep}`) && !isAbsolute(relativeDataDir));
  if (isWithinApp && relativeDataDir !== '.data' && !relativeDataDir.startsWith(`.data${sep}`)) {
    throw new Error('DATA_DIR must be outside the app directory or inside its private .data directory.');
  }
  if (Boolean(supabaseUrl) !== Boolean(supabaseServiceRoleKey)) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be configured.');
  }
  const durableStore = supabaseUrl
    ? createSupabaseStore({ url: supabaseUrl, serviceRoleKey: supabaseServiceRoleKey, fetchImpl: supabaseFetch })
    : null;
  const localSessions = new Map();
  const sessions = durableStore || {
    async createSession(token, subject, expiresAt) {
      localSessions.set(token, { subject, expiresAt });
    },
    async getSession(token) {
      const session = localSessions.get(token);
      if (!session) return null;
      if (session.expiresAt <= Date.now()) {
        localSessions.delete(token);
        return null;
      }
      return session;
    },
    async deleteSession(token) {
      localSessions.delete(token);
    },
  };
  const preferences = durableStore || createPreferencesStore(resolvedDataDir);
  const getSessionKey = (token) => durableStore
    ? createHash('sha256').update(token).digest('hex')
    : token;

  async function getSession(req) {
    const authorization = req.headers.authorization || '';
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
    if (!match) return null;
    const session = await sessions.getSession(getSessionKey(match[1]));
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      await sessions.deleteSession(getSessionKey(match[1]));
      return null;
    }
    return session;
  }

  function isSameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin || !req.headers.host) return false;
    try {
      const parsed = new URL(origin);
      return ['http:', 'https:'].includes(parsed.protocol) && parsed.host === req.headers.host;
    } catch {
      return false;
    }
  }

  return async (req, res) => {
    const method = req.method || 'GET';
    let url;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      send(res, 400, 'Bad request', method);
      return;
    }
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      if (method === 'GET' && pathname === '/api/config') {
        sendJson(res, 200, { googleClientId });
        return;
      }

      if (method === 'GET' && pathname === '/api/auth/session') {
        try {
          const session = await getSession(req);
          sendJson(res, 200, { signedIn: Boolean(session) });
        } catch (error) {
          console.error('Failed to check the sign-in session:', error);
          sendJson(res, 503, { error: 'Account storage is temporarily unavailable.' });
        }
        return;
      }

      if (method !== 'GET' && !isSameOrigin(req)) {
        sendJson(res, 403, { error: 'Request origin could not be verified.' });
        return;
      }

      if (method === 'POST' && pathname === '/api/auth/google') {
        if (!googleClientId) {
          sendJson(res, 503, { error: 'Google sign-in is not configured yet.' });
          return;
        }
        try {
          const body = await readJson(req);
          const claims = await googleCredentialVerifier(body.credential, googleClientId);
          const token = randomBytes(32).toString('base64url');
          await sessions.createSession(getSessionKey(token), claims.sub, Date.now() + sessionLifetime);
          sendJson(res, 200, { signedIn: true, sessionToken: token });
        } catch (error) {
          if (error.status === 503) {
            console.error('Failed to create the sign-in session:', error);
            sendJson(res, 503, { error: 'Account storage is temporarily unavailable.' });
            return;
          }
          sendJson(res, error.status || 401, {
            error: error.status === 413 ? error.message : 'Google sign-in could not be verified.',
          });
        }
        return;
      }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        const authorization = req.headers.authorization || '';
        const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
        try {
          if (match) await sessions.deleteSession(getSessionKey(match[1]));
          sendJson(res, 200, { signedIn: false });
        } catch (error) {
          console.error('Failed to end the sign-in session:', error);
          sendJson(res, 503, { error: 'Account storage is temporarily unavailable.' });
        }
        return;
      }

      if (pathname === '/api/preferences') {
        let session;
        try {
          session = await getSession(req);
        } catch (error) {
          console.error('Failed to load the sign-in session:', error);
          sendJson(res, 503, { error: 'Account storage is temporarily unavailable.' });
          return;
        }
        if (!session) {
          sendJson(res, 401, { error: 'Sign in to manage synced preferences.' });
          return;
        }
        try {
          if (method === 'GET') {
            sendJson(res, 200, { preferences: await preferences.get(session.subject) });
            return;
          }
          if (method === 'PUT') {
            const body = await readJson(req);
            if (!isPreferences(body.preferences)) {
              sendJson(res, 400, { error: 'The supplied weather preferences are invalid.' });
              return;
            }
            await preferences.update(session.subject, body.preferences);
            sendJson(res, 200, { saved: true });
            return;
          }
          if (method === 'DELETE') {
            await preferences.update(session.subject, null);
            sendJson(res, 200, { deleted: true });
            return;
          }
        } catch (error) {
          console.error('Failed to process the preferences request:', error);
          sendJson(res, error.status || 500, {
            error: error.status ? error.message : 'Could not process the preferences request.',
          });
          return;
        }
      }

      sendJson(res, 404, { error: 'Not found.' });
      return;
    }

    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      send(res, 405, 'Method not allowed', method);
      return;
    }

    let relativePath;
    try {
      const decodedPath = decodeURIComponent(pathname);
      if (decodedPath.includes('\0')) {
        send(res, 400, 'Bad request', method);
        return;
      }
      relativePath = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^[/\\]+/, '');
    } catch {
      send(res, 400, 'Bad request', method);
      return;
    }

    const filePath = resolve(root, relativePath);
    const fileRelativeToRoot = relative(root, filePath);
    const pathParts = fileRelativeToRoot.split(sep);
    if (
      fileRelativeToRoot === '..' ||
      fileRelativeToRoot.startsWith(`..${sep}`) ||
      isAbsolute(fileRelativeToRoot) ||
      pathParts.some((part) => part.startsWith('.')) ||
      privateFiles.has(pathParts.at(-1)) ||
      /\.(?:test|spec)\.(?:c|m)?js$/i.test(pathParts.at(-1) || '')
    ) {
      send(res, 404, 'Not found', method);
      return;
    }

    let body;
    try {
      body = await readFile(join(root, fileRelativeToRoot));
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        send(res, 404, 'Not found', method);
      } else {
        console.error(`Failed to serve ${pathname}:`, error);
        send(res, 500, 'Internal server error', method);
      }
      return;
    }

    res.writeHead(200, {
      'Content-Type': mimeTypes.get(extname(filePath).toLowerCase()) || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': ['.html', '.js', '.json'].includes(extname(filePath).toLowerCase())
        ? 'no-cache'
        : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    res.end(method === 'HEAD' ? undefined : body);
  };
}

export function createAppServer(options) {
  return createServer(createAppHandler(options));
}

export function createVercelAppHandler() {
  const hasSupabaseStorage = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const googleClientId = hasSupabaseStorage ? process.env.GOOGLE_CLIENT_ID || '' : '';
  if (!hasSupabaseStorage && process.env.GOOGLE_CLIENT_ID) {
    console.warn('Google sign-in is disabled on Vercel until Supabase session and preference storage is configured.');
  }
  return createAppHandler({ googleClientId, dataDir: '/tmp/vistasky' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  if (process.env.NODE_ENV === 'production' && (!process.env.GOOGLE_CLIENT_ID || !process.env.DATA_DIR)) {
    throw new Error('Production requires GOOGLE_CLIENT_ID and DATA_DIR environment variables.');
  }

  const server = createAppServer();
  server.listen(port, process.env.HOST || '0.0.0.0', () => {
    const address = server.address();
    const listeningPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Vistasky is running at http://localhost:${listeningPort}`);
    if (!process.env.GOOGLE_CLIENT_ID) {
      console.warn('Google sign-in is disabled. Set GOOGLE_CLIENT_ID to enable it.');
    }
  });
}
