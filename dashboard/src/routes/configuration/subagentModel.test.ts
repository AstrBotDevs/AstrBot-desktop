import { describe, expect, it } from 'vitest';

import { normalizeSubagentConfig, serializeSubagentConfig, validateSubagentConfig } from './subagentModel';

describe('subagent model', () => {
  it('normalizes API configuration and removes UI keys when serializing', () => {
    const config = normalizeSubagentConfig(
      {
        main_enable: true,
        remove_main_duplicate_tools: true,
        agents: [{ name: 'researcher', persona_id: 'research', public_description: 'Research', provider_id: null }],
      },
      () => 'ui-key',
    );
    expect(config).toMatchObject({ mainEnable: true, agents: [{ key: 'ui-key', name: 'researcher', enabled: true }] });
    expect(serializeSubagentConfig(config)).not.toContain('ui-key');
  });

  it('validates names, duplicates, and persona bindings', () => {
    const base = normalizeSubagentConfig({ agents: [{ name: 'Agent', persona_id: 'one' }] }, () => '1');
    expect(validateSubagentConfig(base)?.key).toBe('nameInvalid');
    base.agents = [
      { ...base.agents[0], name: 'agent' },
      { ...base.agents[0], key: '2', name: 'agent' },
    ];
    expect(validateSubagentConfig(base)?.key).toBe('nameDuplicate');
    base.agents = [{ ...base.agents[0], personaId: '' }];
    expect(validateSubagentConfig(base)?.key).toBe('personaMissing');
  });
});
