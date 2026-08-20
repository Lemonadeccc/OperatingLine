export const procedureTreeEditorUiContentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const procedureTreeEditorUiHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': procedureTreeEditorUiContentSecurityPolicy,
  'cross-origin-opener-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

export interface ProcedureTreeEditorUiAsset {
  readonly body: string;
  readonly contentType: string;
  readonly headers: Readonly<Record<string, string>>;
}

const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="dark">
    <title>OperatingLine · ProcedureTree 工作台</title>
    <link rel="stylesheet" href="/procedure-editor/styles.css">
    <script src="/procedure-editor/app.js" defer></script>
  </head>
  <body>
    <a class="skip-link" href="#workspace">跳到编辑工作区</a>
    <header class="masthead">
      <div class="brand-lockup" aria-label="OperatingLine ProcedureTree Editor">
        <span class="brand-mark" aria-hidden="true">OL</span>
        <div>
          <p class="eyebrow">OperatingLine / Local authoring surface</p>
          <h1>ProcedureTree 工作台</h1>
        </div>
      </div>
      <div class="safety-banner" role="note">
        <span class="safety-dot" aria-hidden="true"></span>
        仅编辑本地 ProcedureTree · 不会创建 Proposal · 不会执行 Blender
      </div>
    </header>

    <main id="workspace" class="workspace" tabindex="-1">
      <section class="topbar" aria-labelledby="open-tree-title">
        <div>
          <p class="section-number">01 / OPEN</p>
          <h2 id="open-tree-title">打开制作谱系</h2>
        </div>
        <form id="tree-form" class="tree-form">
          <label for="tree-id">ProcedureTree ID</label>
          <div class="field-row">
            <input id="tree-id" name="treeId" required autocomplete="off" spellcheck="false" placeholder="例如: tutorial_eye_build">
            <button class="button button-primary" type="submit">加载</button>
          </div>
        </form>
        <div class="branch-control">
          <label for="branch-select">当前分支</label>
          <div class="field-row">
            <select id="branch-select" disabled><option value="">尚未加载</option></select>
            <button id="new-branch-button" class="button button-quiet" type="button" disabled>新建分支</button>
          </div>
        </div>
      </section>

      <section id="empty-state" class="empty-state">
        <div class="empty-glyph" aria-hidden="true"><span></span><span></span><span></span></div>
        <p class="eyebrow">Ready for a procedure</p>
        <h2>把复杂的 Blender 操作，拆成看得见、改得动的制作路径。</h2>
        <p>输入已有 ProcedureTree ID。访问令牌只保留在当前标签页的 sessionStorage 中。</p>
      </section>

      <section id="editor-shell" class="editor-shell" hidden>
        <aside class="rail tree-rail" aria-labelledby="tree-heading">
          <div class="panel-heading">
            <div>
              <p class="section-number">02 / STRUCTURE</p>
              <h2 id="tree-heading">步骤树</h2>
            </div>
            <span id="revision-badge" class="revision-badge">r—</span>
          </div>
          <div id="tree-summary" class="tree-summary"></div>
          <nav id="tree-view" class="tree-view" aria-label="ProcedureTree 层级"></nav>
        </aside>

        <section class="canvas" aria-labelledby="detail-heading">
          <div class="panel-heading canvas-heading">
            <div>
              <p class="section-number">03 / AUTHOR</p>
              <h2 id="detail-heading">选择节点开始编辑</h2>
            </div>
            <span id="dirty-state" class="dirty-state">已同步</span>
          </div>
          <div id="selection-detail" class="selection-detail"></div>
          <section class="parameter-panel" aria-labelledby="parameter-heading">
            <div class="subheading">
              <h3 id="parameter-heading">参数表单</h3>
              <span id="parameter-kind" class="modality-pill">未选择操作</span>
            </div>
            <form id="parameter-form" class="parameter-form">
              <p class="muted">选择 Action、语义、菜单、快捷键或 MCP 操作后载入参数。</p>
            </form>
          </section>
          <section class="preview-panel" aria-labelledby="preview-heading">
            <div class="subheading">
              <h3 id="preview-heading">变更预览</h3>
              <span id="preview-count" class="count-badge">0</span>
            </div>
            <label for="commit-message">Revision 说明</label>
            <textarea id="commit-message" rows="2" maxlength="4000" placeholder="说明这次调整的意图"></textarea>
            <div id="diff-list" class="diff-list"><p class="muted">预览后显示稳定 ID 级别的差异。</p></div>
            <div class="action-row">
              <button id="preview-button" class="button button-quiet" type="button">预览差异</button>
              <button id="commit-button" class="button button-primary" type="button" disabled>提交 Revision</button>
            </div>
          </section>
        </section>

        <aside class="rail context-rail">
          <section aria-labelledby="history-heading">
            <div class="panel-heading compact">
              <div><p class="section-number">04 / TRACE</p><h2 id="history-heading">Revision 历史</h2></div>
              <button id="refresh-history" class="icon-button" type="button" aria-label="刷新 Revision 历史">↻</button>
            </div>
            <ol id="history-list" class="history-list"></ol>
          </section>
          <section aria-labelledby="comments-heading">
            <div class="subheading"><h3 id="comments-heading">锚点评论</h3><span id="comment-count" class="count-badge">0</span></div>
            <div id="comment-list" class="comment-list"></div>
            <form id="comment-form" class="comment-form">
              <label for="comment-body">评论当前选择</label>
              <textarea id="comment-body" required rows="3" maxlength="4000" placeholder="记录需要精修的地方"></textarea>
              <button class="button button-quiet" type="submit">添加评论</button>
            </form>
          </section>
          <section aria-labelledby="merge-heading">
            <div class="subheading"><h3 id="merge-heading">合并分支</h3><span class="modality-pill">三方合并</span></div>
            <label for="source-branch">来源分支</label>
            <select id="source-branch"><option value="">选择来源分支</option></select>
            <div id="merge-result" class="merge-result"><p class="muted">先选择另一个分支。</p></div>
            <div class="action-row stacked">
              <button id="merge-preview-button" class="button button-quiet" type="button" disabled>预览合并</button>
              <button id="merge-resolve-button" class="button button-quiet" type="button" disabled hidden>解决并重新预览</button>
              <button id="merge-commit-button" class="button button-danger" type="button" disabled>提交合并 Revision</button>
            </div>
          </section>
        </aside>
      </section>
    </main>

    <dialog id="branch-dialog" aria-labelledby="branch-dialog-title">
      <form id="branch-form" method="dialog">
        <p class="section-number">NEW LINEAGE</p>
        <h2 id="branch-dialog-title">从当前 Revision 建立分支</h2>
        <label for="branch-name">分支名称</label>
        <input id="branch-name" name="branchName" required maxlength="120" autocomplete="off" placeholder="例如：眼睛比例调整">
        <div class="action-row">
          <button id="cancel-branch" class="button button-quiet" type="button">取消</button>
          <button class="button button-primary" type="submit">创建</button>
        </div>
      </form>
    </dialog>

    <div id="status" class="status" role="status" aria-live="polite" aria-atomic="true"></div>
  </body>
</html>`;

const css = `:root {
  color-scheme: dark;
  --ink: #111313;
  --ink-soft: #191c1c;
  --panel: #202424;
  --panel-raised: #292e2d;
  --line: #3d4542;
  --line-bright: #5f6965;
  --paper: #e9e2d3;
  --paper-muted: #aaa596;
  --accent: #ef5b36;
  --accent-soft: #8e3522;
  --lime: #c7d572;
  --cyan: #79c7bf;
  --danger: #ff8065;
  --shadow: 0 24px 80px rgba(0, 0, 0, .34);
  --display: "Iowan Old Style", "Palatino Linotype", Palatino, serif;
  --interface: "Aptos Display", "Gill Sans", "Trebuchet MS", sans-serif;
  --mono: "IBM Plex Mono", "Cascadia Mono", "SFMono-Regular", monospace;
}

