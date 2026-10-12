import { createAppHandler } from '../../server.js';

const handler = createAppHandler({
  googleClientId: '',
  dataDir: '/tmp/vistasky',
});

export default function vercelAuthHandler(req, res) {
  return handler(req, res);
}
