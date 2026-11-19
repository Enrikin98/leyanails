// Entrada para Cloudflare Workers. Los archivos de /public los sirve Cloudflare directamente.
import app from './app.js';

export default {
  fetch: app.fetch,
};
