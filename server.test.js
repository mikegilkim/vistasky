import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { createAppServer } from './server.js';

describe('Vistasky static server', () => {
  let server;
  let baseUrl;

  before(async () => {
    server = createAppServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it('serves the branded forecast app and Puter.js sign-in entry point', async () => {
    const [response, appResponse] = await Promise.all([
      fetch(baseUrl),
      fetch(`${baseUrl}/app.js`),
    ]);
    const html = await response.text();
    const app = await appResponse.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(html, /Vistasky — Your Smart Weather Companion/);
    assert.match(html, /https:\/\/js\.puter\.com\/v2\//);
    assert.doesNotMatch(html, /Privacy policy|googleSignInDialog|accounts\.google\.com/);
    assert.match(app, /puter\.auth\.signIn\(\)/);
    assert.match(app, /puter\.auth\.signOut\(\)/);
    assert.match(app, /puter\.kv\.set\(PREFERENCES_KEY/);
    assert.doesNotMatch(app, /\/api\/auth|\/api\/preferences|googleClientId|sessionToken/);
  });

  it('serves static assets with their content types and cache policy', async () => {
    const [moduleResponse, manifestResponse, iconResponse] = await Promise.all([
      fetch(`${baseUrl}/app.js`),
      fetch(`${baseUrl}/manifest.json`),
      fetch(`${baseUrl}/icon.svg`),
    ]);

    assert.equal(moduleResponse.status, 200);
    assert.match(moduleResponse.headers.get('content-type'), /text\/javascript/);
    assert.equal(moduleResponse.headers.get('cache-control'), 'no-cache');
    assert.match(manifestResponse.headers.get('content-type'), /application\/json/);
    assert.equal((await manifestResponse.json()).short_name, 'Vistasky');
    assert.match(iconResponse.headers.get('content-type'), /image\/svg\+xml/);
  });

  it('supports HEAD, rejects unsupported methods, and blocks private paths', async () => {
    const [headResponse, postResponse, serverFile, packageFile, traversal] = await Promise.all([
      fetch(baseUrl, { method: 'HEAD' }),
      fetch(baseUrl, { method: 'POST' }),
      fetch(`${baseUrl}/server.js`),
      fetch(`${baseUrl}/package.json`),
      fetch(`${baseUrl}/..%2fpackage.json`),
    ]);

    assert.equal(headResponse.status, 200);
    assert.equal(await headResponse.text(), '');
    assert.equal(postResponse.status, 405);
    assert.equal(postResponse.headers.get('allow'), 'GET, HEAD');
    assert.equal(serverFile.status, 404);
    assert.equal(packageFile.status, 404);
    assert.equal(traversal.status, 404);
  });
});
