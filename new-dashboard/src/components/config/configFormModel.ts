export type ConfigRecord = Record<string, unknown>;

export type ConfigItemMetadata = ConfigRecord & {
  collapsed?: boolean;
  condition?: Record<string, unknown>;
  description?: string;
  hint?: string;
  invisible?: boolean;
  labels?: unknown;
  options?: unknown[];
  readonly?: boolean;
  render_type?: string;
  type?: string;
};

export type ConfigGroupMetadata = ConfigRecord & {
  description?: string;
  hint?: string;
  items?: Record<string, ConfigItemMetadata>;
  type?: string;
};

export function isConfigRecord(value: unknown): value is ConfigRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function getConfigValue(root: ConfigRecord, selector: string): unknown {
  return selector.split('.').reduce<unknown>((value, key) => (
    isConfigRecord(value) ? value[key] : undefined
  ), root);
}

export function setConfigValue(root: ConfigRecord, selector: string, value: unknown): ConfigRecord {
  const keys = selector.split('.');
  const next = { ...root };
  let target = next;

  keys.forEach((key, index) => {
    if (index === keys.length - 1) {
      target[key] = value;
      return;
    }
    const current = target[key];
    const child: ConfigRecord = isConfigRecord(current) ? current : {};
    const nextChild = { ...child };
    target[key] = nextChild;
    target = nextChild;
  });

  return next;
}

export function matchesConfigCondition(root: ConfigRecord, metadata: ConfigItemMetadata) {
  return Object.entries(metadata.condition ?? {}).every(
    ([selector, expected]) => getConfigValue(root, selector) === expected,
  );
}

export function inferConfigMetadata(value: ConfigRecord): ConfigGroupMetadata {
  return {
    type: 'object',
    items: Object.fromEntries(Object.entries(value).map(([key, item]) => {
      let type = 'string';
      if (typeof item === 'boolean') type = 'bool';
      else if (typeof item === 'number') type = Number.isInteger(item) ? 'int' : 'float';
      else if (Array.isArray(item)) type = 'list';
      else if (isConfigRecord(item)) type = 'dict';
      else if (typeof item === 'string' && item.includes('\n')) type = 'text';
      return [key, { description: key, type }];
    })),
  };
}
