import { createVercelAppHandler } from '../server.js';

const handler = createVercelAppHandler();

export default function vercelHandler(req, res) {
  return handler(req, res);
}
