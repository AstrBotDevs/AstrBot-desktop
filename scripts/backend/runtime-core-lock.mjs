import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const generatorScriptPath = path.join(__dirname, 'tools', 'generate_runtime_core_lock.py');

export const generateRuntimeCoreLock = ({ runtimePython, outputPath }) => {
  if (!runtimePython?.absolute) {
    throw new Error('Missing runtime Python executable for runtime core lock generation.');
  }
  if (!outputPath) {
    throw new Error('Missing output path for runtime core lock generation.');
  }

  const result = spawnSync(
    runtimePython.absolute,
    [generatorScriptPath, '--output', outputPath],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    },
  );

  if (result.error) {
    throw new Error(`Failed to generate runtime core lock: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `exit code ${result.status}`;
    throw new Error(`Runtime core lock generation failed: ${detail}`);
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Runtime core lock generator did not create ${outputPath}`);
  }
};
