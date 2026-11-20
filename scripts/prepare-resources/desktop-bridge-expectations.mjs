import { readFileSync } from 'node:fs';

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const chatTransportContractPath = new URL(
  '../../src-tauri/src/desktop_bridge_chat_transport_contract.json',
  import.meta.url,
);
const chatTransportContract = JSON.parse(readFileSync(chatTransportContractPath, 'utf8'));
const CHAT_TRANSPORT_MODE_STORAGE_KEY = chatTransportContract.storageKey;
const CHAT_TRANSPORT_MODE_WEBSOCKET = chatTransportContract.websocketValue;

if (
  typeof CHAT_TRANSPORT_MODE_STORAGE_KEY !== 'string' ||
  !CHAT_TRANSPORT_MODE_STORAGE_KEY ||
  typeof CHAT_TRANSPORT_MODE_WEBSOCKET !== 'string' ||
  !CHAT_TRANSPORT_MODE_WEBSOCKET
) {
  throw new Error(
    'desktop bridge chat transport contract must define non-empty string storageKey and websocketValue fields',
  );
}

const CHAT_TRANSPORT_STORAGE_KEY_PATTERN = escapeRegex(CHAT_TRANSPORT_MODE_STORAGE_KEY);
const CHAT_TRANSPORT_WEBSOCKET_PATTERN = escapeRegex(CHAT_TRANSPORT_MODE_WEBSOCKET);
const CHAT_TRANSPORT_READ_HINT =
  `Expected chat UI to read "${CHAT_TRANSPORT_MODE_STORAGE_KEY}" directly or through chatPreferences() ` +
  `and recognize "${CHAT_TRANSPORT_MODE_WEBSOCKET}".`;
const CHAT_TRANSPORT_WRITE_HINT =
  'Expected chat UI to persist transport mode directly in localStorage or through chatPreferences().';
const CHAT_TRANSPORT_MIGRATION_HINT =
  `Expected chatPreferences to migrate the legacy "${CHAT_TRANSPORT_MODE_STORAGE_KEY}" key ` +
  'into the current global transportMode preference.';

