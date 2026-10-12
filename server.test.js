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
    const [response, appResponse, privacyResponse] = await Promise.all([
      fetch(baseUrl),
      fetch(`${baseUrl}/app.js`),
      fetch(`${baseUrl}/privacy.html`),
    ]);
    const html = await response.text();
    const app = await appResponse.text();
    const privacy = await privacyResponse.text();
    const structuredData = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];

    assert.equal(response.status, 200);
    assert.equal(privacyResponse.status, 200);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(privacyResponse.headers.get('content-type'), /text\/html/);
    assert.match(html, /<title>Vistasky Weather Forecast \| Live, Hourly &amp; 10-Day<\/title>/);
    assert.match(html, /name="description"/);
    assert.match(html, /rel="canonical" href="https:\/\/vistasky\.vercel\.app\/"/);
    assert.match(html, /application\/ld\+json/);
    assert.equal(JSON.parse(structuredData).url, 'https://vistasky.vercel.app/');
    assert.match(html, /<h1[^>]*>Live Weather Forecasts for Cities Worldwide<\/h1>/);
    assert.match(privacy, /rel="canonical" href="https:\/\/vistasky\.vercel\.app\/privacy\.html"/);
    assert.match(html, /https:\/\/js\.puter\.com\/v2\//);
    assert.match(html, /googletagmanager\.com\/gtag\/js\?id=G-7S87WY6YLS/);
    assert.match(html, /analytics_storage:\s*'denied'/);
    assert.ok(html.indexOf("analytics_storage: 'denied'") < html.indexOf("gtag('config', 'G-7S87WY6YLS')"));
    assert.match(html, /Weather data by <a href="https:\/\/open-meteo\.com\/"[^>]*>Open-Meteo<\/a>/);
    assert.match(html, /<a href="privacy\.html" class="hover:underline">Privacy policy<\/a>/);
    assert.doesNotMatch(html, /Made with Puter|googleSignInDialog|accounts\.google\.com/);
    assert.match(app, /puter\.auth\.signIn\(\)/);
    assert.match(app, /puter\.auth\.signOut\(\)/);
    assert.match(app, /puter\.kv\.set\(PREFERENCES_KEY/);
    assert.doesNotMatch(app, /\/api\/auth|\/api\/preferences|googleClientId|sessionToken/);
  });

  it('serves static assets with their content types and cache policy', async () => {
    const [moduleResponse, manifestResponse, iconResponse, robotsResponse, sitemapResponse] = await Promise.all([
      fetch(`${baseUrl}/app.js`),
      fetch(`${baseUrl}/manifest.json`),
      fetch(`${baseUrl}/icon.svg`),
      fetch(`${baseUrl}/robots.txt`),
      fetch(`${baseUrl}/sitemap.xml`),
    ]);

    assert.equal(moduleResponse.status, 200);
    assert.match(moduleResponse.headers.get('content-type'), /text\/javascript/);
    assert.equal(moduleResponse.headers.get('cache-control'), 'no-cache');
    assert.match(manifestResponse.headers.get('content-type'), /application\/json/);
    assert.equal((await manifestResponse.json()).short_name, 'Vistasky');
    assert.match(iconResponse.headers.get('content-type'), /image\/svg\+xml/);
    assert.equal(robotsResponse.status, 200);
    assert.match(robotsResponse.headers.get('content-type'), /text\/plain/);
    assert.match(await robotsResponse.text(), /Sitemap: https:\/\/vistasky\.vercel\.app\/sitemap\.xml/);
    assert.equal(sitemapResponse.status, 200);
    assert.match(sitemapResponse.headers.get('content-type'), /application\/xml/);
    const sitemap = await sitemapResponse.text();
    assert.match(sitemap, /<loc>https:\/\/vistasky\.vercel\.app\/<\/loc>/);
    assert.match(sitemap, /<loc>https:\/\/vistasky\.vercel\.app\/privacy\.html<\/loc>/);
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
