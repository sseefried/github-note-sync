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

export default defineConfig({
  plugins: [react()],
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
