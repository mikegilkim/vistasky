import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vercelAuthHandler from './api/auth/[...path].js';
import vercelHandler from './api/[...path].js';
import { createAppServer } from './server.js';

describe('Vistasky web server', () => {
  let server;
  let baseUrl;
  let dataDir;
  const origin = () => baseUrl;

  before(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'vistasky-test-'));
    server = createAppServer({
      googleClientId: 'test-google-client-id',
      dataDir,
      googleCredentialVerifier: async (credential) => {
        if (credential !== 'valid-google-token') throw new Error('Invalid test token');
        return { sub: 'google-account-test-subject' };
      },
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });

  it('serves the branded forecast page and privacy policy', async () => {
    const [response, policyResponse] = await Promise.all([
      fetch(baseUrl),
      fetch(`${baseUrl}/privacy.html`),
    ]);
    const html = await response.text();
    const policy = await policyResponse.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(html, /Vistasky — Your Smart Weather Companion/);
    assert.match(html, /application\/ld\+json/);
    assert.doesNotMatch(html, /cookieBanner|cookieDialog|cookieSettingsBtn/);
    assert.match(policyResponse.headers.get('content-type'), /text\/html/);
    assert.match(policy, /Privacy policy/);
    assert.match(policy, /Vistasky does not set or read cookies/);
  });

  it('serves front-end modules and install metadata with the correct MIME types', async () => {
    const [moduleResponse, manifestResponse, configResponse] = await Promise.all([
      fetch(`${baseUrl}/app.js`),
      fetch(`${baseUrl}/manifest.json`),
      fetch(`${baseUrl}/api/config`),
    ]);

    assert.equal(moduleResponse.status, 200);
    assert.match(moduleResponse.headers.get('content-type'), /text\/javascript/);
    assert.equal(moduleResponse.headers.get('cache-control'), 'no-cache');
    assert.doesNotMatch(await moduleResponse.text(), /cookieBanner|COOKIE_CONSENT|document\.cookie/);
    const deploymentServerResponse = await fetch(`${baseUrl}/server.ts`);
    assert.equal(deploymentServerResponse.status, 404);
    assert.equal(manifestResponse.status, 200);
    assert.match(manifestResponse.headers.get('content-type'), /application\/json/);
    assert.equal((await manifestResponse.json()).short_name, 'Vistasky');
    assert.equal((await configResponse.json()).googleClientId, 'test-google-client-id');
  });

  it('serves Vercel API requests through the serverless handler', async () => {
    const vercelServer = createServer(vercelHandler);
    const vercelAuthServer = createServer(vercelAuthHandler);
    await new Promise((resolve, reject) => {
      vercelServer.once('error', reject);
      vercelServer.listen(0, '127.0.0.1', resolve);
    });
    await new Promise((resolve, reject) => {
      vercelAuthServer.once('error', reject);
      vercelAuthServer.listen(0, '127.0.0.1', resolve);
    });

    try {
      const base = `http://127.0.0.1:${vercelServer.address().port}`;
      const authBase = `http://127.0.0.1:${vercelAuthServer.address().port}`;
      const configResponse = await fetch(`${base}/api/config`);
      const sessionResponse = await fetch(`${authBase}/api/auth/session`);
      const signInResponse = await fetch(`${authBase}/api/auth/google`, {
        method: 'POST',
        headers: { Origin: authBase, 'Content-Type': 'application/json' },
        body: JSON.stringify({ credential: 'unused' }),
      });

      assert.equal(configResponse.status, 200);
      assert.deepEqual(await configResponse.json(), { googleClientId: '' });
      assert.equal(sessionResponse.status, 200);
      assert.deepEqual(await sessionResponse.json(), { signedIn: false });
      assert.equal(sessionResponse.headers.get('set-cookie'), null);
      assert.equal(signInResponse.status, 503);
    } finally {
      await Promise.all([vercelServer, vercelAuthServer].map((instance) =>
        new Promise((resolve, reject) => instance.close((error) => error ? reject(error) : resolve()))));
    }
  });

  it('supports HEAD, rejects unsupported methods, and blocks cross-origin API mutations', async () => {
    const [headResponse, postResponse, crossOriginResponse] = await Promise.all([
      fetch(baseUrl, { method: 'HEAD' }),
      fetch(baseUrl, { method: 'POST' }),
      fetch(`${baseUrl}/api/auth/logout`, { method: 'POST', headers: { Origin: 'https://attacker.example' } }),
    ]);

    assert.equal(headResponse.status, 200);
    assert.equal(await headResponse.text(), '');
    assert.equal(postResponse.status, 405);
    assert.equal(postResponse.headers.get('allow'), 'GET, HEAD');
    assert.equal(crossOriginResponse.status, 403);
  });

  it('verifies Google sign-in and uses a bearer session without setting cookies', async () => {
    const requestOptions = {
      method: 'POST',
      headers: { Origin: origin(), 'Content-Type': 'application/json' },
    };
    const unauthenticated = await fetch(`${baseUrl}/api/preferences`);
    assert.equal(unauthenticated.status, 401);

    const login = await fetch(`${baseUrl}/api/auth/google`, {
      ...requestOptions,
      body: JSON.stringify({ credential: 'valid-google-token' }),
    });
    assert.equal(login.status, 200);
    assert.equal(login.headers.get('set-cookie'), null);
    const { sessionToken } = await login.json();
    assert.match(sessionToken, /^[A-Za-z0-9_-]{43}$/);
    const authHeaders = { Authorization: `Bearer ${sessionToken}` };
    const cookieOnlySession = await fetch(`${baseUrl}/api/auth/session`, { headers: { Cookie: `vistasky_session=${sessionToken}` } });
    assert.deepEqual(await cookieOnlySession.json(), { signedIn: false });
    const session = await fetch(`${baseUrl}/api/auth/session`, { headers: authHeaders });
    assert.deepEqual(await session.json(), { signedIn: true });

    const emptyPreferences = await fetch(`${baseUrl}/api/preferences`, { headers: authHeaders });
    assert.deepEqual(await emptyPreferences.json(), { preferences: null });

    const preferences = {
      saved: [{ name: 'London', admin1: 'England', country: 'United Kingdom', latitude: 51.5, longitude: -0.12 }],
      unit: 'celsius',
      last: { name: 'London', admin1: 'England', country: 'United Kingdom', latitude: 51.5, longitude: -0.12 },
      theme: 'dark',
    };
    const save = await fetch(`${baseUrl}/api/preferences`, {
      ...requestOptions,
      headers: { ...requestOptions.headers, ...authHeaders },
      method: 'PUT',
      body: JSON.stringify({ preferences }),
    });
    assert.equal(save.status, 200);
    assert.deepEqual((await (await fetch(`${baseUrl}/api/preferences`, { headers: authHeaders })).json()).preferences, preferences);

    const personalData = await readFile(join(dataDir, 'preferences.json'), 'utf8');
    assert.match(personalData, /google-account-test-subject/);
    assert.doesNotMatch(personalData, /email|name@example/);

    const invalidSave = await fetch(`${baseUrl}/api/preferences`, {
      ...requestOptions,
      headers: { ...requestOptions.headers, ...authHeaders },
      method: 'PUT',
      body: JSON.stringify({ preferences: { ...preferences, email: 'person@example.com' } }),
    });
    assert.equal(invalidSave.status, 400);

    const deletion = await fetch(`${baseUrl}/api/preferences`, {
      ...requestOptions,
      headers: { Origin: origin(), ...authHeaders },
      method: 'DELETE',
    });
    assert.equal(deletion.status, 200);
    assert.deepEqual(await (await fetch(`${baseUrl}/api/preferences`, { headers: authHeaders })).json(), { preferences: null });

    const logout = await fetch(`${baseUrl}/api/auth/logout`, { ...requestOptions, body: '{}', headers: { ...requestOptions.headers, ...authHeaders } });
    assert.equal(logout.status, 200);
    assert.equal(logout.headers.get('set-cookie'), null);
    assert.deepEqual(await (await fetch(`${baseUrl}/api/auth/session`, { headers: authHeaders })).json(), { signedIn: false });
  });

  it('does not expose server files or paths outside the app directory', async () => {
    const [serverFile, packageFile, traversal] = await Promise.all([
      fetch(`${baseUrl}/server.js`),
      fetch(`${baseUrl}/package.json`),
      fetch(`${baseUrl}/..%2fpackage.json`),
    ]);

    assert.equal(serverFile.status, 404);
    assert.equal(packageFile.status, 404);
    assert.equal(traversal.status, 404);
  });
});
