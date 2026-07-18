const SHIKI_RUNTIME = '<script id="astrbot-t2i-shiki-runtime" src="/t2i/shiki_runtime.iife.js"></script>';

export function normalizeT2iPreview(content: string, text: string, version: string) {
  let normalized = content.replace(
    /<script\s+id=["']markdown-source["']\s+type=["']text\/plain["']>\s*\{\{\s*text\s*\|\s*safe\s*\}\}\s*<\/script>/gi,
    '<textarea id="markdown-source" hidden>{{ text | safe }}</textarea>',
  );
  normalized = normalized.replace(
    /decodeBase64Utf8\("\{\{\s*text_base64\s*\}\}"\)/g,
    'document.getElementById("markdown-source").value',
  );
  normalized = normalized.replace(
    /document\.getElementById\(["']markdown-source["']\)\.textContent/g,
    'document.getElementById("markdown-source").value',
  );
  normalized = normalized
    .replace(/\{\{\s*text\s*\|\s*safe\s*\}\}/g, () => text)
    .replace(/\{\{\s*version\s*\}\}/g, () => version);
  if (normalized.includes('astrbot-t2i-shiki-runtime')) return normalized;
  const placeholder =
    /<script\b[^>]*>\s*\{\{\s*shiki_runtime\s*\|\s*safe\s*\}\}\s*<\/script>|\{\{\s*shiki_runtime\s*\|\s*safe\s*\}\}/gi;
  if (placeholder.test(normalized)) return normalized.replace(placeholder, () => SHIKI_RUNTIME);
  const headClose = normalized.search(/<\/head\s*>/i);
  return headClose >= 0
    ? `${normalized.slice(0, headClose)}${SHIKI_RUNTIME}\n${normalized.slice(headClose)}`
    : `${SHIKI_RUNTIME}\n${normalized}`;
}
