import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const scriptPath = new URL('../../src-tauri/windows/kill-backend-processes.ps1', import.meta.url);
const hookPath = new URL('../../src-tauri/windows/nsis-installer-hooks.nsh', import.meta.url);

function extractNsisMacroBody(source, macroName) {
  const lines = source.split('\n');
  const startPattern = new RegExp(`^\\s*!macro\\s+${macroName}(?:\\s|$)`, 'i');
  const endPattern = /^\s*!macroend\b/i;
  const startIdx = lines.findIndex((line) => startPattern.test(line));

  assert.notEqual(startIdx, -1, `Expected NSIS macro ${macroName} to exist`);

  const endIdx = lines.findIndex((line, index) => index > startIdx && endPattern.test(line));

  assert.notEqual(endIdx, -1, `Expected end of NSIS macro ${macroName}`);
  return lines.slice(startIdx + 1, endIdx).map((line) => line.trim());
}

function getNsisDefineValue(source, defineName) {
  const targetDefinePattern = new RegExp(`^!define\\s+${defineName}(?:\\s+(.+))?$`, 'i');
  const definePattern = new RegExp(
    `^!define\\s+${defineName}\\s+("([^"\\s]+)"|'([^'\\s]+)'|([^"'\\n\\s]+))$`,
    'i'
  );

  for (const line of source.split('\n')) {
    const trimmedLine = line.trim();
    const targetMatch = trimmedLine.match(targetDefinePattern);

    if (!targetMatch) {
      continue;
    }

    const match = trimmedLine.match(definePattern);

    if (!match) {
      throw new Error(`Expected NSIS define ${defineName} to have a simple literal value`);
    }

    const value = match[2] ?? match[3] ?? match[4];
    if (!value) {
      throw new Error(`Expected NSIS define ${defineName} to have a simple literal value`);
    }
    return value;
  }

  return undefined;
}

test('extractNsisMacroBody tolerates macro keyword casing and macroend comments', () => {
  const source = `!MACRO NSIS_RUN_BACKEND_CLEANUP optional\nStrCpy $1 "foo"\n!MacroEnd ; end`;

  assert.deepEqual(extractNsisMacroBody(source, 'NSIS_RUN_BACKEND_CLEANUP'), ['StrCpy $1 "foo"']);
});

test('getNsisDefineValue fails clearly on unsupported target define syntax', () => {
  assert.throws(
    () =>
      getNsisDefineValue(
        '!define ASTRBOT_BACKEND_CLEANUP_SCRIPT_INSTALL_ROOT $INSTDIR\\kill-backend-processes.ps1 extra-token',
        'ASTRBOT_BACKEND_CLEANUP_SCRIPT_INSTALL_ROOT'
      ),
    /simple literal value/
  );
});

test('windows cleanup script emits diagnostic logging for install root and process termination', async () => {
  const source = await readFile(scriptPath, 'utf8');

  assert.match(source, /Write-Output\s+"\[astrbot-installer\]\s+install root:/);
  assert.match(source, /Write-Output\s+"\[astrbot-installer\]\s+matched process:/);
  assert.match(source, /Write-Output\s+"\[astrbot-installer\]\s+stopping process:/);
});

test('windows cleanup script only matches processes under the provided install root', async () => {
  const source = await readFile(scriptPath, 'utf8');

  assert.match(source, /function Test-IsUnderInstallRoot/);
  assert.match(source, /\$normalized -ieq \$installRoot/);
  assert.match(source, /\$normalized\.StartsWith\(\$installRootWithSep/);
});

test('nsis installer hook looks for the install-root cleanup script before updater fallback', async () => {
  const source = await readFile(hookPath, 'utf8');
  const macroBody = extractNsisMacroBody(source, 'NSIS_RUN_BACKEND_CLEANUP');
  const bodyText = macroBody.join('\n');
  const primaryPattern = /StrCpy\s+\$1\s+"\$\{ASTRBOT_BACKEND_CLEANUP_SCRIPT_INSTALL_ROOT\}"/;
  const fileExistsPattern = /IfFileExists\s+"\$1"\s+\+2\s+0/;
  const fallbackPattern = /StrCpy\s+\$1\s+"\$\{ASTRBOT_BACKEND_CLEANUP_SCRIPT_UPDATER_FALLBACK\}"/;
  const primaryIdx = bodyText.search(primaryPattern);
  const fileExistsIdx = bodyText.search(fileExistsPattern);
  const fallbackIdx = bodyText.search(fallbackPattern);

  assert.equal(
    getNsisDefineValue(source, 'ASTRBOT_BACKEND_CLEANUP_SCRIPT_INSTALL_ROOT'),
    '$INSTDIR\\kill-backend-processes.ps1'
  );
  assert.equal(
    getNsisDefineValue(source, 'ASTRBOT_BACKEND_CLEANUP_SCRIPT_UPDATER_FALLBACK'),
    '$INSTDIR\\_up_\\resources\\kill-backend-processes.ps1'
  );
  assert.ok(primaryIdx !== -1);
  assert.ok(fileExistsIdx !== -1);
  assert.ok(fallbackIdx !== -1);
  assert.ok(primaryIdx < fileExistsIdx && fileExistsIdx < fallbackIdx);
  assert.ok(/nsExec::ExecToLog/.test(bodyText));
});
