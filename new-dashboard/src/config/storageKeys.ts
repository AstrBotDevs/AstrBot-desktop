export const storageKeys = {
  auth: {
    changePasswordHint: 'change_pwd_hint',
    md5PasswordHint: 'md5_pwd_hint',
    passwordUpgradeRequired: 'password_upgrade_required',
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
  platform: {
    showConsole: 'platformPage_showConsole',
  },
  theme: {
    primary: 'themePrimary',
    secondary: 'themeSecondary',
  },
} as const;

export const sessionStorageKeys = {
  lastBotRoute: 'astrbot:last_bot_route',
  lastChatRoute: 'astrbot:last_chat_route',
  upgradeRecoveryToken: 'astrbot-upgrade-recovery-token',
  upgradeRecoveryDismissed: (coreVersion: string, dashboardVersion: string) =>
    `astrbot-upgrade-recovery-dismissed:${coreVersion}:${dashboardVersion}`,
} as const;
