import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

function parseAllowedHosts(value) {
  return value
    .split(',')
    .map((host) => host.trim())
    .filter(Boolean);
}

const allowedHosts = Array.from(
  new Set([
    ...parseAllowedHosts(process.env.VITE_ALLOWED_HOSTS ?? ''),
  ]),
);

function requestUsesHttps(req) {
  const forwardedProtoHeader = req.headers['x-forwarded-proto'];
  const forwardedProto = Array.isArray(forwardedProtoHeader)
    ? forwardedProtoHeader[0]
    : forwardedProtoHeader;

  if (typeof forwardedProto === 'string' && forwardedProto.split(',')[0].trim().toLowerCase() === 'https') {
    return true;
  }

  return false;
}

function forwardedHttpsPlugin() {
  const endpoint = '/__github-note-sync__/request-context';

  function installMiddleware(server) {
    server.middlewares.use(endpoint, (req, res) => {
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          forwardedHttps: requestUsesHttps(req),
        }),
      );
    });
  }

  return {
    name: 'github-note-sync-forwarded-https',
    configureServer(server) {
      installMiddleware(server);
    },
    configurePreviewServer(server) {
      installMiddleware(server);
    },
  };
}

export default defineConfig({
  plugins: [react(), forwardedHttpsPlugin()],
  server: {
    allowedHosts,
    host: '0.0.0.0',
    port: 3002,
  },
  preview: {
    allowedHosts,
    host: '0.0.0.0',
  },
});
