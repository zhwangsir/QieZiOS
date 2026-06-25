import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
} from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, indentUnit, foldGutter } from '@codemirror/language';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';

// CodeMirror 6 装配（被 CodeMirror.svelte 动态 import → 单独成 chunk，首屏不背它）。
// 语言用 html()：自动识别内嵌的 <style>/<script> 做 CSS/JS 高亮。主题用 oneDark（自带高亮样式）。
export function createEditor(
  parent: HTMLElement,
  doc: string,
  onChange: (value: string) => void,
): EditorView {
  return new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(),
        foldGutter(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        drawSelection(),
        history(),
        bracketMatching(),
        indentOnInput(),
        indentUnit.of('  '),
        html(),
        oneDark,
        keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of((u) => {
          if (u.docChanged) onChange(u.state.doc.toString());
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '12px' },
          '.cm-scroller': { overflow: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
        }),
      ],
    }),
  });
}

// 外部改了文本（重置示例 / 载入编辑某 App）时，把编辑器内容整体替换。
export function replaceDoc(view: EditorView, text: string): void {
  if (view.state.doc.toString() === text) return;
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
}