const DESKTOP_BRIDGE_PATTERNS = {
  trayRestartGuard: /if\s*\(\s*!desktopBridge\s*\?\.\s*onTrayRestartBackend\s*\)\s*\{/,
  trayRestartPromptInvoke:
    /await\s+globalWaitingRef\s*\.\s*value\s*\?\.\s*check\s*\?\.\s*\(\s*[^)]*\s*\)\s*;?/,
  desktopRuntimeImport:
    /import\s+\{\s*getDesktopRuntimeInfo\s*\}\s+from\s+['"]@\/utils\/desktopRuntime['"]\s*;?/,
  desktopRuntimeUsageInRestart:
    /hasDesktopRestartCapability[\s\S]*?await\s+getDesktopRuntimeInfo\s*\(\s*\)/,
  desktopRuntimeUsageInHeader:
    /const\s+runtimeInfo\s*=\s*await\s+getDesktopRuntimeInfo\s*\(\s*\)\s*;?[\s\S]*?isDesktopReleaseMode\.value\s*=\s*runtimeInfo\.isDesktopRuntime/,
  desktopReleaseModeFlag: /\bisDesktopReleaseMode\b/,
  desktopRuntimeProbeWarn: /console\.warn\([\s\S]*desktop runtime/i,
  legacyChatTransportPreferenceRead: new RegExp(
    `localStorage\\.getItem\\(["']${CHAT_TRANSPORT_STORAGE_KEY_PATTERN}["']\\)[\\s\\S]*?["']${CHAT_TRANSPORT_WEBSOCKET_PATTERN}["']`,
  ),
  legacyChatTransportPreferenceWrite: new RegExp(
    `localStorage\\.setItem\\(["']${CHAT_TRANSPORT_STORAGE_KEY_PATTERN}["']\\s*,`,
  ),
  chatTransportPreferenceRead: new RegExp(
    `chatPreferences\\(\\)\\.global\\.transportMode\\s*===\\s*["']${CHAT_TRANSPORT_WEBSOCKET_PATTERN}["']`,
  ),
  chatTransportPreferenceWrite:
    /chatPreferences\(\s*\(\s*(\w+)\s*\)\s*=>\s*\{\s*\1\.global\.transportMode\s*=/,
  chatTransportPreferenceMigration: new RegExp(
    String.raw`["']${CHAT_TRANSPORT_STORAGE_KEY_PATTERN}["']\s*:\s*["']transportMode["']` +
      String.raw`[\s\S]*?target\.getItem\(key\)[\s\S]*?preferences\.global\[field\]\s*\?\?=\s*value` +
      String.raw`[\s\S]*?target\.setItem\(CHAT_PREFERENCES_KEY,`,
  ),
};

const CHAT_TRANSPORT_MIGRATION = {
  filePath: ['src', 'utils', 'chatPreferences.ts'],
  pattern: DESKTOP_BRIDGE_PATTERNS.chatTransportPreferenceMigration,
  label: 'legacy desktop chat transport preference migration',
  hint: CHAT_TRANSPORT_MIGRATION_HINT,
  required: true,
};

const DESKTOP_BRIDGE_EXPECTATIONS = [
  {
    filePath: ['src', 'App.vue'],
    pattern: DESKTOP_BRIDGE_PATTERNS.trayRestartGuard,
    label: 'tray restart desktop guard',
    hint: 'Expected `if (!desktopBridge?.onTrayRestartBackend) {` in App.vue.',
    required: false,
  },
  {
    filePath: ['src', 'App.vue'],
    pattern: DESKTOP_BRIDGE_PATTERNS.trayRestartPromptInvoke,
    label: 'tray restart waiting prompt',
    hint: 'Expected tray callback to call `globalWaitingRef.value?.check?.(...)`.',
    required: false,
  },
  {
    filePath: ['src', 'utils', 'restartAstrBot.ts'],
    pattern: DESKTOP_BRIDGE_PATTERNS.desktopRuntimeImport,
    label: 'desktop runtime helper import',
    hint: 'Expected `import { getDesktopRuntimeInfo } from "@/utils/desktopRuntime"`.',
    required: true,
  },
  {
    filePath: ['src', 'utils', 'restartAstrBot.ts'],
    pattern: DESKTOP_BRIDGE_PATTERNS.desktopRuntimeUsageInRestart,
    label: 'desktop runtime helper usage in restart flow',
    hint: 'Expected restart flow to use `hasDesktopRestartCapability` + `await getDesktopRuntimeInfo()`.',
    required: true,
  },
  {
    filePath: ['src', 'layouts', 'full', 'vertical-header', 'VerticalHeader.vue'],
    pattern: DESKTOP_BRIDGE_PATTERNS.desktopReleaseModeFlag,
    label: 'desktop release mode flag',
    hint: 'Expected `isDesktopReleaseMode` flag in header update UI.',
    required: false,
  },
  {
    filePath: ['src', 'layouts', 'full', 'vertical-header', 'VerticalHeader.vue'],
    pattern: DESKTOP_BRIDGE_PATTERNS.desktopRuntimeUsageInHeader,
    label: 'desktop runtime helper usage in header',
    hint: 'Expected header runtime probe: `const runtimeInfo = await getDesktopRuntimeInfo()`.',
    required: true,
  },
  {
    filePath: ['src', 'utils', 'desktopRuntime.ts'],
    pattern: DESKTOP_BRIDGE_PATTERNS.desktopRuntimeProbeWarn,
    label: 'desktop runtime probe warning',
    hint: 'Expected warning log when desktop runtime detection fails.',
    required: false,
  },
  {
    filePath: ['src', 'components', 'chat', 'Chat.vue'],
    pattern: DESKTOP_BRIDGE_PATTERNS.legacyChatTransportPreferenceRead,
    fallbackPattern: DESKTOP_BRIDGE_PATTERNS.chatTransportPreferenceRead,
    fallbackRequirement: CHAT_TRANSPORT_MIGRATION,
    label: 'chat transport preference read',
    hint: CHAT_TRANSPORT_READ_HINT,
    required: true,
  },
  {
    filePath: ['src', 'components', 'chat', 'Chat.vue'],
    pattern: DESKTOP_BRIDGE_PATTERNS.legacyChatTransportPreferenceWrite,
    fallbackPattern: DESKTOP_BRIDGE_PATTERNS.chatTransportPreferenceWrite,
    fallbackRequirement: CHAT_TRANSPORT_MIGRATION,
    label: 'chat transport preference write',
    hint: CHAT_TRANSPORT_WRITE_HINT,
    required: true,
  },
  {
    filePath: ['src', 'components', 'chat', 'StandaloneChat.vue'],
    pattern: DESKTOP_BRIDGE_PATTERNS.legacyChatTransportPreferenceRead,
    fallbackPattern: DESKTOP_BRIDGE_PATTERNS.chatTransportPreferenceRead,
    fallbackRequirement: CHAT_TRANSPORT_MIGRATION,
    label: 'standalone chat transport preference read',
    hint: CHAT_TRANSPORT_READ_HINT,
    required: true,
  },
];

export const getDesktopBridgeExpectations = () => [...DESKTOP_BRIDGE_EXPECTATIONS];

export const shouldEnforceDesktopBridgeExpectation = (
  expectation,
  { isDesktopBridgeExpectationStrict, isTaggedRelease },
) => {
  if (isDesktopBridgeExpectationStrict) {
    return true;
  }
  return expectation.required && !isTaggedRelease;
};
