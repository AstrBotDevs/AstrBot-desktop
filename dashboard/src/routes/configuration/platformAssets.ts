import dingtalkLogo from '@/assets/images/platform_logos/dingtalk.svg';
import discordLogo from '@/assets/images/platform_logos/discord.svg';
import kookLogo from '@/assets/images/platform_logos/kook.png';
import larkLogo from '@/assets/images/platform_logos/lark.png';
import lineLogo from '@/assets/images/platform_logos/line.png';
import matrixLogo from '@/assets/images/platform_logos/matrix.svg';
import mattermostLogo from '@/assets/images/platform_logos/mattermost.svg';
import misskeyLogo from '@/assets/images/platform_logos/misskey.png';
import onebotLogo from '@/assets/images/platform_logos/onebot.png';
import qqLogo from '@/assets/images/platform_logos/qq.png';
import satoriLogo from '@/assets/images/platform_logos/satori.png';
import slackLogo from '@/assets/images/platform_logos/slack.svg';
import telegramLogo from '@/assets/images/platform_logos/telegram.svg';
import wechatLogo from '@/assets/images/platform_logos/wechat.png';
import wecomLogo from '@/assets/images/platform_logos/wecom.png';

import type { JsonObject } from './model';

const logos: Record<string, string> = {
  aiocqhttp: onebotLogo,
  qq_official: qqLogo,
  qq_official_webhook: qqLogo,
  weixin_oc: wechatLogo,
  weixin_official_account: wechatLogo,
  wecom: wecomLogo,
  wecom_ai_bot: wecomLogo,
  lark: larkLogo,
  dingtalk: dingtalkLogo,
  telegram: telegramLogo,
  discord: discordLogo,
  slack: slackLogo,
  kook: kookLogo,
  satori: satoriLogo,
  misskey: misskeyLogo,
  line: lineLogo,
  matrix: matrixLogo,
  mattermost: mattermostLogo,
};

export function platformLogo(type: string, template?: JsonObject) {
  const logoToken = String(template?.logo_token || '');
  if (logoToken) return `/api/v1/files/tokens/${encodeURIComponent(logoToken)}`;
  return logos[type.toLowerCase()];
}

export function hasScanAndManualCreation(type: string) {
  return type === 'lark' || type === 'dingtalk' || type === 'qq_official' || type === 'qq_official_webhook';
}

export function isScanOnlyCreation(type: string) {
  return type === 'weixin_oc';
}

export function scanRegistrationComplete(type: string, config: JsonObject) {
  if (type === 'lark') return Boolean(config.app_id && config.app_secret);
  if (type === 'dingtalk') return Boolean(config.client_id && config.client_secret);
  if (type === 'qq_official' || type === 'qq_official_webhook') return Boolean(config.appid && config.secret);
  if (type === 'weixin_oc') return Boolean(config.weixin_oc_token);
  return true;
}
