import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
]);
const privateFiles = new Set(['package.json', 'package-lock.json', 'server.js', 'server.test.js']);

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

export function createAppServer() {
  return createServer(async (req, res) => {
    const method = req.method || 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      send(res, 405, 'Method not allowed', method);
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
      if (pathname.includes('\0')) {
        send(res, 400, 'Bad request', method);
        return;
      }
    } catch {
      send(res, 400, 'Bad request', method);
      return;
    }

    const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^[/\\]+/, '');
    const filePath = resolve(root, relativePath);
    const fileRelativeToRoot = relative(root, filePath);
    const pathParts = fileRelativeToRoot.split(sep);
    const filename = pathParts.at(-1) || '';
    if (
      fileRelativeToRoot === '..' ||
      fileRelativeToRoot.startsWith(`..${sep}`) ||
      isAbsolute(fileRelativeToRoot) ||
      pathParts.some((part) => part.startsWith('.')) ||
      privateFiles.has(filename) ||
      /\.(?:test|spec)\.(?:c|m)?js$/i.test(filename)
    ) {
      send(res, 404, 'Not found', method);
      return;
    }

    let body;
    try {
      body = await readFile(filePath);
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') {
        send(res, 404, 'Not found', method);
      } else {
        console.error(`Failed to serve ${pathname}:`, error);
        send(res, 500, 'Internal server error', method);
      }
      return;
    }

    const extension = extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes.get(extension) || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': ['.html', '.js', '.json'].includes(extension) ? 'no-cache' : 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    res.end(method === 'HEAD' ? undefined : body);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number.parseInt(process.env.PORT || '3000', 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }

  const server = createAppServer();
  server.listen(port, process.env.HOST || '0.0.0.0', () => {
    const address = server.address();
    const listeningPort = typeof address === 'object' && address ? address.port : port;
    console.log(`Vistasky is running at http://localhost:${listeningPort}`);
  });
}
