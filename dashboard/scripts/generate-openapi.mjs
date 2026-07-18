import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const dashboardDir = path.resolve(import.meta.dirname, '..', '..', 'dashboard');
const outputDir = path.resolve(import.meta.dirname, '..', 'src', 'api', 'generated', 'openapi-v1');
const logDir = path.resolve(import.meta.dirname, '..', '.openapi-logs');
const expectedOutputs = ['index.ts', 'sdk.gen.ts', 'types.gen.ts'];

const result = spawnSync(
  'pnpm',
  [
    '--dir',
    dashboardDir,
    'exec',
    'openapi-ts',
    '-i',
    'openapi/openapi-v1.yaml',
    '-o',
    outputDir,
    '-c',
    '@hey-api/client-axios',
    '-l',
    logDir,
  ],
  {
    cwd: dashboardDir,
    encoding: 'utf8',
    env: process.env,
    shell: process.platform === 'win32',
  },
);

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;

const outputsExist = expectedOutputs.every((file) => existsSync(path.join(outputDir, file)));
let logText = '';
if (existsSync(logDir)) {
  const logFiles = await readdir(logDir, { recursive: true });
  logText = logFiles
    .filter((file) => file.endsWith('.log'))
    .map((file) => readFileSync(path.join(logDir, file), 'utf8'))
    .join('\n');
  await rm(logDir, { force: true, recursive: true });
}

if (result.status === 0) process.exit(0);

const knownReporterError = logText.includes('The "openapi-end" performance mark has not been set');
if (outputsExist && knownReporterError) {
  console.warn('[generate:api] SDK generated successfully; ignored @hey-api/openapi-ts 0.60 reporter timing error.');
  process.exit(0);
}

throw new Error(`OpenAPI generation failed with exit code ${result.status ?? 'unknown'}.`);
