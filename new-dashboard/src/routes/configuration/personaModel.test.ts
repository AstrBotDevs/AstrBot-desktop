import { describe, expect, it } from 'vitest';
import { filterFolderTree, findFolderPath, flattenFolders, importPersonaRecords, normalizeFolderTree, personaFormValue } from './personaModel';

describe('persona model helpers', () => {
  const tree = normalizeFolderTree([{ folder_id: 'work', name: 'Work', children: [{ folder_id: 'code', name: 'Code' }] }, { folder_id: 'life', name: 'Life' }]);

  it('normalizes folder trees and finds breadcrumbs', () => {
    expect(findFolderPath(tree, 'code').map((item) => item.name)).toEqual(['Work', 'Code']);
  });

  it('filters ancestors and excludes complete subtrees', () => {
    expect(filterFolderTree(tree, 'code')[0].children[0].folder_id).toBe('code');
    expect(flattenFolders(tree, 'work').map((item) => item.folder_id)).toEqual(['life']);
  });

  it('preserves null as all-tools and all-skills mode', () => {
    expect(personaFormValue({ persona_id: 'helper', tools: null, skills: ['writer'] }, null)).toMatchObject({ persona_id: 'helper', tools: null, skills: ['writer'] });
  });

  it('accepts single, wrapped and array persona imports', () => {
    expect(importPersonaRecords({ persona_id: 'one' })).toHaveLength(1);
    expect(importPersonaRecords({ personas: [{ persona_id: 'one' }, { persona_id: 'two' }] })).toHaveLength(2);
    expect(importPersonaRecords([{ persona_id: 'one' }])).toHaveLength(1);
  });
});
