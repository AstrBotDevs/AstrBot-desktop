import { isObject, type JsonObject } from './model';

export type PersonaFolderNode = JsonObject & {
  folder_id: string;
  name: string;
  children: PersonaFolderNode[];
};

export type PersonaFormValue = {
  persona_id: string;
  system_prompt: string;
  custom_error_message: string;
  begin_dialogs: string[];
  tools: string[] | null;
  skills: string[] | null;
  folder_id: string | null;
};

export const emptyPersonaForm = (folderId: string | null): PersonaFormValue => ({
  persona_id: '', system_prompt: '', custom_error_message: '', begin_dialogs: [],
  tools: null, skills: null, folder_id: folderId,
});

export function personaFormValue(value: JsonObject, folderId: string | null): PersonaFormValue {
  return {
    persona_id: String(value.persona_id || ''),
    system_prompt: String(value.system_prompt || ''),
    custom_error_message: String(value.custom_error_message || ''),
    begin_dialogs: stringList(value.begin_dialogs),
    tools: value.tools == null ? null : stringList(value.tools),
    skills: value.skills == null ? null : stringList(value.skills),
    folder_id: typeof value.folder_id === 'string' ? value.folder_id : folderId,
  };
}

export function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function normalizeFolderTree(value: unknown): PersonaFolderNode[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isObject).map((item) => ({
    ...item,
    folder_id: String(item.folder_id || item.id || ''),
    name: String(item.name || item.folder_id || item.id || ''),
    children: normalizeFolderTree(item.children),
  })).filter((item) => item.folder_id);
}

export function findFolderPath(tree: PersonaFolderNode[], folderId: string | null): PersonaFolderNode[] {
  if (!folderId) return [];
  for (const node of tree) {
    if (node.folder_id === folderId) return [node];
    const childPath = findFolderPath(node.children, folderId);
    if (childPath.length) return [node, ...childPath];
  }
  return [];
}

export function flattenFolders(tree: PersonaFolderNode[], excludedId = ''): PersonaFolderNode[] {
  return tree.flatMap((node) => node.folder_id === excludedId ? [] : [node, ...flattenFolders(node.children, excludedId)]);
}

export function filterFolderTree(tree: PersonaFolderNode[], query: string): PersonaFolderNode[] {
  const term = query.trim().toLowerCase();
  if (!term) return tree;
  return tree.flatMap((node) => {
    const children = filterFolderTree(node.children, term);
    return node.name.toLowerCase().includes(term) || children.length ? [{ ...node, children }] : [];
  });
}

export function formatPersonaDate(value: unknown): string {
  if (typeof value !== 'string' || !value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function importPersonaRecords(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter(isObject);
  if (!isObject(value)) return [];
  if (Array.isArray(value.personas)) return value.personas.filter(isObject);
  if (isObject(value.persona)) return [value.persona];
  return [value];
}
