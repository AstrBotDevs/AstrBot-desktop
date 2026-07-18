import { describe, expect, it } from 'vitest';

import { isSafePluginConfigPath, pluginConfigUploadBody } from './pluginFileModel';

describe('plugin file config paths', () => {
  it.each(['files/prompt.txt', 'avatar.png'])('accepts a relative plugin path: %s', (path) => {
    expect(isSafePluginConfigPath(path)).toBe(true);
  });

  it.each(['../secret', 'files/../../secret', '/etc/passwd', 'C:\\secret', 'files\\..\\secret', ''])(
    'rejects a path outside the plugin directory: %s',
    (path) => {
      expect(isSafePluginConfigPath(path)).toBe(false);
    },
  );

  it('builds enumerable fields for the generated multipart serializer', () => {
    const first = new File(['one'], 'one.txt');
    const second = new File(['two'], 'two.txt');

    expect(pluginConfigUploadBody([first, second])).toEqual({
      file0: first,
      file1: second,
    });
  });
});
