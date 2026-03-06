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
