export const DEFAULT_CONFIG_ID = 'default';
export const DEFAULT_PLATFORM_ID = 'webchat';
export const DEFAULT_FEISHU_DOMAIN = 'https://open.feishu.cn';

export const themeDefaults = {
  primary: '#3c96ca',
  secondary: '#2f86bd',
} as const;

export const paginationDefaults = {
  compactPageSize: 10,
  options: [10, 20, 50, 100],
  pageSize: 20,
} as const;

export const githubProxyOptions = [
  'https://edgeone.gh-proxy.com',
  'https://hk.gh-proxy.com',
  'https://gh-proxy.com',
  'https://gh.dpik.top',
] as const;
