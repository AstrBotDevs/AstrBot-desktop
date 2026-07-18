import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const patchMonacoCssNestingWarnings = async ({ dashboardDir, projectRoot }) => {
  const patchRules = [
    {
      file: path.join(
        dashboardDir,
        'node_modules',
        'monaco-editor',
        'esm',
        'vs',
        'editor',
        'browser',
        'widget',
        'multiDiffEditor',
        'style.css',
      ),
      selector: 'a',
    },
    {
      file: path.join(
        dashboardDir,
        'node_modules',
        'monaco-editor',
        'esm',
        'vs',
        'editor',
        'contrib',
        'inlineEdits',
        'browser',
        'inlineEditsWidget.css',
      ),
      selector: 'svg',
    },
  ];

  for (const { file, selector } of patchRules) {
    if (!existsSync(file)) {
      continue;
    }
    const css = await readFile(file, 'utf8');
    const pattern = new RegExp(`^(\\s*)${selector}\\s*\\{`, 'm');
    if (!pattern.test(css)) {
      continue;
    }

    const patched = css.replace(pattern, `$1& ${selector} {`);
    if (patched !== css) {
      await writeFile(file, patched, 'utf8');
      console.log(
        `[prepare-resources] Patched Monaco nested selector "${selector}" in ${path.relative(projectRoot, file)}`,
      );
    }
  }
};
