export const storageKeys = {
  auth: {
    token: 'token',
    username: 'user',
  },
  chat: {
    expandedProjectIds: 'chat.projectExpandedIds',
    selectedConfigId: 'chat.selectedConfigId',
    selectedModel: 'selectedProviderModel',
    selectedProvider: 'selectedProvider',
    transportMode: 'chat.transportMode',
  },
  console: {
    autoScroll: 'console_auto_scroll',
  },
  extensions: {
    pinned: 'astrbot-extension-pinned',
    selectedSource: 'selectedPluginSource',
  },
  githubProxy: {
    control: 'githubProxyRadioControl',
    enabled: 'githubProxyRadioValue',
    selected: 'selectedGitHubProxy',
  },
  layout: {
    legacyTheme: 'uiTheme',
    openedSidebarGroups: 'sidebar_openedItems',
    sidebarCustomization: 'astrbot_sidebar_customization',
    themeMode: 'themeMode',
  },
  locale: 'astrbot-locale',
  notice: {
    firstSeen: 'astrbot:first_notice_seen:v1',
  },
  theme: {
    primary: 'themePrimary',
    secondary: 'themeSecondary',
  },
} as const;

export const sessionStorageKeys = {
  announcementCache: 'astrbot:announcement-cache:v1',
  upgradeRecoveryToken: 'astrbot-upgrade-recovery-token',
  upgradeRecoveryDismissed: (coreVersion: string, dashboardVersion: string) =>
    `astrbot-upgrade-recovery-dismissed:${coreVersion}:${dashboardVersion}`,
} as const;
