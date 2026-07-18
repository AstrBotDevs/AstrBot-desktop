const withoutTrailingSlash = (value: string) => value.replace(/\/+$/, '');
const deploymentValue = (value: string | undefined, fallback: string) =>
  withoutTrailingSlash(value?.trim() || fallback);

const docsBase = deploymentValue(import.meta.env.VITE_ASTRBOT_DOCS_URL, 'https://docs.astrbot.app');
const projectBase = deploymentValue(import.meta.env.VITE_ASTRBOT_GITHUB_URL, 'https://github.com/AstrBotDevs/AstrBot');

export const externalLinks = {
  afdian: 'https://afdian.com/a/astrbot_team',
  docs: {
    faq: `${docsBase}/faq.html`,
    home: `${docsBase}/`,
    knowledgeBase: `${docsBase}/use/knowledge-base.html`,
    openApi: `${docsBase}/dev/openapi.html`,
    customRules: `${docsBase}/use/custom-rules.html`,
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
  return `${docsBase}/platform/${platformTutorialPaths[type] ?? ''}`;
}

export const deploymentEndpoints = {
  announcement: deploymentValue(
    import.meta.env.VITE_ASTRBOT_ANNOUNCEMENT_URL,
    'https://cloud.astrbot.app/api/v1/announcement',
  ),
} as const;
