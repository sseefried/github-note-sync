import { spawn } from 'node:child_process';

const mode = process.argv[2];
const cliArgs = process.argv.slice(3);

function extractRuntimeOptions(args) {
  let serverUrl = '';
  const remainingArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg.startsWith('--server-url=')) {
      serverUrl = arg.slice('--server-url='.length);
      continue;
    }

    if (arg === '--server-url') {
      serverUrl = args[index + 1] ?? '';
      index += 1;
      continue;
    }

    remainingArgs.push(arg);
  }

  return {
    serverUrl,
    remainingArgs,
  };
}

const { serverUrl, remainingArgs } = extractRuntimeOptions(cliArgs);

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
