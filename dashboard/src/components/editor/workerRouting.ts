export type MonacoWorkerKind = 'css' | 'editor' | 'html' | 'json' | 'typescript';

export function resolveMonacoWorkerKind(label: string): MonacoWorkerKind {
  if (label === 'json') return 'json';
  if (['css', 'less', 'scss'].includes(label)) return 'css';
  if (['handlebars', 'html', 'razor'].includes(label)) return 'html';
  if (['javascript', 'typescript'].includes(label)) return 'typescript';
  return 'editor';
}
