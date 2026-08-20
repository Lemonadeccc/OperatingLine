import { describe, expect, it } from 'vitest';

import {
  procedureTreeEditorUiAssets,
  procedureTreeEditorUiContentSecurityPolicy,
  procedureTreeEditorUiHeaders,
  resolveProcedureTreeEditorUiAsset,
} from '../../../services/orchestrator/src/procedure-tree-editor-ui.js';

describe('ProcedureTree editor UI assets', () => {
  it('exports independently served HTML, stylesheet, and script assets', () => {
    const html = resolveProcedureTreeEditorUiAsset('/procedure-editor');
    const stylesheet = resolveProcedureTreeEditorUiAsset('/procedure-editor/styles.css');
    const script = resolveProcedureTreeEditorUiAsset('/procedure-editor/app.js');

    expect(Object.keys(procedureTreeEditorUiAssets)).toEqual([
      '/procedure-editor',
      '/procedure-editor/',
      '/procedure-editor/app.js',
      '/procedure-editor/styles.css',
    ]);
    expect(html?.contentType).toBe('text/html; charset=utf-8');
    expect(stylesheet?.contentType).toBe('text/css; charset=utf-8');
    expect(script?.contentType).toBe('text/javascript; charset=utf-8');
    expect(resolveProcedureTreeEditorUiAsset('/procedure-editor/missing')).toBeUndefined();
  });

  it('is compatible with a strict self-only CSP and disables storage by caches', () => {
    expect(procedureTreeEditorUiContentSecurityPolicy).toContain("default-src 'none'");
    expect(procedureTreeEditorUiContentSecurityPolicy).toContain("script-src 'self'");
    expect(procedureTreeEditorUiContentSecurityPolicy).toContain("style-src 'self'");
    expect(procedureTreeEditorUiContentSecurityPolicy).toContain("form-action 'none'");
    expect(procedureTreeEditorUiContentSecurityPolicy).not.toContain("'unsafe-inline'");
    expect(procedureTreeEditorUiContentSecurityPolicy).not.toContain("'unsafe-eval'");
    expect(procedureTreeEditorUiHeaders).toMatchObject({
      'cache-control': 'no-store',
      'content-security-policy': procedureTreeEditorUiContentSecurityPolicy,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    });
    for (const asset of Object.values(procedureTreeEditorUiAssets)) {
      expect(asset.headers['cache-control']).toBe('no-store');
      expect(asset.headers['content-security-policy']).toBe(
        procedureTreeEditorUiContentSecurityPolicy,
      );
      expect(asset.headers['content-type']).toBe(asset.contentType);
    }
  });

  it('contains no inline script, inline style element, or HTML event handler', () => {
    const html = procedureTreeEditorUiAssets['/procedure-editor'].body;

    expect(html).toContain('<script src="/procedure-editor/app.js" defer></script>');
    expect(html).toContain('<link rel="stylesheet" href="/procedure-editor/styles.css">');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/iu);
    expect(html).not.toMatch(/<style\b/iu);
    expect(html).not.toMatch(/\sstyle\s*=/iu);
    expect(html).not.toMatch(/\son[a-z]+\s*=/iu);
  });

  it('moves a fragment token into sessionStorage and clears the fragment without exposing it', () => {
    const script = procedureTreeEditorUiAssets['/procedure-editor/app.js'].body;

    expect(script).toContain('new URLSearchParams(window.location.hash.slice(1))');
    expect(script).toContain("fragment.get('token')");
    expect(script).toContain('sessionStorage.setItem(TOKEN_KEY, token)');
    expect(script).toContain(
      "history.replaceState(null, '', window.location.pathname + window.location.search)",
    );
    expect(script).toContain("authorization: 'Bearer ' + state.token");
    expect(script).not.toContain('localStorage');
    expect(script).not.toMatch(/textContent\s*=\s*token/u);
    expect(script).not.toMatch(/console\.(?:debug|info|log|warn|error)\s*\(/u);
    expect(script).not.toContain('.style.');
  });

  it('wires the complete editor API surface and keeps execution safety explicit', () => {
    const html = procedureTreeEditorUiAssets['/procedure-editor'].body;
    const script = procedureTreeEditorUiAssets['/procedure-editor/app.js'].body;
    const paths = [
      '/api/v1/procedure/editor/branches/create',
      '/api/v1/procedure/editor/branches/get',
      '/api/v1/procedure/editor/branches/list',
      '/api/v1/procedure/editor/workspaces/get',
      '/api/v1/procedure/editor/history/list',
      '/api/v1/procedure/editor/edits/preview',
      '/api/v1/procedure/editor/merges/preview',
      '/api/v1/procedure/editor/commits/create',
      '/api/v1/procedure/editor/comments/create',
      '/api/v1/procedure/editor/comments/list',
      '/api/v1/procedure/editor/parameters/form',
    ];

    for (const path of paths) expect(script).toContain(path);
    expect(script).toContain("latest: '/api/v1/procedure'");
    expect(script).toContain("method: method || 'POST'");
    expect(script).toContain('await refreshLatest()');
    expect(script).toContain("input.setAttribute('aria-label', field.label + ' ' + (index + 1))");
    expect(script).toContain('input.checkValidity()');
    expect(script).toContain('formatMergeOperand(conflict.mergeBase)');
    expect(script).toContain('commit.source.branchId');
    expect(html).toContain('ProcedureTree ID');
    expect(html).toContain('步骤树');
    expect(html).toContain('参数表单');
    expect(html).toContain('Revision 历史');
    expect(html).toContain('锚点评论');
    expect(html).toContain('合并分支');
    expect(html).toContain('不会创建 Proposal · 不会执行 Blender');
    expect(script).toContain('proposalCreated: false, hostExecutionStarted: false');
  });

  it('provides accessible status, labelled forms, keyboard-native controls, and responsive CSS', () => {
    const html = procedureTreeEditorUiAssets['/procedure-editor'].body;
    const css = procedureTreeEditorUiAssets['/procedure-editor/styles.css'].body;

    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(html).toContain('<label for="tree-id">');
    expect(html).toContain('<label for="branch-select">');
    expect(html).toContain('<label for="comment-body">');
    expect(html).toContain('aria-label="ProcedureTree 层级"');
    expect(html).toContain('class="skip-link"');
    expect(css).toContain('@media (max-width: 1050px)');
    expect(css).toContain('@media (max-width: 720px)');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain(':focus-visible');
  });

  it('offers invariant-preserving local structural editing with stable IDs and confirmations', () => {
    const script = procedureTreeEditorUiAssets['/procedure-editor/app.js'].body;
    const css = procedureTreeEditorUiAssets['/procedure-editor/styles.css'].body;

    expect(script).toContain("newStableId('node.group')");
    expect(script).toContain("newStableId('node.leaf')");
    expect(script).toContain('allocatedStableIds.has(candidate)');
    expect(script).toContain("commandButton('添加分组', 'add-node'");
    expect(script).toContain("commandButton('添加叶子', 'add-node'");
    expect(script).toContain("commandButton('删除节点', 'delete-node'");
    expect(script).toContain("structureInput('语义动作'");
    expect(script).toContain("structureInput('描述'");
    expect(script).toContain('semanticOperationExistedAtLoad(node.id, operation.id)');
    expect(script).toContain("input.title = '既有语义动作身份由服务端保护。'");
    expect(script).toContain('projectionTargetsOperation');
    expect(script).toContain('删除后会让轨迹失去语义覆盖');
    expect(script).not.toContain('track.operations[0].semanticRefs.push(reference)');
    expect(script).toContain('assertNoDraftSentinels(state.targetTree)');
    expect(script).toContain("window.confirm('确认从本地候选树删除'");
    expect(script).toContain('node.id === state.targetTree.rootNodeId');
    expect(script).toContain('descendantIds(nodeId).has(newParentId)');
    expect(script).toContain('siblings(oldParentId).length === 1');
    expect(script).toContain('item.dependsOn = item.dependsOn.filter');
    expect(script).toContain('格式 1.1.0 必须保留至少一个 operator_property_update');
    expect(script).toContain('轨迹集合按稳定 ID 管理，没有顺序语义。');
    expect(script).not.toContain("'reorder-track'");
    expect(css).toContain('.structure-panel');
    expect(css).toContain('.structure-row');
  });

  it('protects dirty candidates and exhausts branch, history, and comment cursors', () => {
    const script = procedureTreeEditorUiAssets['/procedure-editor/app.js'].body;

    expect(script).toContain('state.mergePreview = null;');
    expect(script).toContain("confirmDiscardChanges('切换分支')");
    expect(script).toContain("confirmDiscardChanges('新建分支')");
    expect(script).toContain("confirmDiscardChanges('加载另一棵 ProcedureTree')");
    expect(script).toContain(
      "if (state.dirty) throw new Error('请先提交或明确丢弃本地编辑，再预览合并。')",
    );
    expect(script).toContain("if (operation === 'merge' && state.dirty)");
    expect(script).toContain('body.afterBranchId = afterBranchId');
    expect(script).toContain('page.nextAfterBranchId');
    expect(script).toContain('body.afterRevision = afterRevision');
    expect(script).toContain('page.nextAfterRevision');
    expect(script).toContain('expectedHead: snapshot.expectedHead');
    expect(script).toContain('canonicalSnapshot(page.snapshotHead) !== snapshot.head');
    expect(script).toContain('body.afterCommentId = afterCommentId');
    expect(script).toContain('page.nextAfterCommentId');
    expect(script).toContain('historyLoadId: 0, commentsLoadId: 0');
    expect(script).toContain('const loadId = ++state.historyLoadId');
    expect(script).toContain('const loadId = ++state.commentsLoadId');
    expect(script).toContain('if (!isCurrent()) return');
    expect(script).toContain('anchor: clone(currentAnchor())');
  });

  it('collects complete, ordered conflict resolutions and re-previews before merge commit', () => {
    const html = procedureTreeEditorUiAssets['/procedure-editor'].body;
    const script = procedureTreeEditorUiAssets['/procedure-editor/app.js'].body;

    expect(html).toContain('id="merge-resolve-button"');
    expect(script).toContain("new Option('保留目标分支', 'target')");
    expect(script).toContain("new Option('采用来源分支', 'source')");
    expect(script).toContain("new Option('采用合并基线', 'base')");
    expect(script).toContain("new Option('自定义 JSON', 'custom')");
    expect(script).toContain('resolution.custom = { present: false }');
    expect(script).toContain('const value = JSON.parse(raw)');
    expect(script).toContain('if (!isJsonValue(value))');
    expect(script).toContain('resolution.custom = { present: true, value: value }');
    expect(script).toContain('for (let index = 0; index < preview.conflicts.length; index += 1)');
    expect(script).toContain('resolutions: resolutions');
    expect(script).toContain("payload.status === 'ready'");
  });

  it('keeps non-Action parameters readonly and rejects invalid Action numbers', () => {
    const script = procedureTreeEditorUiAssets['/procedure-editor/app.js'].body;

    expect(script).toContain("const canEdit = payload.target.kind === 'action' && field.editable");
    expect(script).toContain("state.selected.kind !== 'action'");
    expect(script).not.toContain('parameterAssociations');
    expect(script).not.toContain('uniform_vector3');
    expect(script).toContain('input.required = true');
    expect(script).toContain(
      "if (input.value.trim() === '') throw new Error('数字参数不能为空。')",
    );
    expect(script).toContain(
      "if (!Number.isFinite(value)) throw new Error('数字参数必须是有限数值。')",
    );
    expect(script).toContain('!Number.isInteger(value)');
  });

  it('discards stale parameter forms across branch, head, selection, and mutation changes', () => {
    const script = procedureTreeEditorUiAssets['/procedure-editor/app.js'].body;

    expect(script).toContain('parameterFormLoadId: 0');
    expect(script).toContain('const loadId = ++state.parameterFormLoadId');
    expect(script).toContain('loadId === state.parameterFormLoadId');
    expect(script).toContain('state.mutationEpoch === snapshot.epoch');
    expect(script).toContain('state.branch.branchId === snapshot.branchId');
    expect(script).toContain('canonicalSnapshot(state.branch.head) === snapshot.head');
    expect(script).toContain(
      'canonicalSnapshot(selectionTarget(state.selected)) === snapshot.selection',
    );
    expect(script).toContain("throw new Error('参数表单响应与请求快照不一致。')");
  });

  it('preserves comment drafts and local candidates across stale write responses', () => {
    const script = procedureTreeEditorUiAssets['/procedure-editor/app.js'].body;

    expect(script).toContain('commentCreateId: 0');
    expect(script).toContain('const createId = ++state.commentCreateId');
    expect(script).toContain('createId === state.commentCreateId');
    expect(script).toContain(
      'createId === state.commentCreateId && state.mutationEpoch === snapshot.epoch',
    );
    expect(script).toContain('canonicalSnapshot(currentAnchor()) === snapshot.anchorIdentity');
    expect(script).toContain('const draftValue = elements.commentBody.value');
    expect(script).toContain('const body = draftValue.trim()');
    expect(script).toContain('draftValue: draftValue');
    expect(script).toContain(
      'const draftMatches = elements.commentBody.value === snapshot.draftValue',
    );
    expect(script).toContain('现有草稿已保留');
    expect(script).toContain(
      'const createdFrom = clone(state.branch ? state.branch.head : state.latest)',
    );
    expect(script).toContain('state.mutationEpoch === snapshot.epoch');
    expect(script).toContain('(state.branch ? state.branch.branchId : null) === snapshot.branchId');
    expect(script).toContain(
      'refreshBranchesAndWorkspace(payload.branch.branchId, snapshot.epoch)',
    );
    expect(script).toContain('未自动刷新或切换分支');
    expect(script).toContain('未自动切换分支');
  });

  it('binds previews and commits to a mutation epoch and canonical candidate snapshot', () => {
    const script = procedureTreeEditorUiAssets['/procedure-editor/app.js'].body;

    expect(script).toContain('mutationEpoch: 0');
    expect(script).toContain('function canonicalSnapshot(value)');
    expect(script).toContain('function bumpMutationEpoch()');
    expect(script).toContain('const requestedEpoch = state.mutationEpoch');
    expect(script).toContain('candidate: canonicalSnapshot(tree)');
    expect(script).toContain('if (!matchesEditSnapshot(snapshot))');
    expect(script).toContain('preview !== state.preview');
    expect(script).toContain('!matchesEditSnapshot(state.previewSnapshot)');
    expect(script).toContain('if (!matchesMergeSnapshot(snapshot))');
    expect(script).toContain('preview !== state.mergePreview');
    expect(script).toContain('elements.sourceBranch.value !== snapshot.sourceBranchId');
    expect(script).toContain('const resolutionIdentity = canonicalSnapshot(resolutions)');
    expect(script).toContain('canonicalSnapshot(currentResolutions) !== resolutionIdentity');
    expect(script).toContain('state.mutationEpoch !== epoch');
    expect(script).toContain('state.previewSnapshot = null');
    expect(script).toContain('state.mergeSnapshot = null');
    expect(script).toContain('commitInFlight: false');
    expect(script).toContain('const commitEpoch = state.mutationEpoch');
    expect(script).toContain('const commitTreeId = state.treeId');
    expect(script).toContain(
      'if (state.treeId === commitTreeId) state.latest = payload.branch.head',
    );
    expect(script).toContain('state.mutationEpoch !== commitEpoch');
    expect(script).toContain('state.treeId !== commitTreeId');
    expect(script).toContain('refreshBranchesAndWorkspace(payload.branch.branchId, commitEpoch)');
    expect(script).toContain('为避免丢失未刷新工作区');
    expect(script).toContain('为避免丢失未覆盖工作区');
  });
});