* { box-sizing: border-box; }
html { min-width: 320px; background: var(--ink); }
body { margin: 0; min-height: 100vh; color: var(--paper); background: radial-gradient(circle at 15% 0%, #303633 0, transparent 27rem), var(--ink); font-family: var(--interface); }
button, input, select, textarea { font: inherit; }
button, select { cursor: pointer; }
button:disabled, select:disabled { cursor: not-allowed; opacity: .45; }
:focus-visible { outline: 2px solid var(--lime); outline-offset: 3px; }
[hidden] { display: none !important; }

.skip-link { position: fixed; left: 1rem; top: -5rem; z-index: 20; padding: .7rem 1rem; color: var(--ink); background: var(--lime); }
.skip-link:focus { top: 1rem; }
.masthead { min-height: 7.2rem; display: flex; align-items: center; justify-content: space-between; gap: 2rem; padding: 1.4rem clamp(1rem, 3vw, 3.5rem); border-bottom: 1px solid var(--line); }
.brand-lockup { display: flex; align-items: center; gap: 1rem; }
.brand-mark { display: grid; place-items: center; width: 3.25rem; aspect-ratio: 1; border: 1px solid var(--paper); border-radius: 50%; color: var(--accent); font: 700 .82rem var(--mono); letter-spacing: .08em; }
h1, h2, h3, p { margin-top: 0; }
h1 { margin-bottom: 0; font: 500 clamp(1.65rem, 3vw, 2.55rem)/.95 var(--display); letter-spacing: -.035em; }
h2 { margin-bottom: 0; font: 500 1.4rem/1.08 var(--display); letter-spacing: -.025em; }
h3 { margin-bottom: 0; font-size: .95rem; letter-spacing: .01em; }
.eyebrow, .section-number { margin-bottom: .38rem; color: var(--paper-muted); font: 600 .67rem/1.2 var(--mono); letter-spacing: .13em; text-transform: uppercase; }
.safety-banner { display: flex; align-items: center; gap: .65rem; max-width: 31rem; padding: .7rem .9rem; border: 1px solid var(--line); color: var(--paper-muted); font-size: .78rem; }
.safety-dot { width: .45rem; height: .45rem; border-radius: 50%; background: var(--lime); box-shadow: 0 0 0 .24rem rgba(199, 213, 114, .12); }

.workspace { padding: 0 clamp(1rem, 3vw, 3.5rem) 3rem; }
.topbar { display: grid; grid-template-columns: minmax(12rem, .65fr) minmax(18rem, 1fr) minmax(17rem, .7fr); gap: 2rem; align-items: end; padding: 1.5rem 0; border-bottom: 1px solid var(--line); }
label { display: block; margin-bottom: .42rem; color: var(--paper-muted); font: 600 .69rem var(--mono); letter-spacing: .06em; text-transform: uppercase; }
input, select, textarea { width: 100%; min-width: 0; border: 1px solid var(--line); border-radius: 0; color: var(--paper); background: var(--ink-soft); padding: .72rem .78rem; }
textarea { resize: vertical; line-height: 1.45; }
input::placeholder, textarea::placeholder { color: #737873; }
.field-row, .action-row { display: flex; gap: .6rem; align-items: stretch; }
.field-row input, .field-row select { flex: 1; }
.button { border: 1px solid var(--line-bright); padding: .68rem .9rem; color: var(--paper); background: transparent; font: 700 .72rem var(--mono); letter-spacing: .045em; white-space: nowrap; transition: transform 140ms ease, border-color 140ms ease, background 140ms ease; }
.button:hover:not(:disabled) { transform: translateY(-1px); border-color: var(--paper-muted); }
.button-primary { border-color: var(--accent); color: #170a06; background: var(--accent); }
.button-quiet { background: var(--panel-raised); }
.button-danger { border-color: var(--danger); color: var(--danger); }
.icon-button { width: 2rem; height: 2rem; border: 1px solid var(--line); color: var(--paper); background: transparent; font-size: 1rem; }

.empty-state { min-height: 60vh; display: grid; place-content: center; justify-items: center; text-align: center; padding: 4rem 1rem; animation: rise 500ms ease both; }
.empty-state h2 { max-width: 42rem; font-size: clamp(2rem, 5vw, 4.2rem); }
.empty-state > p:last-child { max-width: 34rem; color: var(--paper-muted); }
.empty-glyph { position: relative; width: 8rem; height: 5rem; margin-bottom: 2rem; }
.empty-glyph span { position: absolute; left: 0; width: 100%; height: 1px; background: var(--line-bright); transform-origin: left; }
.empty-glyph span:nth-child(1) { top: 0; transform: rotate(12deg); }
.empty-glyph span:nth-child(2) { top: 50%; width: 72%; background: var(--accent); transform: rotate(-8deg); }
.empty-glyph span:nth-child(3) { bottom: 0; width: 46%; transform: rotate(17deg); }

.editor-shell { display: grid; grid-template-columns: minmax(16rem, .75fr) minmax(25rem, 1.35fr) minmax(18rem, .82fr); min-height: calc(100vh - 15rem); border-bottom: 1px solid var(--line); animation: rise 350ms ease both; }
.rail, .canvas { min-width: 0; padding: 1.4rem; }
.tree-rail { border-right: 1px solid var(--line); padding-left: 0; }
.context-rail { border-left: 1px solid var(--line); padding-right: 0; }
.context-rail > section + section { margin-top: 1.8rem; padding-top: 1.8rem; border-top: 1px solid var(--line); }
.panel-heading, .subheading { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin-bottom: 1.15rem; }
.panel-heading.compact { margin-bottom: .8rem; }
.revision-badge, .count-badge, .modality-pill, .dirty-state { border: 1px solid var(--line); padding: .25rem .48rem; color: var(--paper-muted); font: 600 .63rem var(--mono); letter-spacing: .05em; }
.dirty-state.is-dirty { border-color: var(--accent); color: var(--accent); }
.tree-summary { padding: .8rem; margin-bottom: 1rem; border-left: 2px solid var(--accent); background: var(--ink-soft); }
.tree-summary strong { display: block; font: 500 1.2rem var(--display); }
.tree-summary span { color: var(--paper-muted); font: .67rem var(--mono); }
.tree-view { display: grid; gap: .35rem; }
.tree-node { position: relative; width: 100%; display: grid; grid-template-columns: 1.8rem 1fr auto; gap: .6rem; align-items: center; padding: .65rem .55rem; border: 1px solid transparent; color: var(--paper); background: transparent; text-align: left; }
.tree-node::before { content: ""; position: absolute; left: calc(var(--depth, 0) * .8rem); top: -1px; bottom: -1px; width: 1px; background: var(--line); }
.tree-node:hover { background: var(--ink-soft); }
.tree-node[aria-current="true"] { border-color: var(--line-bright); background: var(--panel); }
.tree-node-index { color: var(--accent); font: 600 .64rem var(--mono); }
.tree-node-copy { padding-left: calc(var(--depth, 0) * .8rem); overflow: hidden; }
.tree-node-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; font-size: .84rem; white-space: nowrap; }
.tree-node-copy small { color: var(--paper-muted); font: .6rem var(--mono); text-transform: uppercase; }
.tree-node-kind { width: .45rem; height: .45rem; border-radius: 50%; background: var(--line-bright); }
.tree-node-kind.leaf { background: var(--lime); }
.depth-0 { --depth: 0; }
.depth-1 { --depth: 1; }
.depth-2 { --depth: 2; }
.depth-3 { --depth: 3; }
.depth-4 { --depth: 4; }
.depth-5 { --depth: 5; }
.depth-6 { --depth: 6; }
.depth-7 { --depth: 7; }
.depth-8 { --depth: 8; }

.canvas { display: grid; align-content: start; gap: 1.5rem; }
.canvas-heading { margin-bottom: 0; }
.selection-detail { min-height: 8rem; padding: 1rem; border: 1px solid var(--line); background: linear-gradient(135deg, var(--panel) 0 55%, var(--ink-soft) 55%); }
.selection-detail-grid { display: grid; grid-template-columns: 1fr 1fr; gap: .8rem; }
.selection-detail .wide { grid-column: 1 / -1; }
.operation-tabs { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: .9rem; }
.operation-button { border: 1px solid var(--line); padding: .42rem .58rem; color: var(--paper-muted); background: var(--ink); font: .65rem var(--mono); }
.operation-button:hover, .operation-button[aria-pressed="true"] { border-color: var(--cyan); color: var(--cyan); }
.structure-panel { grid-column: 1 / -1; display: grid; gap: .7rem; padding-top: .9rem; border-top: 1px solid var(--line); }
.structure-panel h3 { font-family: var(--mono); }
.structure-actions { display: flex; flex-wrap: wrap; gap: .4rem; }
.structure-actions .button { padding: .45rem .58rem; font-size: .65rem; }
.structure-list { display: grid; gap: .45rem; }
.structure-row { display: grid; grid-template-columns: minmax(8rem, 1fr) auto; gap: .6rem; align-items: center; padding: .55rem; border: 1px solid var(--line); background: var(--ink); }
.structure-row-copy { min-width: 0; }
.structure-row-copy strong, .structure-row-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.structure-row-copy strong { font-size: .75rem; }
.structure-row-copy small { margin-top: .2rem; color: var(--paper-muted); font: .6rem var(--mono); }
.structure-row .structure-actions { justify-content: flex-end; }
.structure-edit-fields { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; }
.move-field { display: grid; grid-template-columns: minmax(8rem, 1fr) auto; gap: .4rem; align-items: end; }
.parameter-panel, .preview-panel { padding-top: 1.2rem; border-top: 1px solid var(--line); }
.parameter-form { display: grid; grid-template-columns: 1fr 1fr; gap: .8rem; }
.parameter-field.readonly { opacity: .62; }
.parameter-field.wide { grid-column: 1 / -1; }
.parameter-field small { display: block; margin-top: .3rem; color: var(--paper-muted); font-size: .68rem; line-height: 1.35; }
.vector-row { display: grid; grid-template-columns: repeat(var(--vector-length), 1fr); gap: .35rem; }
.vector-length-1 { --vector-length: 1; }
.vector-length-2 { --vector-length: 2; }
.vector-length-3 { --vector-length: 3; }
.vector-length-4 { --vector-length: 4; }
.preview-panel > label { margin-top: .8rem; }
.diff-list { max-height: 14rem; overflow: auto; margin: .8rem 0; border: 1px solid var(--line); }
.diff-entry { display: grid; grid-template-columns: 4.5rem 1fr; gap: .6rem; padding: .6rem; border-bottom: 1px solid var(--line); font: .67rem/1.4 var(--mono); }
.diff-entry:last-child { border-bottom: 0; }
.diff-operation { color: var(--lime); text-transform: uppercase; }
.diff-entry.remove .diff-operation { color: var(--danger); }
.diff-entry.replace .diff-operation { color: var(--cyan); }
.muted { margin-bottom: 0; color: var(--paper-muted); font-size: .76rem; line-height: 1.5; }

.history-list, .comment-list { margin: 0; padding: 0; list-style: none; }
.history-item { display: grid; grid-template-columns: 2.4rem 1fr; gap: .65rem; padding: .65rem 0; border-bottom: 1px solid var(--line); }
.history-revision { color: var(--accent); font: 700 .7rem var(--mono); }
.history-copy strong { display: block; font-size: .76rem; }
.history-copy small { color: var(--paper-muted); font: .61rem var(--mono); }
.comment-list { max-height: 14rem; overflow: auto; }
.comment-card { margin-bottom: .55rem; padding: .7rem; background: var(--panel); }
.comment-card p { margin-bottom: .4rem; font-size: .76rem; line-height: 1.45; white-space: pre-wrap; }
.comment-card small { color: var(--paper-muted); font: .6rem var(--mono); }
.comment-form { margin-top: .75rem; }
.comment-form .button { margin-top: .5rem; width: 100%; }
.merge-result { min-height: 4rem; margin: .75rem 0; }
.merge-ready { padding: .65rem; border-left: 2px solid var(--lime); background: var(--panel); color: var(--lime); font-size: .74rem; }
.conflict-card { padding: .65rem; border-left: 2px solid var(--danger); background: var(--panel); font: .64rem/1.45 var(--mono); }
.conflict-card + .conflict-card { margin-top: .4rem; }
.conflict-resolution { margin-top: .65rem; padding-top: .65rem; border-top: 1px solid var(--line); }
.conflict-custom { display: grid; gap: .45rem; margin-top: .5rem; }
.stacked { flex-direction: column; }

dialog { width: min(30rem, calc(100vw - 2rem)); border: 1px solid var(--line-bright); color: var(--paper); background: var(--panel); box-shadow: var(--shadow); }
dialog::backdrop { background: rgba(5, 7, 7, .82); backdrop-filter: blur(5px); }
dialog h2 { margin-bottom: 1.5rem; font-size: 1.8rem; }
dialog .action-row { margin-top: 1rem; justify-content: flex-end; }
.status { position: fixed; right: 1.2rem; bottom: 1.2rem; z-index: 10; max-width: min(30rem, calc(100vw - 2.4rem)); transform: translateY(1rem); opacity: 0; pointer-events: none; padding: .8rem 1rem; border: 1px solid var(--line-bright); color: var(--paper); background: var(--panel-raised); box-shadow: var(--shadow); font-size: .78rem; transition: opacity 180ms ease, transform 180ms ease; }
.status.visible { transform: translateY(0); opacity: 1; }
.status.error { border-color: var(--danger); color: #ffd4ca; }

@keyframes rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: translateY(0); } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; animation-duration: .01ms !important; transition-duration: .01ms !important; } }
@media (max-width: 1050px) {
  .topbar { grid-template-columns: 1fr 1fr; }
  .topbar > div:first-child { grid-column: 1 / -1; }
  .editor-shell { grid-template-columns: minmax(15rem, .75fr) minmax(24rem, 1.25fr); }
  .context-rail { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(3, 1fr); gap: 1.5rem; border-top: 1px solid var(--line); border-left: 0; padding-left: 0; }
  .context-rail > section + section { margin: 0; padding: 0 0 0 1.5rem; border-top: 0; border-left: 1px solid var(--line); }
}
@media (max-width: 720px) {
  .masthead { align-items: flex-start; flex-direction: column; }
  .safety-banner { width: 100%; }
  .topbar, .editor-shell { grid-template-columns: 1fr; }
  .tree-form, .branch-control { grid-column: 1; }
  .tree-rail, .context-rail { border: 0; padding: 1.2rem 0; }
  .tree-rail { border-bottom: 1px solid var(--line); }
  .canvas { padding: 1.4rem 0; }
  .context-rail { display: block; border-top: 1px solid var(--line); }
  .context-rail > section + section { margin-top: 1.5rem; padding: 1.5rem 0 0; border-top: 1px solid var(--line); border-left: 0; }
  .parameter-form, .selection-detail-grid { grid-template-columns: 1fr; }
  .selection-detail .wide, .parameter-field.wide, .structure-panel { grid-column: 1; }
  .structure-row { grid-template-columns: 1fr; }
  .structure-row .structure-actions { justify-content: flex-start; }
  .structure-edit-fields { grid-template-columns: 1fr; }
  .field-row { flex-wrap: wrap; }
  .field-row .button { flex: 1; }
}
`;

const javascript = `(() => {
  'use strict';

  const FORMAT_VERSION = '1.0.0';
  const TOKEN_KEY = 'operatingline.procedure-editor.token';
  const API = Object.freeze({
    latest: '/api/v1/procedure',
    createBranch: '/api/v1/procedure/editor/branches/create',
    getBranch: '/api/v1/procedure/editor/branches/get',
    listBranches: '/api/v1/procedure/editor/branches/list',
    getWorkspace: '/api/v1/procedure/editor/workspaces/get',
    listHistory: '/api/v1/procedure/editor/history/list',
    previewEdit: '/api/v1/procedure/editor/edits/preview',
    previewMerge: '/api/v1/procedure/editor/merges/preview',
    createCommit: '/api/v1/procedure/editor/commits/create',
    createComment: '/api/v1/procedure/editor/comments/create',
    listComments: '/api/v1/procedure/editor/comments/list',
    parameterForm: '/api/v1/procedure/editor/parameters/form'
  });

  const state = {
    token: '', treeId: '', latest: null, branches: [], branch: null, workspace: null,
    targetTree: null, selected: null, parameterResult: null, preview: null, mergePreview: null,
    previewSnapshot: null, mergeSnapshot: null, activeTreeLoad: null, dirty: false, mutationEpoch: 0,
    historyLoadId: 0, commentsLoadId: 0, parameterFormLoadId: 0, commentCreateId: 0,
    commitInFlight: false
  };
  const allocatedStableIds = new Set();
  const byId = (id) => document.getElementById(id);
  const elements = {
    treeForm: byId('tree-form'), treeId: byId('tree-id'), branchSelect: byId('branch-select'),
    newBranch: byId('new-branch-button'), branchDialog: byId('branch-dialog'),
    branchForm: byId('branch-form'), cancelBranch: byId('cancel-branch'), branchName: byId('branch-name'),
    empty: byId('empty-state'), shell: byId('editor-shell'), treeView: byId('tree-view'),
    treeSummary: byId('tree-summary'), revision: byId('revision-badge'), detailHeading: byId('detail-heading'),
    detail: byId('selection-detail'), dirty: byId('dirty-state'), parameterKind: byId('parameter-kind'),
    parameterForm: byId('parameter-form'), commitMessage: byId('commit-message'), diffList: byId('diff-list'),
    previewCount: byId('preview-count'), previewButton: byId('preview-button'), commitButton: byId('commit-button'),
    history: byId('history-list'), refreshHistory: byId('refresh-history'), commentCount: byId('comment-count'),
    comments: byId('comment-list'), commentForm: byId('comment-form'), commentBody: byId('comment-body'),
    sourceBranch: byId('source-branch'), mergeResult: byId('merge-result'),
    mergePreviewButton: byId('merge-preview-button'), mergeCommitButton: byId('merge-commit-button'),
    mergeResolveButton: byId('merge-resolve-button'),
    status: byId('status')
  };

  function consumeFragmentToken() {
    const fragment = new URLSearchParams(window.location.hash.slice(1));
    const token = fragment.get('token');
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search);
    return sessionStorage.getItem(TOKEN_KEY) || '';
  }

  function uuid() {
    return crypto.randomUUID();
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function canonicalSnapshot(value) {
    if (Array.isArray(value)) return '[' + value.map(canonicalSnapshot).join(',') + ']';
    if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map((key) => JSON.stringify(key) + ':' + canonicalSnapshot(value[key])).join(',') + '}';
    return JSON.stringify(value);
  }

  function bumpMutationEpoch() {
    state.mutationEpoch += 1;
    return state.mutationEpoch;
  }

  function allStableIds() {
    const ids = new Set();
    if (!state.targetTree) return ids;
    state.targetTree.nodes.forEach((node) => {
      ids.add(node.id);
      if (node.kind !== 'leaf') return;
      node.semanticOperations.forEach((operation) => ids.add(operation.id));
      [node.menuTracks, node.shortcutTracks, node.mcpTracks].forEach((tracks) => tracks.forEach((track) => {
        ids.add(track.id);
        if (track.availability === 'available') track.operations.forEach((operation) => ids.add(operation.id));
      }));
    });
    return ids;
  }

  function newStableId(prefix) {
    const ids = allStableIds();
    let candidate;
    do candidate = prefix + '.' + uuid(); while (ids.has(candidate) || allocatedStableIds.has(candidate));
    allocatedStableIds.add(candidate);
    return candidate;
  }

  function normalizeOrder(items) {
    items.sort((left, right) => left.order - right.order).forEach((item, index) => { item.order = index + 1; });
  }

  function siblings(parentId) {
    return state.targetTree.nodes.filter((node) => node.parentId === parentId);
  }

  function reorderCollection(items, id, direction) {
    normalizeOrder(items);
    const index = items.findIndex((item) => item.id === id);
    const destination = index + direction;
    if (index < 0 || destination < 0 || destination >= items.length) return false;
    const currentOrder = items[index].order;
    items[index].order = items[destination].order;
    items[destination].order = currentOrder;
    normalizeOrder(items);
    return true;
  }

  function defaultSemanticOperation() {
    return {
      id: newStableId('semantic'), order: 1, semanticAction: newStableId('draft.semantic'),
      description: '请配置语义操作描述。', parameters: {}, evidenceRefs: []
    };
  }

  function defaultUnavailableTrack(modality) {
    return {
      id: newStableId(modality + '.track'), availability: 'unavailable', title: modality.toUpperCase() + ' 暂不可用',
      reason: '尚未配置此交互轨迹。', modality: modality
    };
  }

  function defaultLeaf(parentId, order) {
    const semantic = defaultSemanticOperation();
    return {
      id: newStableId('node.leaf'), parentId: parentId, order: order, dependsOn: [], title: '新建叶子步骤',
      intent: '描述这个叶子步骤的制作意图。', kind: 'leaf', action: null,
      semanticOperations: [semantic], menuTracks: [defaultUnavailableTrack('menu')],
      shortcutTracks: [defaultUnavailableTrack('shortcut')], mcpTracks: [defaultUnavailableTrack('mcp')],
      anchors: [], expectedObservations: [], rollback: { mode: 'checkpoint_restore', checkpointRequired: true },
      validation: { status: 'candidate', validatedHostVersions: [], notes: [] }
    };
  }

  function addNode(kind, parentId) {
    if (!state.branch || !state.targetTree) return;
    const parent = state.targetTree.nodes.find((node) => node.id === parentId);
    if (!parent || parent.kind !== 'group') {
      showStatus('只能把新节点添加到分组节点。', true); return;
    }
    const order = siblings(parentId).length + 1;
    if (kind === 'leaf') {
      const leaf = defaultLeaf(parentId, order);
      state.targetTree.nodes.push(leaf);
      state.selected = { kind: 'node', nodeId: leaf.id };
    } else {
      const group = {
        id: newStableId('node.group'), parentId: parentId, order: order, dependsOn: [],
        title: '新建步骤组', intent: '描述这个步骤组的制作意图。', kind: 'group'
      };
      state.targetTree.nodes.push(group);
      const starter = defaultLeaf(group.id, 1);
      state.targetTree.nodes.push(starter);
      state.selected = { kind: 'node', nodeId: group.id };
    }
    finishStructureEdit('节点已添加到本地候选树。');
  }

  function descendantIds(nodeId) {
    const result = new Set([nodeId]);
    let changed = true;
    while (changed) {
      changed = false;
      state.targetTree.nodes.forEach((node) => {
        if (node.parentId && result.has(node.parentId) && !result.has(node.id)) { result.add(node.id); changed = true; }
      });
    }
    return result;
  }

  function propertyUpdateCount(nodes) {
    let count = 0;
    nodes.forEach((item) => {
      if (item.kind !== 'leaf') return;
      item.shortcutTracks.forEach((track) => {
        if (track.availability === 'available') track.operations.forEach((operation) => {
          if (operation.kind === 'operator_property_update') count += 1;
        });
      });
    });
    return count;
  }

  function deleteNode(nodeId) {
    const node = state.targetTree.nodes.find((item) => item.id === nodeId);
    if (!node || node.id === state.targetTree.rootNodeId) { showStatus('根节点不能删除。', true); return; }
    if (siblings(node.parentId).length === 1) { showStatus('父分组必须至少保留一个子节点。', true); return; }
    const removed = descendantIds(nodeId);
    if (state.targetTree.formatVersion === '1.1.0' && propertyUpdateCount(state.targetTree.nodes.filter((item) => !removed.has(item.id))) === 0) {
      showStatus('格式 1.1.0 必须保留至少一个 operator_property_update 快捷键操作。', true); return;
    }
    const label = node.kind === 'group' ? '这个分组及其所有后代' : '这个叶子节点';
    if (!window.confirm('确认从本地候选树删除' + label + '“' + node.title + '”？')) return;
    state.targetTree.nodes = state.targetTree.nodes.filter((item) => !removed.has(item.id));
    state.targetTree.nodes.forEach((item) => { item.dependsOn = item.dependsOn.filter((dependency) => !removed.has(dependency)); });
    normalizeOrder(siblings(node.parentId));
    state.selected = { kind: 'node', nodeId: node.parentId };
    finishStructureEdit('节点已从本地候选树删除。');
  }

  function moveNode(nodeId, newParentId) {
    const node = state.targetTree.nodes.find((item) => item.id === nodeId);
    const parent = state.targetTree.nodes.find((item) => item.id === newParentId);
    if (!node || node.id === state.targetTree.rootNodeId) { showStatus('根节点不能移动。', true); return; }
    if (!parent || parent.kind !== 'group') { showStatus('目标父节点必须是分组。', true); return; }
    if (descendantIds(nodeId).has(newParentId)) { showStatus('不能把节点移动到自己的后代中。', true); return; }
    if (node.parentId === newParentId) return;
    const oldParentId = node.parentId;
    if (siblings(oldParentId).length === 1) { showStatus('原父分组必须至少保留一个子节点。', true); return; }
    node.parentId = newParentId;
    node.order = siblings(newParentId).length;
    normalizeOrder(siblings(oldParentId)); normalizeOrder(siblings(newParentId));
    finishStructureEdit('节点已移动。');
  }

  function reorderNode(nodeId, direction) {
    const node = state.targetTree.nodes.find((item) => item.id === nodeId);
    if (!node || node.id === state.targetTree.rootNodeId) return;
    if (reorderCollection(siblings(node.parentId), nodeId, direction)) finishStructureEdit('节点顺序已更新。');
  }

  function finishStructureEdit(message) {
    state.parameterResult = null;
    markDirty(); renderTree(); renderDetail();
    loadComments().catch(handleError);
    showStatus(message);
  }

  function showStatus(message, isError) {
    elements.status.textContent = message;
    elements.status.classList.toggle('error', Boolean(isError));
    elements.status.classList.add('visible');
    window.clearTimeout(showStatus.timer);
    showStatus.timer = window.setTimeout(() => elements.status.classList.remove('visible'), 4200);
  }

  async function request(path, body, method) {
    if (!state.token) throw new Error('缺少访问令牌。请使用 #token=… 打开此页面。');
    const options = { method: method || 'POST', headers: { authorization: 'Bearer ' + state.token } };
    if (body !== undefined) {
      options.headers['content-type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch(path, options);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload.message || payload.error || '请求失败 (' + response.status + ')';
      throw new Error(message);
    }
    return payload;
  }

  function versioned(body) {
    return Object.assign({ formatVersion: FORMAT_VERSION }, body);
  }

  async function listAllBranches(treeId) {
    const branches = []; let afterBranchId;
    do {
      const body = { treeId: treeId, limit: 100 };
      if (afterBranchId) body.afterBranchId = afterBranchId;
      const page = await request(API.listBranches, versioned(body));
      branches.push(...(page.branches || []));
      if (page.nextAfterBranchId === afterBranchId) throw new Error('分支分页游标没有前进。');
      afterBranchId = page.nextAfterBranchId;
    } while (afterBranchId);
    return branches;
  }

  function revisionRefFromLatest(payload) {
    const tree = payload.tree || payload.procedure || payload;
    const integrity = payload.integrity || tree.integrity;
    if (!tree || !tree.id || !integrity || !integrity.contentSha256) {
      throw new Error('Procedure 响应缺少 tree 或 integrity。');
    }
    return { tree: tree, ref: { treeId: tree.id, revision: tree.revision, contentSha256: integrity.contentSha256 } };
  }

  async function loadTree(treeId) {
    if (!confirmDiscardChanges('加载另一棵 ProcedureTree')) return;
    const loadEpoch = bumpMutationEpoch();
    const loadToken = uuid(); state.activeTreeLoad = loadToken;
    setBusy(true);
    try {
      state.branch = null;
      state.workspace = null;
      state.targetTree = null;
      state.selected = null;
      state.parameterResult = null;
      state.preview = null;
      state.mergePreview = null;
      state.previewSnapshot = null;
      state.mergeSnapshot = null;
      state.dirty = false;
      const latestPayload = await request(API.latest + '?treeId=' + encodeURIComponent(treeId), undefined, 'GET');
      if (state.mutationEpoch !== loadEpoch) return;
      const latest = revisionRefFromLatest(latestPayload);
      state.treeId = treeId;
      state.latest = latest.ref;
      state.branches = await listAllBranches(treeId);
      if (state.mutationEpoch !== loadEpoch || state.treeId !== treeId) return;
      renderBranchOptions();
      if (state.branches.length > 0) {
        await selectBranch(state.branches[0].branchId);
      } else {
        state.branch = null;
        state.workspace = null;
        state.targetTree = latest.tree;
        renderUnbranched(latest.tree);
        elements.newBranch.disabled = false;
        showStatus('Procedure 已加载。请从当前 Revision 创建编辑分支。');
      }
    } finally {
      if (state.activeTreeLoad === loadToken) { state.activeTreeLoad = null; setBusy(false); }
    }
  }

  function setBusy(busy) {
    elements.previewButton.disabled = busy || !state.branch;
    elements.newBranch.disabled = busy || !state.latest;
    if (busy) elements.commitButton.disabled = true;
  }

  function renderUnbranched(tree) {
    elements.empty.hidden = true;
    elements.shell.hidden = false;
    elements.revision.textContent = 'r' + tree.revision;
    elements.treeSummary.innerHTML = '<strong></strong><span></span>';
    elements.treeSummary.querySelector('strong').textContent = tree.title;
    elements.treeSummary.querySelector('span').textContent = tree.adapterId + ' · 尚未建立分支';
    state.selected = { kind: 'tree' };
    renderTree();
    renderDetail();
  }

  async function selectBranch(branchId) {
    const selectionEpoch = bumpMutationEpoch();
    const treeId = state.treeId;
    const payload = await request(API.getWorkspace, versioned({ treeId: treeId, branchId: branchId }));
    if (state.mutationEpoch !== selectionEpoch || state.treeId !== treeId) return false;
    state.branch = payload.branch;
    state.workspace = payload;
    state.targetTree = clone(payload.tree);
    state.selected = { kind: 'tree' };
    state.preview = null;
    state.mergePreview = null;
    state.previewSnapshot = null;
    state.mergeSnapshot = null;
    state.dirty = false;
    renderBranchOptions();
    elements.branchSelect.value = branchId;
    elements.empty.hidden = true;
    elements.shell.hidden = false;
    renderAll();
    await Promise.all([loadHistory(), loadComments()]);
    return true;
  }

  function renderAll() {
    const tree = state.targetTree;
    if (!tree) return;
    elements.revision.textContent = 'r' + (state.branch ? state.branch.head.revision : tree.revision);
    elements.treeSummary.innerHTML = '<strong></strong><span></span>';
    elements.treeSummary.querySelector('strong').textContent = tree.title;
    elements.treeSummary.querySelector('span').textContent = tree.adapterId + ' · ' + tree.nodes.length + ' 个节点';
    elements.dirty.textContent = state.dirty ? '本地未提交' : '已同步';
    elements.dirty.classList.toggle('is-dirty', state.dirty);
    elements.commitButton.disabled = state.commitInFlight || !state.preview;
    renderTree();
    renderDetail();
    renderDiff();
    renderMerge();
  }

  function renderBranchOptions() {
    elements.branchSelect.replaceChildren();
    if (state.branches.length === 0) {
      elements.branchSelect.append(new Option('尚无分支', ''));
      elements.branchSelect.disabled = true;
    } else {
      state.branches.forEach((branch) => elements.branchSelect.append(new Option(branch.name + ' · r' + branch.head.revision, branch.branchId)));
      elements.branchSelect.disabled = false;
    }
    elements.sourceBranch.replaceChildren(new Option('选择来源分支', ''));
    state.branches.filter((branch) => !state.branch || branch.branchId !== state.branch.branchId)
      .forEach((branch) => elements.sourceBranch.append(new Option(branch.name + ' · r' + branch.head.revision, branch.branchId)));
    elements.mergePreviewButton.disabled = state.dirty || !state.branch || elements.sourceBranch.value === '';
  }

  function orderedNodes(tree) {
    const children = new Map();
    tree.nodes.forEach((node) => {
      const key = node.parentId || '__root__';
      const list = children.get(key) || [];
      list.push(node);
      children.set(key, list);
    });
    children.forEach((nodes) => nodes.sort((a, b) => a.order - b.order));
    const result = [];
    const visit = (parentId, depth) => (children.get(parentId) || []).forEach((node) => {
      result.push({ node: node, depth: depth });
      visit(node.id, depth + 1);
    });
    visit('__root__', 0);
    return result.length === tree.nodes.length ? result : tree.nodes.map((node) => ({ node: node, depth: 0 }));
  }

  function renderTree() {
    elements.treeView.replaceChildren();
    if (!state.targetTree) return;
    orderedNodes(state.targetTree).forEach((entry, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'tree-node depth-' + Math.min(entry.depth, 8);
      button.dataset.nodeId = entry.node.id;
      button.setAttribute('aria-current', String(Boolean(state.selected && state.selected.nodeId === entry.node.id)));
      const number = document.createElement('span');
      number.className = 'tree-node-index';
      number.textContent = String(index + 1).padStart(2, '0');
      const copy = document.createElement('span');
      copy.className = 'tree-node-copy';
      const title = document.createElement('strong');
      title.textContent = entry.node.title;
      const kind = document.createElement('small');
      kind.textContent = entry.node.kind === 'leaf' ? '叶子 / 可执行轨迹' : '大步骤 / 分组';
      copy.append(title, kind);
      const dot = document.createElement('span');
      dot.className = 'tree-node-kind ' + entry.node.kind;
      button.append(number, copy, dot);
      elements.treeView.append(button);
    });
  }

  function selectedNode() {
    if (!state.selected || !state.selected.nodeId || !state.targetTree) return null;
    return state.targetTree.nodes.find((node) => node.id === state.selected.nodeId) || null;
  }

  function operationDescriptors(node) {
    if (!node || node.kind !== 'leaf') return [];
    const descriptors = [];
    if (node.action) descriptors.push({ kind: 'action', nodeId: node.id, label: 'Action · ' + node.action.name });
    node.semanticOperations.forEach((operation) => descriptors.push({ kind: 'semantic', nodeId: node.id, operationId: operation.id, label: '语义 · ' + operation.semanticAction }));
    [['menu', node.menuTracks], ['shortcut', node.shortcutTracks], ['mcp', node.mcpTracks]].forEach((pair) => {
      const modality = pair[0];
      pair[1].filter((track) => track.availability === 'available').forEach((track) => {
        track.operations.forEach((operation) => descriptors.push({ kind: modality, nodeId: node.id, trackId: track.id, operationId: operation.id, label: modality.toUpperCase() + ' · ' + operation.description }));
      });
    });
    return descriptors;
  }

  function trackCollection(node, modality) {
    if (modality === 'menu') return node.menuTracks;
    if (modality === 'shortcut') return node.shortcutTracks;
    return node.mcpTracks;
  }

  function projectionTargetsOperation(node, modality, trackId, operationId) {
    if (!node.parameterProjection) return false;
    return node.parameterProjection.bindings.some((binding) => {
      const target = binding.target;
      if (target.modality !== modality || target.operationId !== operationId) return false;
      return modality === 'semantic' || target.trackId === trackId;
    });
  }

  function projectionTargetsTrack(node, modality, trackId) {
    if (!node.parameterProjection) return false;
    return node.parameterProjection.bindings.some((binding) => binding.target.modality === modality && binding.target.trackId === trackId);
  }

  function semanticOperationExistedAtLoad(nodeId, operationId) {
    if (!state.workspace) return false;
    const baseNode = state.workspace.tree.nodes.find((item) => item.id === nodeId);
    return Boolean(baseNode && baseNode.kind === 'leaf' && baseNode.semanticOperations.some((operation) => operation.id === operationId));
  }

  function deleteSemanticOperation(node, operationId) {
    if (node.semanticOperations.length === 1) { showStatus('叶子节点必须至少保留一个语义操作。', true); return; }
    const operation = node.semanticOperations.find((item) => item.id === operationId);
    if (projectionTargetsOperation(node, 'semantic', undefined, operationId)) {
      showStatus('目录参数投影仍绑定这个语义操作，不能单独删除。', true); return;
    }
    const referenced = [node.menuTracks, node.shortcutTracks, node.mcpTracks].some((tracks) => tracks.some((track) => track.availability === 'available' && track.operations.some((item) => item.semanticRefs.includes(operationId))));
    if (referenced) {
      showStatus('可用交互轨迹仍引用这个语义操作；请先删除对应轨迹或操作。', true); return;
    }
    if (!operation || !window.confirm('确认删除语义操作“' + operation.description + '”？')) return;
    node.semanticOperations = node.semanticOperations.filter((item) => item.id !== operationId);
    normalizeOrder(node.semanticOperations);
    state.selected = { kind: 'node', nodeId: node.id };
    finishStructureEdit('语义操作已删除。');
  }

  function reorderSemanticOperation(node, operationId, direction) {
    if (reorderCollection(node.semanticOperations, operationId, direction)) finishStructureEdit('语义操作顺序已更新。');
  }

  function deleteTrack(node, modality, trackId) {
    const collection = trackCollection(node, modality);
    if (collection.length === 1) { showStatus('每种交互模态必须至少保留一条轨迹。', true); return; }
    const track = collection.find((item) => item.id === trackId);
    if (projectionTargetsTrack(node, modality, trackId)) {
      showStatus('目录参数投影仍绑定这条轨迹，不能单独删除。', true); return;
    }
    if (!track || !window.confirm('确认删除轨迹“' + track.title + '”？')) return;
    if (modality === 'shortcut' && state.targetTree.formatVersion === '1.1.0' && track.availability === 'available' && track.operations.some((operation) => operation.kind === 'operator_property_update') && propertyUpdateCount(state.targetTree.nodes) === track.operations.filter((operation) => operation.kind === 'operator_property_update').length) {
      showStatus('格式 1.1.0 必须保留至少一个 operator_property_update 快捷键操作。', true); return;
    }
    const index = collection.indexOf(track); collection.splice(index, 1);
    state.selected = { kind: 'node', nodeId: node.id };
    finishStructureEdit(modality.toUpperCase() + ' 轨迹已删除。');
  }

  function deleteTrackOperation(node, modality, trackId, operationId) {
    const track = trackCollection(node, modality).find((item) => item.id === trackId);
    if (!track || track.availability !== 'available') return;
    if (track.operations.length === 1) { showStatus('可用轨迹必须至少保留一个操作。', true); return; }
    const operation = track.operations.find((item) => item.id === operationId);
    if (projectionTargetsOperation(node, modality, trackId, operationId)) {
      showStatus('目录参数投影仍绑定这个操作，不能单独删除。', true); return;
    }
    if (!operation || !window.confirm('确认删除操作“' + operation.description + '”？')) return;
    if (modality === 'shortcut' && state.targetTree.formatVersion === '1.1.0') {
      const next = track.operations[track.operations.indexOf(operation) + 1];
      if (operation.kind === 'operator_property_update' || operation.opensSurface || operation.closesSurfaceOperationId || (next && next.opensSurface && next.opensSurface.sourceOperationId === operation.id)) {
        showStatus('这个快捷键操作属于 F9 属性面板协议，不能单独删除。', true); return;
      }
    }
    const remaining = track.operations.filter((item) => item.id !== operationId);
    const uncovered = operation.semanticRefs.filter((reference) => !remaining.some((item) => item.semanticRefs.includes(reference)));
    if (uncovered.length > 0) {
      showStatus('删除后会让轨迹失去语义覆盖，不能删除这个操作。', true); return;
    }
    track.operations = track.operations.filter((item) => item.id !== operationId);
    normalizeOrder(track.operations);
    state.selected = { kind: 'node', nodeId: node.id };
    finishStructureEdit(modality.toUpperCase() + ' 操作已删除。');
  }

  function reorderTrackOperation(node, modality, trackId, operationId, direction) {
    const track = trackCollection(node, modality).find((item) => item.id === trackId);
    if (modality === 'shortcut' && state.targetTree.formatVersion === '1.1.0' && track && track.availability === 'available' && track.operations.some((operation) => operation.kind === 'operator_property_update' || operation.opensSurface || operation.closesSurfaceOperationId)) {
      showStatus('包含 F9 属性面板协议的快捷键轨迹必须保持操作邻接顺序。', true); return;
    }
    if (track && track.availability === 'available' && reorderCollection(track.operations, operationId, direction)) finishStructureEdit(modality.toUpperCase() + ' 操作顺序已更新。');
  }

  function commandButton(label, command, data, danger) {
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'button ' + (danger ? 'button-danger' : 'button-quiet');
    button.textContent = label; button.dataset.structureCommand = command;
    Object.keys(data || {}).forEach((key) => { button.dataset[key] = data[key]; });
    return button;
  }

  function structureRow(title, meta, buttons) {
    const row = document.createElement('div'); row.className = 'structure-row';
    const copy = document.createElement('div'); copy.className = 'structure-row-copy';
    const strong = document.createElement('strong'); strong.textContent = title;
    const small = document.createElement('small'); small.textContent = meta;
    const actions = document.createElement('div'); actions.className = 'structure-actions'; actions.append(...buttons);
    copy.append(strong, small); row.append(copy, actions); return row;
  }

  function structureInput(labelText, value, field, nodeId, operationId, readOnly) {
    const wrapper = document.createElement('div'); const label = document.createElement('label'); const input = document.createElement('input');
    const id = 'structure-' + field + '-' + operationId; label.htmlFor = id; label.textContent = labelText;
    input.id = id; input.value = value; input.required = true; input.dataset.structureEdit = field; input.dataset.nodeId = nodeId; input.dataset.operationId = operationId;
    if (readOnly) { input.readOnly = true; input.title = '既有语义动作身份由服务端保护。'; }
    wrapper.append(label, input); return wrapper;
  }

  function renderStructureControls(node) {
    const panel = document.createElement('section'); panel.className = 'structure-panel';
    const heading = document.createElement('h3'); heading.textContent = '本地结构编辑'; panel.append(heading);
    const actions = document.createElement('div'); actions.className = 'structure-actions';
    if (node.kind === 'group') {
      actions.append(commandButton('添加分组', 'add-node', { nodeKind: 'group', parentId: node.id }), commandButton('添加叶子', 'add-node', { nodeKind: 'leaf', parentId: node.id }));
    }
    if (node.id !== state.targetTree.rootNodeId) {
      actions.append(commandButton('上移', 'reorder-node', { nodeId: node.id, direction: '-1' }), commandButton('下移', 'reorder-node', { nodeId: node.id, direction: '1' }), commandButton('删除节点', 'delete-node', { nodeId: node.id }, true));
      const move = document.createElement('div'); move.className = 'move-field';
      const field = document.createElement('div'); const label = document.createElement('label'); const select = document.createElement('select');
      select.id = 'move-parent'; select.dataset.moveParent = 'true'; label.htmlFor = select.id; label.textContent = '移动到分组';
      state.targetTree.nodes.filter((item) => item.kind === 'group' && item.id !== node.id && !descendantIds(node.id).has(item.id)).forEach((item) => select.append(new Option(item.title + ' · ' + item.id, item.id, false, item.id === node.parentId)));
      field.append(label, select); move.append(field, commandButton('移动', 'move-node', { nodeId: node.id })); panel.append(move);
    }
    panel.append(actions);
    if (node.kind === 'leaf') {
      const semanticHeading = document.createElement('h3'); semanticHeading.textContent = '语义操作'; panel.append(semanticHeading);
      const semanticList = document.createElement('div'); semanticList.className = 'structure-list';
      node.semanticOperations.forEach((operation) => {
        const row = structureRow(operation.description, operation.id, [commandButton('上移', 'reorder-semantic', { nodeId: node.id, operationId: operation.id, direction: '-1' }), commandButton('下移', 'reorder-semantic', { nodeId: node.id, operationId: operation.id, direction: '1' }), commandButton('删除', 'delete-semantic', { nodeId: node.id, operationId: operation.id }, true)]);
        const fields = document.createElement('div'); fields.className = 'structure-edit-fields';
        fields.append(structureInput('语义动作', operation.semanticAction, 'semantic-action', node.id, operation.id, semanticOperationExistedAtLoad(node.id, operation.id)), structureInput('描述', operation.description, 'semantic-description', node.id, operation.id, false));
        row.append(fields); semanticList.append(row);
      }); panel.append(semanticList);
      ['menu', 'shortcut', 'mcp'].forEach((modality) => renderTrackControls(panel, node, modality));
    }
    return panel;
  }

  function renderTrackControls(panel, node, modality) {
    const heading = document.createElement('h3'); heading.textContent = modality.toUpperCase() + ' 轨迹'; panel.append(heading);
    const note = document.createElement('p'); note.className = 'muted'; note.textContent = '轨迹集合按稳定 ID 管理，没有顺序语义。'; panel.append(note);
    const list = document.createElement('div'); list.className = 'structure-list';
    trackCollection(node, modality).forEach((track) => {
      list.append(structureRow(track.title, track.id + ' · ' + track.availability, [commandButton('删除轨迹', 'delete-track', { nodeId: node.id, modality: modality, trackId: track.id }, true)]));
      if (track.availability !== 'available') return;
      track.operations.forEach((operation) => list.append(structureRow('↳ ' + operation.description, operation.id, [commandButton('上移', 'reorder-track-operation', { nodeId: node.id, modality: modality, trackId: track.id, operationId: operation.id, direction: '-1' }), commandButton('下移', 'reorder-track-operation', { nodeId: node.id, modality: modality, trackId: track.id, operationId: operation.id, direction: '1' }), commandButton('删除操作', 'delete-track-operation', { nodeId: node.id, modality: modality, trackId: track.id, operationId: operation.id }, true)])));
    }); panel.append(list);
  }

  function renderDetail() {
    elements.detail.replaceChildren();
    const node = selectedNode();
    if (!state.selected || state.selected.kind === 'tree' || !node) {
      elements.detailHeading.textContent = 'ProcedureTree 概览';
      const wrapper = document.createElement('div');
      wrapper.className = 'selection-detail-grid';
      wrapper.append(editField('Tree 标题', state.targetTree ? state.targetTree.title : '', 'tree-title', false));
      const info = document.createElement('div');
      info.innerHTML = '<label>稳定标识</label><p class="muted"></p>';
      info.querySelector('p').textContent = state.treeId || '—';
      wrapper.append(info);
      if (state.branch && state.targetTree) {
        const root = state.targetTree.nodes.find((item) => item.id === state.targetTree.rootNodeId);
        if (root) wrapper.append(renderStructureControls(root));
      }
      elements.detail.append(wrapper);
      state.parameterFormLoadId += 1;
      state.parameterResult = null;
      renderEmptyParameters('选择一个叶子节点中的操作以加载参数表单。');
      return;
    }
    elements.detailHeading.textContent = node.title;
    const wrapper = document.createElement('div');
    wrapper.className = 'selection-detail-grid';
    wrapper.append(editField('节点标题', node.title, 'node-title', false));
    wrapper.append(editField('步骤意图', node.intent, 'node-intent', false, true));
    const metadata = document.createElement('p');
    metadata.className = 'muted wide';
    metadata.textContent = node.id + ' · ' + (node.kind === 'leaf' ? '叶子节点' : '分组节点') + ' · 顺序 ' + node.order;
    wrapper.append(metadata);
    if (node.kind === 'leaf') {
      const tabs = document.createElement('div');
      tabs.className = 'operation-tabs wide';
      operationDescriptors(node).forEach((descriptor) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'operation-button';
        button.dataset.operation = JSON.stringify(descriptor);
        button.textContent = descriptor.label;
        button.setAttribute('aria-pressed', String(sameSelection(state.selected, descriptor)));
        tabs.append(button);
      });
      wrapper.append(tabs);
    }
    if (state.branch) wrapper.append(renderStructureControls(node));
    elements.detail.append(wrapper);
    if (state.selected.operationId || state.selected.kind === 'action') loadParameterForm().catch(handleError);
    else {
      state.parameterFormLoadId += 1;
      state.parameterResult = null;
      renderEmptyParameters('选择上方的 Action 或操作轨迹。');
    }
  }

  function sameSelection(left, right) {
    return left && right && left.kind === right.kind && left.nodeId === right.nodeId && left.trackId === right.trackId && left.operationId === right.operationId;
  }

  function editField(labelText, value, field, wide, multiline) {
    const wrapper = document.createElement('div');
    if (wide) wrapper.className = 'wide';
    const label = document.createElement('label');
    const id = 'edit-' + field;
    label.htmlFor = id;
    label.textContent = labelText;
    const input = document.createElement(multiline ? 'textarea' : 'input');
    input.id = id;
    input.value = value;
    input.dataset.editField = field;
    input.disabled = !state.branch;
    if (multiline) input.rows = 2;
    wrapper.append(label, input);
    return wrapper;
  }

  function renderEmptyParameters(message) {
    elements.parameterKind.textContent = '未选择操作';
    elements.parameterForm.replaceChildren();
    const paragraph = document.createElement('p');
    paragraph.className = 'muted';
    paragraph.textContent = message;
    elements.parameterForm.append(paragraph);
  }

  async function loadParameterForm() {
    if (!state.branch || !state.selected) return;
    const loadId = ++state.parameterFormLoadId;
    const snapshot = {
      epoch: state.mutationEpoch,
      treeId: state.treeId,
      branchId: state.branch.branchId,
      revision: clone(state.branch.head),
      head: canonicalSnapshot(state.branch.head),
      target: clone(selectionTarget(state.selected)),
      selection: canonicalSnapshot(selectionTarget(state.selected))
    };
    const isCurrent = () => loadId === state.parameterFormLoadId && state.mutationEpoch === snapshot.epoch && state.treeId === snapshot.treeId && state.branch && state.branch.branchId === snapshot.branchId && canonicalSnapshot(state.branch.head) === snapshot.head && state.selected && canonicalSnapshot(selectionTarget(state.selected)) === snapshot.selection;
    const payload = await request(API.parameterForm, versioned({
      branchId: snapshot.branchId,
      revision: snapshot.revision,
      target: snapshot.target
    }));
    if (!isCurrent()) return;
    if (payload.branchId !== snapshot.branchId || canonicalSnapshot(payload.revision) !== snapshot.head || canonicalSnapshot(payload.target) !== snapshot.selection) throw new Error('参数表单响应与请求快照不一致。');
    state.parameterResult = payload;
    renderParameters(payload);
  }

  function selectionTarget(selection) {
    const target = { kind: selection.kind, nodeId: selection.nodeId };
    if (selection.operationId) target.operationId = selection.operationId;
    if (selection.trackId) target.trackId = selection.trackId;
    return target;
  }

  function renderParameters(payload) {
    elements.parameterKind.textContent = payload.target.kind.toUpperCase();
    elements.parameterForm.replaceChildren();
    if (payload.fields.length === 0) {
      renderEmptyParameters('这个操作没有可编辑参数。');
      return;
    }
    const currentParameters = resolveSelectedParameters();
    payload.fields.forEach((field) => {
      const value = currentParameters && Object.hasOwn(currentParameters, field.name) ? currentParameters[field.name] : field.value;
      const canEdit = payload.target.kind === 'action' && field.editable;
      const wrapper = document.createElement('div');
      wrapper.className = 'parameter-field' + (canEdit ? '' : ' readonly') + (field.kind === 'structured' ? ' wide' : '');
      const label = document.createElement('label');
      label.textContent = field.label;
      const id = 'parameter-' + field.name;
      label.htmlFor = id;
      wrapper.append(label);
      if (field.kind === 'boolean') {
        const input = document.createElement('input');
        input.type = 'checkbox'; input.id = id; input.checked = Boolean(value); input.dataset.parameterName = field.name;
        input.disabled = !canEdit;
        wrapper.append(input);
      } else if (field.kind === 'enum') {
        const select = document.createElement('select');
        select.id = id; select.dataset.parameterName = field.name;
        select.disabled = !canEdit;
        field.enumValues.forEach((enumValue) => select.append(new Option(String(enumValue), JSON.stringify(enumValue), false, JSON.stringify(enumValue) === JSON.stringify(value))));
        wrapper.append(select);
      } else if (field.kind === 'integer_vector' || field.kind === 'number_vector') {
        const row = document.createElement('div');
        row.className = 'vector-row vector-length-' + field.vectorLength;
        const vectorValue = Array.isArray(value) ? value : field.value;
        vectorValue.forEach((component, index) => {
          const input = document.createElement('input'); input.type = 'number'; input.id = id + '-' + index; input.value = component; input.dataset.parameterName = field.name; input.dataset.vectorIndex = index;
          input.required = true;
          input.setAttribute('aria-label', field.label + ' ' + (index + 1));
          if (field.kind === 'integer_vector') input.step = '1'; else input.step = 'any';
          if (field.minimum !== undefined) input.min = field.minimum; if (field.maximum !== undefined) input.max = field.maximum;
          input.disabled = !canEdit; row.append(input);
        });
        wrapper.append(row);
      } else {
        const input = document.createElement(field.kind === 'structured' ? 'textarea' : 'input');
        input.id = id; input.dataset.parameterName = field.name; input.disabled = !canEdit;
        if (field.kind === 'integer' || field.kind === 'number') {
          input.type = 'number'; input.value = value; input.required = true; input.step = field.kind === 'integer' ? '1' : 'any';
          if (field.minimum !== undefined) input.min = field.minimum; if (field.maximum !== undefined) input.max = field.maximum;
        } else {
          input.value = field.kind === 'structured' ? JSON.stringify(value, null, 2) : value;
          if (field.minLength !== undefined) input.minLength = field.minLength; if (field.maxLength !== undefined) input.maxLength = field.maxLength;
          if (field.pattern !== undefined) input.pattern = field.pattern;
        }
        wrapper.append(input);
      }
      if (field.description) {
        const help = document.createElement('small'); help.textContent = field.description; wrapper.append(help);
      }
      elements.parameterForm.append(wrapper);
    });
  }

  function resolveSelectedParameters() {
    const node = selectedNode();
    if (!node || !state.selected) return null;
    if (state.selected.kind === 'action') return node.action && node.action.arguments;
    if (state.selected.kind === 'semantic') {
      const operation = node.semanticOperations.find((item) => item.id === state.selected.operationId);
      return operation && operation.parameters;
    }
    const collection = state.selected.kind === 'menu' ? node.menuTracks : state.selected.kind === 'shortcut' ? node.shortcutTracks : node.mcpTracks;
    const track = collection.find((item) => item.id === state.selected.trackId);
    const operation = track && track.availability === 'available' && track.operations.find((item) => item.id === state.selected.operationId);
    if (!operation) return null;
    return state.selected.kind === 'mcp' ? operation.arguments : operation.parameters;
  }

  function updateParameter(name, value, vectorIndex) {
    const parameters = resolveSelectedParameters();
    if (!parameters || !state.selected || state.selected.kind !== 'action') return;
    if (vectorIndex === undefined) parameters[name] = clone(value);
    else {
      const vector = Array.isArray(parameters[name]) ? parameters[name].slice() : [];
      vector[vectorIndex] = value;
      parameters[name] = vector;
    }
    markDirty();
  }

  function markDirty() {
    bumpMutationEpoch();
    state.dirty = true;
    state.preview = null;
    state.mergePreview = null;
    state.previewSnapshot = null;
    state.mergeSnapshot = null;
    elements.dirty.textContent = '本地未提交';
    elements.dirty.classList.add('is-dirty');
    elements.commitButton.disabled = true;
    elements.mergePreviewButton.disabled = true;
    elements.mergeCommitButton.disabled = true;
    renderDiff(); renderMerge();
  }

  async function previewEdit() {
    if (!state.branch || !state.targetTree || !state.latest) throw new Error('请先选择编辑分支。');
    assertNoDraftSentinels(state.targetTree);
    const requestedEpoch = state.mutationEpoch;
    const requestedBranchId = state.branch.branchId;
    const requestedHead = canonicalSnapshot(state.branch.head);
    await refreshLatest();
    if (state.mutationEpoch !== requestedEpoch || !state.branch || state.branch.branchId !== requestedBranchId || canonicalSnapshot(state.branch.head) !== requestedHead) throw new Error('本地候选树在预览准备期间发生变化，请重新预览。');
    const tree = clone(state.targetTree);
    tree.revision = state.latest.revision + 1;
    const snapshot = {
      epoch: state.mutationEpoch, branchId: state.branch.branchId,
      head: canonicalSnapshot(state.branch.head), targetRevision: tree.revision,
      candidate: canonicalSnapshot(tree)
    };
    const payload = await request(API.previewEdit, versioned({
      requestId: uuid(), branchId: state.branch.branchId, base: state.branch.head,
      expectedLatestRevision: state.latest.revision, targetTree: tree,
      message: elements.commitMessage.value.trim() || undefined
    }));
    if (!matchesEditSnapshot(snapshot)) throw new Error('本地候选树在预览请求期间发生变化，已丢弃过期预览。');
    state.preview = payload;
    state.previewSnapshot = snapshot;
    renderDiff();
    elements.commitButton.disabled = false;
    showStatus('差异预览已绑定到 r' + state.branch.head.revision + '。');
  }

  function matchesEditSnapshot(snapshot) {
    if (!snapshot || state.mutationEpoch !== snapshot.epoch || !state.branch || !state.targetTree) return false;
    if (state.branch.branchId !== snapshot.branchId || canonicalSnapshot(state.branch.head) !== snapshot.head) return false;
    const candidate = clone(state.targetTree); candidate.revision = snapshot.targetRevision;
    return canonicalSnapshot(candidate) === snapshot.candidate;
  }

  function assertNoDraftSentinels(tree) {
    const serialized = JSON.stringify(tree);
    if (serialized.includes('operator.placeholder') || serialized.includes('"toolName":"placeholder"') || serialized.includes('待配置菜单项')) throw new Error('候选树仍包含不可提交的占位操作，请删除或完整配置后再预览。');
    tree.nodes.forEach((node) => {
      if (node.kind !== 'leaf') return;
      node.semanticOperations.forEach((operation) => {
        if (!operation.semanticAction.trim() || operation.semanticAction.startsWith('draft.semantic.') || !operation.description.trim() || operation.description === '请配置语义操作描述。') throw new Error('请先配置所有新叶子的语义动作与描述。');
      });
    });
  }

  function renderDiff() {
    elements.diffList.replaceChildren();
    const entries = state.preview && state.preview.diff ? state.preview.diff.entries : [];
    elements.previewCount.textContent = String(entries.length);
    if (entries.length === 0) {
      const p = document.createElement('p'); p.className = 'muted'; p.textContent = state.preview ? '没有检测到内容差异。' : '预览后显示稳定 ID 级别的差异。';
      elements.diffList.append(p); return;
    }
    entries.forEach((entry) => {
      const row = document.createElement('div'); row.className = 'diff-entry ' + entry.operation;
      const operation = document.createElement('span'); operation.className = 'diff-operation'; operation.textContent = entry.operation;
      const path = document.createElement('span'); path.textContent = stablePath(entry.path) + ' · ' + entry.stableId;
      row.append(operation, path); elements.diffList.append(row);
    });
  }

  function stablePath(path) {
    return path.map((segment) => segment.kind === 'field' ? segment.name : segment.collection + '[' + segment.id + ']').join(' / ');
  }

  async function commitPreview(preview, operation) {
    if (!state.branch || !preview) throw new Error('必须先生成有效预览。');
    if (state.commitInFlight) throw new Error('已有 Revision 正在提交。');
    if (operation === 'merge' && state.dirty) throw new Error('请先提交或明确丢弃本地编辑，再合并分支。');
    if (operation === 'edit' && (!state.previewSnapshot || preview !== state.preview || !matchesEditSnapshot(state.previewSnapshot))) throw new Error('编辑预览已过期，请重新预览后再提交。');
    if (operation === 'merge' && (!state.mergeSnapshot || preview !== state.mergePreview || !matchesMergeSnapshot(state.mergeSnapshot))) throw new Error('合并预览已过期，请重新预览后再提交。');
    const targetTree = operation === 'merge' ? preview.targetCandidate : preview.targetTree;
    const targetIntegrity = preview.targetIntegrity;
    const commitEpoch = state.mutationEpoch;
    const commitTreeId = state.treeId;
    const commitBranchId = state.branch.branchId;
    const commitHead = canonicalSnapshot(state.branch.head);
    state.commitInFlight = true;
    elements.commitButton.disabled = true;
    elements.mergeCommitButton.disabled = true;
    try {
      const payload = await request(API.createCommit, versioned({
        requestId: uuid(), occurredAt: new Date().toISOString(), operation: operation,
        targetBranchId: state.branch.branchId, expectedHead: state.branch.head,
        previewBinding: preview.binding, targetTree: targetTree, targetIntegrity: targetIntegrity,
        message: elements.commitMessage.value.trim() || undefined,
        proposalCreated: false, hostExecutionStarted: false
      }));
      if (state.treeId === commitTreeId) state.latest = payload.branch.head;
      if (state.mutationEpoch !== commitEpoch || state.treeId !== commitTreeId || !state.branch || state.branch.branchId !== commitBranchId || canonicalSnapshot(state.branch.head) !== commitHead) {
        showStatus('Revision 已提交，但提交期间本地候选发生了变化；为避免丢失未刷新工作区，请处理本地编辑后手动切换或重新加载分支。', true);
        return;
      }
      const refreshed = await refreshBranchesAndWorkspace(payload.branch.branchId, commitEpoch);
      if (!refreshed) {
        showStatus('Revision 已提交，但刷新期间本地候选发生了变化；为避免丢失未覆盖工作区，请处理本地编辑后手动切换或重新加载分支。', true);
        return;
      }
      showStatus((operation === 'merge' ? '合并' : '编辑') + ' Revision 已提交；未创建 Proposal，未执行 Blender。');
    } finally {
      state.commitInFlight = false;
      elements.commitButton.disabled = !state.preview || !state.previewSnapshot || !matchesEditSnapshot(state.previewSnapshot);
      renderMerge();
    }
  }

  async function refreshBranchesAndWorkspace(branchId, expectedEpoch) {
    const treeId = state.treeId;
    const branches = await listAllBranches(treeId);
    if (expectedEpoch !== undefined && (state.mutationEpoch !== expectedEpoch || state.treeId !== treeId)) return false;
    state.branches = branches;
    renderBranchOptions();
    return selectBranch(branchId);
  }

  async function loadHistory() {
    if (!state.branch) return;
    const loadId = ++state.historyLoadId;
    const snapshot = {
      treeId: state.treeId,
      branchId: state.branch.branchId,
      expectedHead: clone(state.branch.head),
      head: canonicalSnapshot(state.branch.head)
    };
    const isCurrent = () => loadId === state.historyLoadId && state.treeId === snapshot.treeId && state.branch && state.branch.branchId === snapshot.branchId && canonicalSnapshot(state.branch.head) === snapshot.head;
    const commits = []; let afterRevision;
    do {
      const body = { treeId: snapshot.treeId, branchId: snapshot.branchId, expectedHead: snapshot.expectedHead, limit: 100 };
      if (afterRevision !== undefined) body.afterRevision = afterRevision;
      const page = await request(API.listHistory, versioned(body));
      if (!isCurrent()) return;
      if (canonicalSnapshot(page.snapshotHead) !== snapshot.head) throw new Error('历史分页快照头不一致。');
      commits.push(...(page.commits || []));
      if (page.nextAfterRevision === afterRevision) throw new Error('历史分页游标没有前进。');
      afterRevision = page.nextAfterRevision === null ? undefined : page.nextAfterRevision;
      if (page.nextAfterRevision === null) break;
    } while (afterRevision !== undefined);
    if (!isCurrent()) return;
    elements.history.replaceChildren();
    if (commits.length === 0) {
      const item = document.createElement('li'); item.className = 'muted'; item.textContent = '分支还没有提交。'; elements.history.append(item); return;
    }
    commits.forEach((commit) => {
      const item = document.createElement('li'); item.className = 'history-item';
      const revision = document.createElement('span'); revision.className = 'history-revision'; revision.textContent = 'r' + commit.revision.revision;
      const copy = document.createElement('div'); copy.className = 'history-copy';
      const title = document.createElement('strong'); title.textContent = commit.message || (commit.operation === 'merge' ? '合并 Revision' : '编辑 Revision');
      const meta = document.createElement('small');
      const source = commit.source ? ' · source ' + commit.source.branchId : '';
      meta.textContent = commit.operation + source + ' · ' + new Date(commit.occurredAt).toLocaleString();
      copy.append(title, meta); item.append(revision, copy); elements.history.append(item);
    });
  }

  function currentAnchor() {
    if (!state.selected || state.selected.kind === 'tree') return { kind: 'tree', treeId: state.treeId };
    if (!state.selected.operationId) return { kind: 'node', treeId: state.treeId, nodeId: state.selected.nodeId };
    return {
      kind: 'operation', treeId: state.treeId, nodeId: state.selected.nodeId,
      modality: state.selected.kind, trackId: state.selected.kind === 'semantic' ? null : state.selected.trackId,
      operationId: state.selected.operationId
    };
  }

  async function loadComments() {
    if (!state.branch) return;
    const loadId = ++state.commentsLoadId;
    const snapshot = {
      treeId: state.treeId,
      branchId: state.branch.branchId,
      revision: clone(state.branch.head),
      anchor: clone(currentAnchor())
    };
    const snapshotHead = canonicalSnapshot(snapshot.revision);
    const snapshotAnchor = canonicalSnapshot(snapshot.anchor);
    const isCurrent = () => loadId === state.commentsLoadId && state.treeId === snapshot.treeId && state.branch && state.branch.branchId === snapshot.branchId && canonicalSnapshot(state.branch.head) === snapshotHead && canonicalSnapshot(currentAnchor()) === snapshotAnchor;
    const comments = []; let afterCommentId;
    do {
      const body = { treeId: snapshot.treeId, branchId: snapshot.branchId, revision: snapshot.revision, anchor: snapshot.anchor, limit: 100 };
      if (afterCommentId) body.afterCommentId = afterCommentId;
      const page = await request(API.listComments, versioned(body));
      if (!isCurrent()) return;
      comments.push(...(page.comments || []));
      if (page.nextAfterCommentId === afterCommentId) throw new Error('评论分页游标没有前进。');
      afterCommentId = page.nextAfterCommentId;
    } while (afterCommentId);
    if (!isCurrent()) return;
    elements.comments.replaceChildren();
    elements.commentCount.textContent = String(comments.length);
    if (comments.length === 0) {
      const p = document.createElement('p'); p.className = 'muted'; p.textContent = '当前锚点还没有评论。'; elements.comments.append(p); return;
    }
    comments.forEach((comment) => {
      const card = document.createElement('article'); card.className = 'comment-card';
      const body = document.createElement('p'); body.textContent = comment.body;
      const meta = document.createElement('small'); meta.textContent = 'r' + comment.revision.revision + ' · ' + new Date(comment.createdAt).toLocaleString();
      card.append(body, meta); elements.comments.append(card);
    });
  }

  async function createComment() {
    if (!state.branch) throw new Error('请先选择编辑分支。');
    const draftValue = elements.commentBody.value;
    const body = draftValue.trim();
    if (!body) return;
    const createId = ++state.commentCreateId;
    const snapshot = {
      epoch: state.mutationEpoch,
      treeId: state.treeId,
      branchId: state.branch.branchId,
      revision: clone(state.branch.head),
      head: canonicalSnapshot(state.branch.head),
      anchor: clone(currentAnchor()),
      anchorIdentity: canonicalSnapshot(currentAnchor()),
      body: body,
      draftValue: draftValue
    };
    await request(API.createComment, versioned({
      requestId: uuid(), branchId: snapshot.branchId, revision: snapshot.revision,
      anchor: snapshot.anchor, body: snapshot.body, occurredAt: new Date().toISOString()
    }));
    const contextMatches = createId === state.commentCreateId && state.mutationEpoch === snapshot.epoch && state.treeId === snapshot.treeId && state.branch && state.branch.branchId === snapshot.branchId && canonicalSnapshot(state.branch.head) === snapshot.head && canonicalSnapshot(currentAnchor()) === snapshot.anchorIdentity;
    const draftMatches = elements.commentBody.value === snapshot.draftValue;
    if (!contextMatches || !draftMatches) {
      showStatus('原评论已提交；当前上下文或评论草稿已变化，现有草稿已保留。', true);
      return;
    }
    elements.commentBody.value = '';
    await loadComments();
    showStatus('评论已添加到当前 Revision 锚点，不会改变树内容。');
  }

  async function previewMerge() {
    if (!state.branch || !state.latest) throw new Error('请先选择目标分支。');
    if (state.dirty) throw new Error('请先提交或明确丢弃本地编辑，再预览合并。');
    const source = state.branches.find((branch) => branch.branchId === elements.sourceBranch.value);
    if (!source) throw new Error('请选择来源分支。');
    const requestedEpoch = state.mutationEpoch;
    const requestedTargetId = state.branch.branchId;
    const requestedTargetHead = canonicalSnapshot(state.branch.head);
    const requestedSourceHead = canonicalSnapshot(source.head);
    await refreshLatest();
    const currentSource = state.branches.find((branch) => branch.branchId === source.branchId);
    if (state.mutationEpoch !== requestedEpoch || !state.branch || state.branch.branchId !== requestedTargetId || elements.sourceBranch.value !== source.branchId || canonicalSnapshot(state.branch.head) !== requestedTargetHead || !currentSource || canonicalSnapshot(currentSource.head) !== requestedSourceHead) throw new Error('分支状态在合并预览准备期间发生变化，请重新预览。');
    const snapshot = {
      epoch: state.mutationEpoch, targetBranchId: state.branch.branchId, sourceBranchId: source.branchId,
      targetHead: requestedTargetHead, sourceHead: requestedSourceHead,
      expectedLatestRevision: state.latest.revision
    };
    const payload = await request(API.previewMerge, versioned({
      requestId: uuid(), targetBranchId: state.branch.branchId, sourceBranchId: source.branchId,
      targetHead: state.branch.head, sourceHead: source.head, expectedLatestRevision: state.latest.revision
    }));
    if (!matchesMergeSnapshot(snapshot)) throw new Error('分支状态在合并预览请求期间发生变化，已丢弃过期预览。');
    state.mergePreview = payload;
    state.mergeSnapshot = snapshot;
    renderMerge();
  }

  function matchesMergeSnapshot(snapshot) {
    if (!snapshot || state.mutationEpoch !== snapshot.epoch || !state.branch || !state.latest || state.branch.branchId !== snapshot.targetBranchId || elements.sourceBranch.value !== snapshot.sourceBranchId || state.latest.revision !== snapshot.expectedLatestRevision) return false;
    const source = state.branches.find((branch) => branch.branchId === snapshot.sourceBranchId);
    return canonicalSnapshot(state.branch.head) === snapshot.targetHead && Boolean(source) && canonicalSnapshot(source.head) === snapshot.sourceHead;
  }

  async function resolveMergeConflicts() {
    const preview = state.mergePreview;
    if (!preview || preview.status !== 'conflicts') throw new Error('没有待解决的合并冲突。');
    if (state.dirty) throw new Error('请先提交或明确丢弃本地编辑，再解决合并冲突。');
    const snapshot = state.mergeSnapshot;
    if (!snapshot || !matchesMergeSnapshot(snapshot)) throw new Error('合并预览已过期，请重新预览。');
    const resolutions = collectMergeResolutions(true);
    if (!resolutions) return;
    const resolutionIdentity = canonicalSnapshot(resolutions);
    const payload = await request(API.previewMerge, versioned({
      requestId: uuid(), targetBranchId: preview.targetBranchId, sourceBranchId: preview.sourceBranchId,
      targetHead: preview.targetHead, sourceHead: preview.sourceHead,
      expectedLatestRevision: preview.expectedLatestRevision, resolutions: resolutions
    }));
    const currentResolutions = collectMergeResolutions(false);
    if (!matchesMergeSnapshot(snapshot) || !currentResolutions || canonicalSnapshot(currentResolutions) !== resolutionIdentity) throw new Error('分支或冲突选择在解决请求期间发生变化，已丢弃过期预览。');
    state.mergePreview = payload; state.mergeSnapshot = snapshot; renderMerge();
    showStatus(payload.status === 'ready' ? '冲突已解决，合并预览可提交。' : '冲突仍未全部解决。', payload.status !== 'ready');
  }

  function collectMergeResolutions(showErrors) {
    const preview = state.mergePreview;
    if (!preview || preview.status !== 'conflicts') return null;
    const resolutions = [];
    for (let index = 0; index < preview.conflicts.length; index += 1) {
      const card = elements.mergeResult.querySelector('[data-conflict-index="' + index + '"]');
      const choice = card && card.querySelector('[data-conflict-choice]').value;
      if (!choice) { if (showErrors) showStatus('请为每个冲突选择解决方式。', true); return null; }
      const resolution = { conflict: preview.conflicts[index], choice: choice };
      if (choice === 'custom') {
        const presence = card.querySelector('[data-custom-presence]').value;
        if (presence === '') { if (showErrors) showStatus('请选择自定义值是存在还是缺失。', true); return null; }
        if (presence === 'false') resolution.custom = { present: false };
        else {
          const raw = card.querySelector('[data-custom-value]').value.trim();
          if (!raw) { if (showErrors) showStatus('请输入严格 JSON 自定义值。', true); return null; }
          try {
            const value = JSON.parse(raw);
            if (!isJsonValue(value)) throw new Error('invalid JSON value');
            resolution.custom = { present: true, value: value };
          }
          catch { if (showErrors) showStatus('自定义冲突值必须是有效 JSON。', true); return null; }
        }
      }
      resolutions.push(resolution);
    }
    return resolutions;
  }

  function isJsonValue(value) {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(isJsonValue);
    if (typeof value === 'object') return Object.values(value).every(isJsonValue);
    return false;
  }

  function updateMergeResolutionState() {
    elements.mergeResolveButton.disabled = state.dirty || !collectMergeResolutions(false);
  }

  function renderMerge() {
    elements.mergeResult.replaceChildren();
    const preview = state.mergePreview;
    elements.mergeResolveButton.hidden = !preview || preview.status !== 'conflicts';
    elements.mergeResolveButton.disabled = true;
    elements.mergePreviewButton.disabled = state.dirty || !state.branch || !elements.sourceBranch.value;
    elements.mergeCommitButton.disabled = state.commitInFlight || state.dirty || !preview || preview.status !== 'ready';
    if (!preview) {
      const p = document.createElement('p'); p.className = 'muted'; p.textContent = '先选择另一个分支。'; elements.mergeResult.append(p); return;
    }
    if (preview.status === 'ready') {
      const ready = document.createElement('div'); ready.className = 'merge-ready';
      ready.textContent = '可合并 · ' + preview.diff.entries.length + ' 项差异 · 基线 r' + preview.mergeBase.revision;
      elements.mergeResult.append(ready); return;
    }
    preview.conflicts.forEach((conflict, index) => {
      const card = document.createElement('div'); card.className = 'conflict-card';
      card.dataset.conflictIndex = index;
      const title = document.createElement('strong'); title.textContent = '冲突 · ' + stablePath(conflict.path) + ' · ' + conflict.stableId;
      const base = document.createElement('div'); base.textContent = 'BASE   ' + formatMergeOperand(conflict.mergeBase);
      const target = document.createElement('div'); target.textContent = 'TARGET ' + formatMergeOperand(conflict.target);
      const source = document.createElement('div'); source.textContent = 'SOURCE ' + formatMergeOperand(conflict.source);
      const resolution = document.createElement('div'); resolution.className = 'conflict-resolution';
      const choiceLabel = document.createElement('label'); const choice = document.createElement('select');
      choiceLabel.htmlFor = 'conflict-choice-' + index; choiceLabel.textContent = '解决方式'; choice.id = choiceLabel.htmlFor; choice.dataset.conflictChoice = 'true';
      choice.append(new Option('请选择', ''), new Option('保留目标分支', 'target'), new Option('采用来源分支', 'source'), new Option('采用合并基线', 'base'), new Option('自定义 JSON', 'custom'));
      const custom = document.createElement('div'); custom.className = 'conflict-custom'; custom.hidden = true; custom.dataset.conflictCustom = 'true';
      const presenceLabel = document.createElement('label'); const presence = document.createElement('select'); presenceLabel.htmlFor = 'custom-presence-' + index; presenceLabel.textContent = '自定义状态'; presence.id = presenceLabel.htmlFor; presence.dataset.customPresence = 'true'; presence.append(new Option('请选择', ''), new Option('值存在', 'true'), new Option('值缺失', 'false'));
      const valueLabel = document.createElement('label'); const value = document.createElement('textarea'); valueLabel.htmlFor = 'custom-value-' + index; valueLabel.textContent = 'JSON 值'; value.id = valueLabel.htmlFor; value.rows = 3; value.dataset.customValue = 'true'; value.placeholder = '{"example": true}';
      custom.append(presenceLabel, presence, valueLabel, value); resolution.append(choiceLabel, choice, custom);
      card.append(title, base, target, source, resolution);
      elements.mergeResult.append(card);
    });
  }

  function formatMergeOperand(operand) {
    if (!operand.present) return '<missing>';
    const value = JSON.stringify(operand.value);
    return value.length > 180 ? value.slice(0, 177) + '…' : value;
  }

  async function refreshLatest() {
    const treeId = state.treeId; const epoch = state.mutationEpoch;
    const payload = await request(API.latest + '?treeId=' + encodeURIComponent(treeId), undefined, 'GET');
    if (state.treeId !== treeId || state.mutationEpoch !== epoch) throw new Error('本地工作区在刷新最新 Revision 期间发生变化。');
    const latest = revisionRefFromLatest(payload);
    state.latest = latest.ref;
  }

  async function createBranch(name) {
    if (!state.latest) throw new Error('请先加载 ProcedureTree。');
    const createdFrom = clone(state.branch ? state.branch.head : state.latest);
    const snapshot = {
      epoch: state.mutationEpoch,
      treeId: state.treeId,
      branchId: state.branch ? state.branch.branchId : null,
      head: canonicalSnapshot(createdFrom)
    };
    const payload = await request(API.createBranch, versioned({
      requestId: uuid(), treeId: snapshot.treeId, name: name,
      createdFrom: createdFrom, occurredAt: new Date().toISOString()
    }));
    const currentHead = state.branch ? state.branch.head : state.latest;
    const contextMatches = state.mutationEpoch === snapshot.epoch && state.treeId === snapshot.treeId && (state.branch ? state.branch.branchId : null) === snapshot.branchId && currentHead && canonicalSnapshot(currentHead) === snapshot.head;
    if (!contextMatches) {
      showStatus('分支已创建，但当前工作区已变化；为避免丢失本地编辑，未自动刷新或切换分支。', true);
      return;
    }
    const refreshed = await refreshBranchesAndWorkspace(payload.branch.branchId, snapshot.epoch);
    if (!refreshed) {
      showStatus('分支已创建，但刷新期间当前工作区已变化；为避免丢失本地编辑，未自动切换分支。', true);
      return;
    }
    showStatus('分支已创建。');
  }

  function parseParameterInput(input, field) {
    if (field.kind === 'boolean') return input.checked;
    if (field.kind === 'integer' || field.kind === 'number' || field.kind === 'integer_vector' || field.kind === 'number_vector') {
      if (input.value.trim() === '') throw new Error('数字参数不能为空。');
      const value = Number(input.value);
      if (!Number.isFinite(value)) throw new Error('数字参数必须是有限数值。');
      if ((field.kind === 'integer' || field.kind === 'integer_vector') && !Number.isInteger(value)) throw new Error('整数参数不能包含小数。');
      return value;
    }
    if (field.kind === 'enum') return JSON.parse(input.value);
    return input.value;
  }

  function executeStructureCommand(button) {
    const command = button.dataset.structureCommand;
    const node = state.targetTree && state.targetTree.nodes.find((item) => item.id === button.dataset.nodeId);
    if (command === 'add-node') return addNode(button.dataset.nodeKind, button.dataset.parentId);
    if (command === 'delete-node') return deleteNode(button.dataset.nodeId);
    if (command === 'move-node') {
      const select = elements.detail.querySelector('[data-move-parent]');
      return moveNode(button.dataset.nodeId, select && select.value);
    }
    if (command === 'reorder-node') return reorderNode(button.dataset.nodeId, Number(button.dataset.direction));
    if (!node || node.kind !== 'leaf') return;
    if (command === 'delete-semantic') return deleteSemanticOperation(node, button.dataset.operationId);
    if (command === 'reorder-semantic') return reorderSemanticOperation(node, button.dataset.operationId, Number(button.dataset.direction));
    if (command === 'delete-track') return deleteTrack(node, button.dataset.modality, button.dataset.trackId);
    if (command === 'delete-track-operation') return deleteTrackOperation(node, button.dataset.modality, button.dataset.trackId, button.dataset.operationId);
    if (command === 'reorder-track-operation') return reorderTrackOperation(node, button.dataset.modality, button.dataset.trackId, button.dataset.operationId, Number(button.dataset.direction));
  }

  function handleError(error) {
    const message = error instanceof Error ? error.message : '未知错误';
    showStatus(message, true);
  }

  function confirmDiscardChanges(action) {
    if (!state.dirty) return true;
    return window.confirm('当前分支有未提交的本地编辑。确认丢弃这些编辑并' + action + '？');
  }

  elements.treeForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const treeId = elements.treeId.value.trim();
    if (treeId) loadTree(treeId).catch(handleError);
  });
  elements.branchSelect.addEventListener('change', () => {
    const branchId = elements.branchSelect.value;
    if (!confirmDiscardChanges('切换分支')) {
      elements.branchSelect.value = state.branch ? state.branch.branchId : '';
      return;
    }
    selectBranch(branchId).catch(handleError);
  });
  elements.newBranch.addEventListener('click', () => {
    if (confirmDiscardChanges('新建分支')) elements.branchDialog.showModal();
  });
  elements.cancelBranch.addEventListener('click', () => elements.branchDialog.close());
  elements.branchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = elements.branchName.value.trim();
    if (!name) return;
    elements.branchDialog.close(); elements.branchName.value = '';
    createBranch(name).catch(handleError);
  });
  elements.treeView.addEventListener('click', (event) => {
    const button = event.target.closest('[data-node-id]');
    if (!button) return;
    state.selected = { kind: 'node', nodeId: button.dataset.nodeId };
    state.parameterResult = null;
    renderTree(); renderDetail(); loadComments().catch(handleError);
  });
  elements.detail.addEventListener('click', (event) => {
    const structureButton = event.target.closest('[data-structure-command]');
    if (structureButton) { executeStructureCommand(structureButton); return; }
    const button = event.target.closest('[data-operation]');
    if (!button) return;
    state.selected = JSON.parse(button.dataset.operation);
    state.parameterResult = null;
    renderDetail(); loadComments().catch(handleError);
  });
  elements.detail.addEventListener('input', (event) => {
    const structureField = event.target.dataset.structureEdit;
    if (structureField && state.targetTree) {
      const node = state.targetTree.nodes.find((item) => item.id === event.target.dataset.nodeId);
      const operation = node && node.kind === 'leaf' && node.semanticOperations.find((item) => item.id === event.target.dataset.operationId);
      if (!operation) return;
      if (structureField === 'semantic-action') operation.semanticAction = event.target.value;
      if (structureField === 'semantic-description') operation.description = event.target.value;
      markDirty(); return;
    }
    const field = event.target.dataset.editField;
    if (!field || !state.targetTree) return;
    if (field === 'tree-title') state.targetTree.title = event.target.value;
    else {
      const node = selectedNode(); if (!node) return;
      if (field === 'node-title') node.title = event.target.value;
      if (field === 'node-intent') node.intent = event.target.value;
    }
    markDirty(); renderTree();
  });
  elements.parameterForm.addEventListener('change', (event) => {
    const input = event.target;
    const name = input.dataset.parameterName;
    if (!name || !state.parameterResult) return;
    const field = state.parameterResult.fields.find((candidate) => candidate.name === name);
    if (!field || !field.editable || !state.selected || state.selected.kind !== 'action') return;
    if (!input.checkValidity()) {
      input.reportValidity();
      showStatus('参数值不符合当前字段约束，尚未写入本地树。', true);
      return;
    }
    try {
      updateParameter(name, parseParameterInput(input, field), input.dataset.vectorIndex === undefined ? undefined : Number(input.dataset.vectorIndex));
    } catch (error) {
      handleError(error);
    }
  });
  elements.previewButton.addEventListener('click', () => previewEdit().catch(handleError));
  elements.commitButton.addEventListener('click', () => commitPreview(state.preview, 'edit').catch(handleError));
  elements.refreshHistory.addEventListener('click', () => loadHistory().catch(handleError));
  elements.commentForm.addEventListener('submit', (event) => { event.preventDefault(); createComment().catch(handleError); });
  elements.sourceBranch.addEventListener('change', () => {
    state.mergePreview = null; state.mergeSnapshot = null; elements.mergePreviewButton.disabled = state.dirty || !elements.sourceBranch.value; renderMerge();
  });
  elements.mergeResult.addEventListener('change', (event) => {
    if (event.target.dataset.conflictChoice) {
      const card = event.target.closest('[data-conflict-index]');
      const custom = card && card.querySelector('[data-conflict-custom]');
      if (custom) custom.hidden = event.target.value !== 'custom';
    }
    updateMergeResolutionState();
  });
  elements.mergeResult.addEventListener('input', updateMergeResolutionState);
  elements.mergePreviewButton.addEventListener('click', () => previewMerge().catch(handleError));
  elements.mergeResolveButton.addEventListener('click', () => resolveMergeConflicts().catch(handleError));
  elements.mergeCommitButton.addEventListener('click', () => commitPreview(state.mergePreview, 'merge').catch(handleError));

  state.token = consumeFragmentToken();
  if (!state.token) showStatus('缺少访问令牌。请通过带 #token=… 的本地地址重新打开。', true);
})();`;

function asset(body: string, contentType: string): ProcedureTreeEditorUiAsset {
  return Object.freeze({
    body,
    contentType,
    headers: Object.freeze({ ...procedureTreeEditorUiHeaders, 'content-type': contentType }),
  });
}

export const procedureTreeEditorUiAssets = Object.freeze({
  '/procedure-editor': asset(html, 'text/html; charset=utf-8'),
  '/procedure-editor/': asset(html, 'text/html; charset=utf-8'),
  '/procedure-editor/app.js': asset(javascript, 'text/javascript; charset=utf-8'),
  '/procedure-editor/styles.css': asset(css, 'text/css; charset=utf-8'),
});

export type ProcedureTreeEditorUiAssetPath = keyof typeof procedureTreeEditorUiAssets;

export function resolveProcedureTreeEditorUiAsset(
  pathname: string,
): ProcedureTreeEditorUiAsset | undefined {
  return procedureTreeEditorUiAssets[pathname as ProcedureTreeEditorUiAssetPath];
}
