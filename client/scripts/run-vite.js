import { spawn } from 'node:child_process';

const mode = process.argv[2];
const cliArgs = process.argv.slice(3);

function extractServerUrl(args) {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg.startsWith('--server-url=')) {
      return {
        serverUrl: arg.slice('--server-url='.length),
        remainingArgs: args.filter((_, currentIndex) => currentIndex !== index),
      };
    }

    if (arg === '--server-url') {
      return {
        serverUrl: args[index + 1] ?? '',
        remainingArgs: args.filter(
          (_, currentIndex) => currentIndex !== index && currentIndex !== index + 1,
        ),
      };
    }
  }

  return {
    serverUrl: '',
    remainingArgs: args,
  };
}

const { serverUrl, remainingArgs } = extractServerUrl(cliArgs);

if (!serverUrl) {
  console.error(
    `Missing required --server-url argument.\n\nExample:\n  npm run ${mode} -- --server-url=http://127.0.0.1:3001`,
  );
  process.exit(1);
}

const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', mode, ...remainingArgs],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_SERVER_URL: serverUrl,
    },
  },
);

child.on('exit', (code) => {
  process.exit(code ?? 0);
});
