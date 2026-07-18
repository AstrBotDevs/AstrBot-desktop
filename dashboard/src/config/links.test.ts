import { describe, expect, it } from 'vitest';

import { externalLinks, platformTutorialLink, resolveExternalLinks } from './links';

function leafUrls(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  return Object.values(value).flatMap(leafUrls);
}

describe('external product links', () => {
  it('keeps every product and documentation link on an absolute HTTPS URL', () => {
    for (const value of leafUrls(externalLinks)) {
      const url = new URL(value);
      expect(url.protocol, value).toBe('https:');
      expect(url.hostname, value).not.toBe('');
    }
    expect(new URL(platformTutorialLink('telegram')).protocol).toBe('https:');
  });

  it('supports deployment-specific docs and project bases without trailing slash drift', () => {
    const links = resolveExternalLinks({
      VITE_ASTRBOT_DOCS_URL: 'https://docs.example.test/base/',
      VITE_ASTRBOT_GITHUB_URL: 'https://git.example.test/org/repo/',
    });
    expect(links.docs.knowledgeBase).toBe('https://docs.example.test/base/use/knowledge-base.html');
    expect(links.project.issues).toBe('https://git.example.test/org/repo/issues');
  });

  it('rejects non-HTTP deployment link overrides', () => {
    const links = resolveExternalLinks({
      VITE_ASTRBOT_DOCS_URL: 'javascript:alert(1)',
      VITE_ASTRBOT_GITHUB_URL: 'not a URL',
    });
    expect(links.docs.home).toBe('https://docs.astrbot.app/');
    expect(links.project.repository).toBe('https://github.com/AstrBotDevs/AstrBot');
  });
});
