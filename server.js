import { createPublicKey, randomBytes, randomUUID, verify } from 'node:crypto';
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

export function createAppHandler({
  googleClientId = process.env.GOOGLE_CLIENT_ID || '',
  dataDir = process.env.DATA_DIR || join(root, '.data'),
  googleCredentialVerifier = verifyGoogleCredential,
} = {}) {
  const resolvedDataDir = resolve(dataDir);
  const relativeDataDir = relative(root, resolvedDataDir);
  const isWithinApp = relativeDataDir === '' ||
    (relativeDataDir !== '..' && !relativeDataDir.startsWith(`..${sep}`) && !isAbsolute(relativeDataDir));
  if (isWithinApp && relativeDataDir !== '.data' && !relativeDataDir.startsWith(`.data${sep}`)) {
    throw new Error('DATA_DIR must be outside the app directory or inside its private .data directory.');
  }
  const sessions = new Map();
  const preferences = createPreferencesStore(resolvedDataDir);

  function getSession(req) {
    const authorization = req.headers.authorization || '';
    const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
    if (!match) return null;
    const session = sessions.get(match[1]);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
      sessions.delete(match[1]);
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
        const session = getSession(req);
        sendJson(res, 200, { signedIn: Boolean(session) });
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
          for (const [existingToken, session] of sessions) {
            if (session.expiresAt <= Date.now()) sessions.delete(existingToken);
          }
          const token = randomBytes(32).toString('base64url');
          sessions.set(token, { subject: claims.sub, expiresAt: Date.now() + sessionLifetime });
          sendJson(res, 200, { signedIn: true, sessionToken: token });
        } catch (error) {
          sendJson(res, error.status || 401, {
            error: error.status === 413 ? error.message : 'Google sign-in could not be verified.',
          });
        }
        return;
      }

      if (method === 'POST' && pathname === '/api/auth/logout') {
        const session = getSession(req);
        const authorization = req.headers.authorization || '';
        const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization);
        if (session && match) sessions.delete(match[1]);
        sendJson(res, 200, { signedIn: false });
        return;
      }

      if (pathname === '/api/preferences') {
        const session = getSession(req);
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
