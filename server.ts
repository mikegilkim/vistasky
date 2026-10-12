import { createAppServer } from './server.js';

const isVercel = process.env.VERCEL === '1';
const port = Number.parseInt(process.env.PORT || '3000', 10);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  throw new Error('PORT must be an integer between 0 and 65535.');
}

const server = createAppServer({
  googleClientId: isVercel ? '' : process.env.GOOGLE_CLIENT_ID || '',
  dataDir: isVercel ? '/tmp/vistasky' : process.env.DATA_DIR,
});

server.listen(port, process.env.HOST || '0.0.0.0', () => {
  const address = server.address();
  const listeningPort = typeof address === 'object' && address ? address.port : port;
  console.log(`Vistasky is running at http://localhost:${listeningPort}`);
  if (isVercel) {
    console.warn('Google sign-in is disabled on Vercel until durable session and preference storage is configured.');
  } else if (!process.env.GOOGLE_CLIENT_ID) {
    console.warn('Google sign-in is disabled. Set GOOGLE_CLIENT_ID to enable it.');
  }
});
