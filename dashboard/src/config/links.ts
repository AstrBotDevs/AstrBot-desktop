const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, '');
const deploymentValue = (value: string | undefined, fallback: string) => {
  const candidate = value?.trim() || fallback;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? withoutTrailingSlash(candidate) : fallback;
  } catch {
    return fallback;
  }
};

type ExternalLinkEnvironment = {
  VITE_ASTRBOT_DOCS_URL?: string;
  VITE_ASTRBOT_GITHUB_URL?: string;
};

export function resolveExternalLinks(environment: ExternalLinkEnvironment) {
  const docsBase = deploymentValue(environment.VITE_ASTRBOT_DOCS_URL, 'https://docs.astrbot.app');
  const projectBase = deploymentValue(environment.VITE_ASTRBOT_GITHUB_URL, 'https://github.com/AstrBotDevs/AstrBot');
  return {
    afdian: 'https://afdian.com/a/astrbot_team',
    docs: {
      customRules: `${docsBase}/use/custom-rules.html`,
      faq: `${docsBase}/faq.html`,
      home: `${docsBase}/`,
      knowledgeBase: `${docsBase}/use/knowledge-base.html`,
      openApi: `${docsBase}/dev/openapi.html`,
    },
    modelScope: {
      accessToken: 'https://modelscope.cn/my/myaccesstoken',
      mcp: 'https://www.modelscope.cn/mcp',
    },
    project: {
      issues: `${projectBase}/issues`,
      releases: `${projectBase}/releases`,
      repository: projectBase,
    },
  } as const;
}

export const externalLinks = resolveExternalLinks(import.meta.env);

const platformTutorialPaths: Record<string, string> = {
  aiocqhttp: 'aiocqhttp.html',
  dingtalk: 'dingtalk.html',
  discord: 'discord.html',
  kook: 'kook.html',
  lark: 'lark.html',
  line: 'line.html',
  matrix: 'matrix.html',
  mattermost: 'mattermost.html',
  misskey: 'misskey.html',
  qq_official: 'qqofficial/websockets.html',
  qq_official_webhook: 'qqofficial/webhook.html',
  satori: 'satori/guide.html',
  slack: 'slack.html',
  telegram: 'telegram.html',
  vocechat: 'vocechat.html',
  wecom: 'wecom.html',
  wecom_ai_bot: 'wecom_ai_bot.html',
  weixin_oc: 'weixin_oc.html',
  weixin_official_account: 'weixin-official-account.html',
};

export function platformTutorialLink(type: string) {
  const docsHome = externalLinks.docs.home.replace(/\/+$/, '');
  return `${docsHome}/platform/${platformTutorialPaths[type] ?? ''}`;
}
