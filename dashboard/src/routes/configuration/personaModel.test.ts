import { describe, expect, it } from 'vitest';
import {
  exportPersonaRecord,
  filterFolderTree,
  findFolderPath,
  flattenFolders,
  importPersonaRecords,
  normalizeFolderTree,
  personaExportFilename,
  personaFormValue,
} from './personaModel';

describe('persona model helpers', () => {
  const tree = normalizeFolderTree([
    { folder_id: 'work', name: 'Work', children: [{ folder_id: 'code', name: 'Code' }] },
    { folder_id: 'life', name: 'Life' },
  ]);

  it('normalizes folder trees and finds breadcrumbs', () => {
    expect(findFolderPath(tree, 'code').map((item) => item.name)).toEqual(['Work', 'Code']);
  });

  it('filters ancestors and excludes complete subtrees', () => {
    expect(filterFolderTree(tree, 'code')[0].children[0].folder_id).toBe('code');
    expect(flattenFolders(tree, 'work').map((item) => item.folder_id)).toEqual(['life']);
  });

  it('preserves null as all-tools and all-skills mode', () => {
    expect(personaFormValue({ persona_id: 'helper', tools: null, skills: ['writer'] }, null)).toMatchObject({
      persona_id: 'helper',
      tools: null,
      skills: ['writer'],
    });
  });

  it('accepts single, wrapped and array persona imports', () => {
    expect(importPersonaRecords({ persona_id: 'one' })).toHaveLength(1);
    expect(importPersonaRecords({ personas: [{ persona_id: 'one' }, { persona_id: 'two' }] })).toHaveLength(2);
    expect(importPersonaRecords([{ persona_id: 'one' }])).toHaveLength(1);
  });

  it('exports a portable persona record with a safe filename', () => {
    expect(
      exportPersonaRecord({
        persona_id: 'helper',
        system_prompt: 'Be helpful.',
        custom_error_message: null,
        begin_dialogs: ['Hi', 'Hello'],
        tools: null,
        skills: ['writer'],
        folder_id: 'work',
        created_at: '2026-07-16',
      }),
    ).toEqual({
      persona_id: 'helper',
      system_prompt: 'Be helpful.',
      custom_error_message: null,
      begin_dialogs: ['Hi', 'Hello'],
      tools: null,
      skills: ['writer'],
    });
    expect(personaExportFilename({ persona_id: 'helper:writer?' })).toBe('helper_writer_.json');
  });
});
