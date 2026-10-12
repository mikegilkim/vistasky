import { createVercelAppHandler } from '../../server.js';

const handler = createVercelAppHandler();

export default function vercelAuthHandler(req, res) {
  return handler(req, res);
}
