import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const buildBackendPath = fileURLToPath(new URL('./build-backend.mjs', import.meta.url));

test('backend build includes the STT health-check audio in the packaged app', async () => {
  const source = await readFile(buildBackendPath, 'utf8');

  assert.match(
    source,
    /requiredSourceEntries\s*=\s*\[[^\]]*['"]samples\/stt_health_check\.wav['"]/s,
    'the STT provider test loads this audio from the packaged AstrBot source tree',
  );
});
