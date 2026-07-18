import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import 'monaco-editor/esm/vs/basic-languages/monaco.contribution';
import 'monaco-editor/esm/vs/language/css/monaco.contribution';
import 'monaco-editor/esm/vs/language/html/monaco.contribution';
import 'monaco-editor/esm/vs/language/json/monaco.contribution';
import 'monaco-editor/esm/vs/language/typescript/monaco.contribution';
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker';
import TypeScriptWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';
import { resolveMonacoWorkerKind } from './workerRouting';

const workerGlobal = globalThis as typeof globalThis & {
  MonacoEnvironment: { getWorker: (moduleId: string, label: string) => Worker };
};

workerGlobal.MonacoEnvironment = {
  getWorker(_moduleId: string, label: string) {
    switch (resolveMonacoWorkerKind(label)) {
      case 'json':
        return new JsonWorker();
      case 'css':
        return new CssWorker();
      case 'html':
        return new HtmlWorker();
      case 'typescript':
        return new TypeScriptWorker();
      default:
        return new EditorWorker();
    }
  },
};

export { monaco };
