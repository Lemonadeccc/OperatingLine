export const procedureTutorialAuthoringUiContentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const procedureTutorialAuthoringUiHeaders = Object.freeze({
  'cache-control': 'no-store',
  'content-security-policy': procedureTutorialAuthoringUiContentSecurityPolicy,
  'cross-origin-opener-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
});

export interface ProcedureTutorialAuthoringUiAsset {
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
    <title>OperatingLine · 教程制作审阅台</title>
    <link rel="stylesheet" href="/procedure-tutorial-authoring/styles.css">
    <script src="/procedure-tutorial-authoring/app.js" defer></script>
  </head>
  <body>
    <a class="skip-link" href="#workspace">跳到制作流程</a>
    <header class="masthead">
      <div><p class="eyebrow">OperatingLine / Recoverable authoring</p><h1>教程制作审阅台</h1></div>
      <p class="boundary" role="note">Provider 只在显式启动后调用 · 审阅前不会存储 · 永不自动创建 Proposal 或执行 Blender</p>
    </header>
    <main id="workspace">
      <section class="source panel" aria-labelledby="source-heading">
        <div class="heading"><span>01</span><div><p class="eyebrow">SOURCE RECEIPT</p><h2 id="source-heading">绑定来源证据</h2></div></div>
        <fieldset class="mode-picker"><legend>来源类型</legend><label><input name="source-mode" type="radio" value="media" checked> 媒体分析</label><label><input name="source-mode" type="radio" value="caption"> Caption track selection</label></fieldset>
        <div id="media-source" class="form-grid">
          <label>Analysis request ID<input id="analysis-request-id" required autocomplete="off" spellcheck="false"></label>
          <label>Analysis job ID<input id="analysis-job-id" required autocomplete="off" spellcheck="false"></label>
          <label class="wide">视频标题<input id="video-title" maxlength="500" autocomplete="off"></label>
          <label class="wide">Authoring prompt request（JSON）<textarea id="prompt-request" rows="7" spellcheck="false"></textarea></label>
          <div class="actions wide"><button id="analysis-status-button" type="button" class="button quiet">查询分析状态</button><button id="prepare-button" type="button" class="button primary">准备 packet</button></div>
        </div>
        <div id="caption-source" hidden>
          <label>Caption track selection receipt（JSON）<textarea id="caption-receipt" rows="10" spellcheck="false"></textarea></label>
          <button id="inspect-caption-button" type="button" class="button quiet">校验并查看回执</button>
          <pre id="caption-summary" class="receipt" aria-live="polite">尚未载入回执。</pre>
          <label>完整 caption authoring run create request（JSON）<textarea id="caption-run-request" rows="10" spellcheck="false"></textarea></label>
        </div>
        <pre id="preparation-summary" class="receipt" aria-live="polite">等待来源输入。</pre>
      </section>

      <section class="run panel" aria-labelledby="run-heading">
        <div class="heading"><span>02</span><div><p class="eyebrow">PROVIDER RUN</p><h2 id="run-heading">显式启动并轮询</h2></div></div>
        <div class="form-grid">
          <label>Run request ID<input id="run-request-id" autocomplete="off" spellcheck="false"></label>
          <label>Generation request ID<input id="generation-request-id" autocomplete="off" spellcheck="false"></label>
          <label class="wide">已确认 Provider descriptor（JSON）<textarea id="provider-descriptor" rows="8" spellcheck="false"></textarea></label>
          <label class="confirmation wide"><input id="provider-confirmed" type="checkbox"> 我已确认 Provider、数据处理方式与可能费用；本次确认不会被长期保存。</label>
          <div class="actions wide"><button id="start-run-button" type="button" class="button primary">启动 Provider run</button><button id="poll-run-button" type="button" class="button quiet" disabled>刷新状态</button></div>
        </div>
        <div class="timeline" aria-label="制作阶段"><span data-stage="provider_generation">Provider</span><span data-stage="materialization">Materialize</span><span data-stage="storage">Store</span></div>
        <pre id="run-status" class="receipt" role="status" aria-live="polite" aria-atomic="true">尚未启动。</pre>
      </section>

      <section class="review panel" aria-labelledby="review-heading">
        <div class="heading"><span>03</span><div><p class="eyebrow">EXACT REVIEW</p><h2 id="review-heading">核对当前完整内容绑定</h2></div></div>
        <dl class="hashes"><div><dt>Preparation</dt><dd id="preparation-hash">—</dd></div><div><dt>Packet</dt><dd id="packet-hash">—</dd></div><div><dt>Candidate</dt><dd id="candidate-hash">—</dd></div><div><dt>Materialized</dt><dd id="materialized-hash">—</dd></div></dl>
        <label class="confirmation"><input id="exact-review" type="checkbox" disabled> 我已逐项审阅当前 preparation、packet、candidate 与 materialized tree。</label>
        <label>Discard 原因（可选）<textarea id="discard-reason" rows="2" maxlength="1000"></textarea></label>
        <div class="actions"><button id="store-button" type="button" class="button primary" disabled>精确审阅后存储</button><button id="discard-button" type="button" class="button danger" disabled>丢弃本次候选</button></div>
      </section>

      <section class="complete panel" aria-labelledby="complete-heading">
        <div class="heading"><span>04</span><div><p class="eyebrow">HANDOFF</p><h2 id="complete-heading">进入本地 ProcedureTree 工作台</h2></div></div>
        <p>这里只打开已存储的树供继续审阅或编辑；不会接受 Proposal，也不会启动宿主执行。</p>
        <a id="open-editor-link" class="button quiet disabled" aria-disabled="true">等待存储完成</a>
      </section>
    </main>
    <footer>访问令牌仅保留在当前标签页的 sessionStorage；页面不会读取、保存或请求 OAuth token。</footer>
  </body>
</html>`;

const css = `:root { --ink:#101315; --panel:#171c1f; --line:#384247; --paper:#eef0e8; --muted:#9aa5a5; --accent:#e8a54b; --cyan:#75c9c8; --danger:#e37c72; --ok:#9bc66d; --mono:ui-monospace,SFMono-Regular,Consolas,monospace; --display:Georgia,serif; }
* { box-sizing:border-box; }
body { margin:0; color:var(--paper); background:var(--ink); font:15px/1.5 system-ui,sans-serif; }
.skip-link { position:absolute; left:-9999px; } .skip-link:focus { left:1rem; top:1rem; z-index:2; padding:.6rem; background:var(--paper); color:var(--ink); }
.masthead { display:flex; justify-content:space-between; gap:2rem; align-items:end; padding:2.4rem max(1.25rem,5vw); border-bottom:1px solid var(--line); }
h1,h2 { margin:0; font-family:var(--display); font-weight:500; } h1 { font-size:clamp(2rem,5vw,4rem); } h2 { font-size:1.55rem; }
.eyebrow { margin:0 0 .3rem; color:var(--muted); font:600 .7rem var(--mono); letter-spacing:.13em; }
.boundary { max-width:38rem; margin:0; padding:.8rem 1rem; border-left:3px solid var(--accent); background:#211d17; }
main { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:1px; background:var(--line); }
.panel { min-width:0; padding:2rem max(1.25rem,4vw); background:var(--ink); }
.heading { display:flex; gap:1rem; align-items:start; margin-bottom:1.5rem; } .heading>span { color:var(--accent); font:700 1rem var(--mono); }
.form-grid { display:grid; grid-template-columns:1fr 1fr; gap:1rem; } .wide { grid-column:1/-1; }
label,legend { display:grid; gap:.4rem; color:var(--muted); font:600 .72rem var(--mono); } input,textarea,select { width:100%; border:1px solid var(--line); border-radius:0; padding:.7rem; color:var(--paper); background:var(--panel); font:inherit; } textarea { resize:vertical; font-family:var(--mono); font-size:.75rem; }
.mode-picker { display:flex; gap:1rem; margin:0 0 1.2rem; border:0; padding:0; } .mode-picker legend { margin-bottom:.5rem; width:100%; } .mode-picker label,.confirmation { display:flex; align-items:flex-start; gap:.55rem; } .mode-picker input,.confirmation input { width:auto; margin-top:.2rem; }
.actions { display:flex; flex-wrap:wrap; gap:.65rem; margin-top:.6rem; } .button { display:inline-block; border:1px solid var(--line); padding:.7rem 1rem; color:var(--paper); background:transparent; font:700 .72rem var(--mono); text-decoration:none; cursor:pointer; } .button.primary { border-color:var(--accent); color:var(--accent); } .button.danger { border-color:var(--danger); color:var(--danger); } .button:hover:not(:disabled) { background:var(--panel); } .button:disabled,.disabled { cursor:not-allowed; opacity:.42; }
.receipt { min-height:4rem; overflow:auto; margin:1rem 0; padding:1rem; border:1px solid var(--line); color:var(--cyan); background:var(--panel); font: .72rem/1.55 var(--mono); white-space:pre-wrap; overflow-wrap:anywhere; }
.timeline { display:grid; grid-template-columns:repeat(3,1fr); gap:1px; margin-top:1.3rem; background:var(--line); } .timeline span { padding:.65rem; color:var(--muted); background:var(--panel); text-align:center; font:.68rem var(--mono); } .timeline .done { color:var(--ok); } .timeline .active { color:var(--accent); }
.hashes { display:grid; gap:.7rem; } .hashes div { padding:.8rem; border-left:2px solid var(--line); background:var(--panel); } dt { color:var(--muted); font:.65rem var(--mono); text-transform:uppercase; } dd { margin:.25rem 0 0; overflow-wrap:anywhere; font:.75rem var(--mono); }
footer { padding:1.5rem max(1.25rem,5vw); color:var(--muted); border-top:1px solid var(--line); font:.7rem var(--mono); }
:focus-visible { outline:2px solid var(--cyan); outline-offset:3px; }
@media (max-width:850px) { .masthead { align-items:start; flex-direction:column; } main { grid-template-columns:1fr; } }
@media (max-width:560px) { .form-grid { grid-template-columns:1fr; } .wide { grid-column:auto; } .mode-picker { flex-direction:column; } }
@media (prefers-reduced-motion:reduce) { *,*::before,*::after { scroll-behavior:auto !important; transition:none !important; animation:none !important; } }`;

const javascript = `(() => {
  'use strict';
  const TOKEN_KEY = 'operatingline.accessToken';
  const API = {
    analysisStatus: '/api/v1/procedure/tutorial/media/jobs/status',
    prepare: '/api/v1/procedure/tutorial/media/authoring/prepare',
    mediaCreate: '/api/v1/procedure/tutorial/media/authoring/runs',
    mediaStatus: '/api/v1/procedure/tutorial/media/authoring/runs/status',
    mediaReview: '/api/v1/procedure/tutorial/media/authoring/runs/review',
    captionCreate: '/api/v1/procedure/tutorial/authoring/runs',
    captionStatus: '/api/v1/procedure/tutorial/authoring/runs/status',
    captionReview: '/api/v1/procedure/tutorial/authoring/runs/review'
  };
  const byId = (id) => document.getElementById(id);
  const elements = {
    mediaSource: byId('media-source'), captionSource: byId('caption-source'), analysisRequestId: byId('analysis-request-id'), analysisJobId: byId('analysis-job-id'), videoTitle: byId('video-title'), promptRequest: byId('prompt-request'), captionReceipt: byId('caption-receipt'), captionSummary: byId('caption-summary'), captionRunRequest: byId('caption-run-request'), preparationSummary: byId('preparation-summary'), analysisStatusButton: byId('analysis-status-button'), prepareButton: byId('prepare-button'), inspectCaptionButton: byId('inspect-caption-button'), runRequestId: byId('run-request-id'), generationRequestId: byId('generation-request-id'), providerDescriptor: byId('provider-descriptor'), providerConfirmed: byId('provider-confirmed'), startRunButton: byId('start-run-button'), pollRunButton: byId('poll-run-button'), runStatus: byId('run-status'), preparationHash: byId('preparation-hash'), packetHash: byId('packet-hash'), candidateHash: byId('candidate-hash'), materializedHash: byId('materialized-hash'), exactReview: byId('exact-review'), discardReason: byId('discard-reason'), storeButton: byId('store-button'), discardButton: byId('discard-button'), openEditorLink: byId('open-editor-link')
  };
  const state = { token: '', mode: 'media', preparation: null, run: null, pollTimer: null, providerConfirmationFingerprint: null, reviewFingerprint: null, exactReviewConfirmationFingerprint: null };
  function consumeFragmentToken() { const fragment = new URLSearchParams(window.location.hash.slice(1)); const token = fragment.get('token'); if (token) sessionStorage.setItem(TOKEN_KEY, token); if (window.location.hash) history.replaceState(null, '', window.location.pathname + window.location.search); return sessionStorage.getItem(TOKEN_KEY) || ''; }
  function parseJson(element, label) { try { return JSON.parse(element.value); } catch { throw new Error(label + ' 必须是有效 JSON。'); } }
  async function request(path, body) { const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + state.token }, cache: 'no-store', credentials: 'same-origin', body: JSON.stringify(body) }); const payload = await response.json(); if (!response.ok) throw new Error(payload.message || payload.error || '请求失败。'); return payload; }
  function uuid() { return crypto.randomUUID(); }
  function show(element, value) { element.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); }
  function fail(error) { show(elements.runStatus, error instanceof Error ? error.message : '操作失败。'); }
  function versioned(value) { return { formatVersion: '1.0.0', ...value }; }
  function clearProviderConfirmation() { elements.providerConfirmed.checked = false; state.providerConfirmationFingerprint = null; }
  function clearExactReview() { elements.exactReview.checked = false; state.exactReviewConfirmationFingerprint = null; elements.storeButton.disabled = true; }
  function providerFingerprint() { return JSON.stringify({ mode: state.mode, descriptor: parseJson(elements.providerDescriptor, 'Provider descriptor') }); }
  function currentReviewFingerprint(run) { if (!run || run.status !== 'awaiting_review' || !run.preview) return null; const preview = run.preview; const preparation = preview.preparation; const packet = preparation ? preparation.packet : preview.generation.packet; const materialization = preview.materialization; return JSON.stringify({ requestId: run.requestId, runId: run.runId, reviewId: run.reviewId, preparationFingerprint: preparation ? preparation.fingerprint : null, packetContentSha256: packet.integrity.contentSha256, candidateTreeContentSha256: materialization.inputTreeContentSha256, materializedTreeContentSha256: materialization.outputTreeContentSha256 }); }
  function setMode(mode) { state.mode = mode; elements.mediaSource.hidden = mode !== 'media'; elements.captionSource.hidden = mode !== 'caption'; clearProviderConfirmation(); state.run = null; updateRun(null); }
  function preparationRequest() { return versioned({ analysisRequestId: elements.analysisRequestId.value.trim(), analysisJobId: elements.analysisJobId.value.trim(), request: parseJson(elements.promptRequest, 'Authoring prompt request'), video: { title: elements.videoTitle.value.trim() } }); }
  async function checkAnalysis() { const payload = await request(API.analysisStatus, versioned({ requestId: elements.analysisRequestId.value.trim(), jobId: elements.analysisJobId.value.trim() })); show(elements.preparationSummary, payload); }
  async function prepare() { const payload = await request(API.prepare, preparationRequest()); state.preparation = payload.status === 'ready' ? payload : null; show(elements.preparationSummary, payload); if (!state.preparation) throw new Error('准备结果被阻断，没有可交给 Provider 的 packet。'); elements.preparationHash.textContent = state.preparation.fingerprint; elements.packetHash.textContent = state.preparation.packet.integrity.contentSha256; }
  function inspectCaption() { const receipt = parseJson(elements.captionReceipt, 'Caption selection receipt'); const summary = { requestId: receipt.requestId, requestFingerprint: receipt.requestFingerprint, videoId: receipt.sourceTrackList && receipt.sourceTrackList.videoId, captionTrackId: receipt.selectedTrack && receipt.selectedTrack.captionTrackId, explicitlyConfirmedByUser: receipt.confirmation && receipt.confirmation.explicitlyConfirmedByUser, recordedAt: receipt.recordedAt }; show(elements.captionSummary, summary); }
  function providerAuthorization() { const descriptor = parseJson(elements.providerDescriptor, 'Provider descriptor'); const fingerprint = JSON.stringify({ mode: state.mode, descriptor: descriptor }); if (!elements.providerConfirmed.checked || state.providerConfirmationFingerprint !== fingerprint) throw new Error('启动前必须针对当前 Provider descriptor 显式确认数据处理方式与可能费用。'); return { providerDescriptor: descriptor, explicitlyConfirmedByUser: true, dataHandlingAcknowledged: true, possibleProviderCostAcknowledged: true, confirmedAt: new Date().toISOString() }; }
  function mediaRunRequest() { if (!state.preparation) throw new Error('请先取得 ready preparation。'); return versioned({ requestId: elements.runRequestId.value.trim() || uuid(), preparation: state.preparation, provider: { generationRequestId: elements.generationRequestId.value.trim() || uuid(), authorization: providerAuthorization() } }); }
  async function startRun() { const body = state.mode === 'media' ? mediaRunRequest() : parseJson(elements.captionRunRequest, 'Caption authoring run request'); const payload = await request(state.mode === 'media' ? API.mediaCreate : API.captionCreate, body); clearProviderConfirmation(); state.run = payload; elements.runRequestId.value = payload.requestId; updateRun(payload); schedulePoll(); }
  function statusRequest() { if (!state.run) throw new Error('尚无可轮询的 run。'); return versioned({ requestId: state.run.requestId, runId: state.run.runId }); }
  async function pollRun() { const payload = await request(state.mode === 'media' ? API.mediaStatus : API.captionStatus, statusRequest()); state.run = payload; updateRun(payload); schedulePoll(); }
  function schedulePoll() { if (state.pollTimer !== null) window.clearTimeout(state.pollTimer); state.pollTimer = null; if (!state.run || !['accepted','running'].includes(state.run.status)) return; state.pollTimer = window.setTimeout(() => pollRun().catch(fail), 1500); }
  function updateRun(run) { show(elements.runStatus, run || '尚未启动。'); elements.pollRunButton.disabled = !run; const completed = run ? run.completedStages || [] : []; for (const marker of document.querySelectorAll('[data-stage]')) { marker.classList.toggle('done', completed.includes(marker.dataset.stage)); marker.classList.toggle('active', run && run.currentStage === marker.dataset.stage); } const preview = run && run.status === 'awaiting_review' ? run.preview : null; const preparation = preview && preview.preparation; const packet = preview && (preparation ? preparation.packet : preview.generation.packet); const materialization = preview && preview.materialization; const nextReviewFingerprint = currentReviewFingerprint(run); if (state.reviewFingerprint !== nextReviewFingerprint) { clearExactReview(); state.reviewFingerprint = nextReviewFingerprint; } elements.preparationHash.textContent = preparation ? preparation.fingerprint : '—'; elements.packetHash.textContent = packet ? packet.integrity.contentSha256 : '—'; elements.candidateHash.textContent = materialization ? materialization.inputTreeContentSha256 : '—'; elements.materializedHash.textContent = materialization ? materialization.outputTreeContentSha256 : '—'; const reviewable = Boolean(preview); const exactReviewConfirmed = reviewable && elements.exactReview.checked && state.exactReviewConfirmationFingerprint === state.reviewFingerprint; elements.exactReview.disabled = !reviewable; elements.storeButton.disabled = !exactReviewConfirmed; elements.discardButton.disabled = !reviewable; if (run && run.status === 'completed') { const treeId = run.result.storage.record.tree.id; elements.openEditorLink.href = '/procedure-editor?treeId=' + encodeURIComponent(treeId); elements.openEditorLink.textContent = '打开 ' + treeId; elements.openEditorLink.classList.remove('disabled'); elements.openEditorLink.removeAttribute('aria-disabled'); } }
  async function review(decision) { if (!state.run || state.run.status !== 'awaiting_review') throw new Error('当前没有待审阅候选。'); const preview = state.run.preview; const preparation = preview.preparation; const materialization = preview.materialization; let review; if (decision === 'store') { const fingerprint = currentReviewFingerprint(state.run); if (!elements.exactReview.checked || !fingerprint || state.exactReviewConfirmationFingerprint !== fingerprint) throw new Error('必须针对当前 preparation、packet、candidate 与 materialized tree 重新确认精确审阅。'); review = { decision: 'store', ...(preparation ? { preparationFingerprint: preparation.fingerprint } : {}), packetContentSha256: (preparation ? preparation.packet : preview.generation.packet).integrity.contentSha256, candidateTreeContentSha256: materialization.inputTreeContentSha256, materializedTreeContentSha256: materialization.outputTreeContentSha256, confirmations: { ...(preparation ? { exactPreparationReviewed: true } : {}), exactPacketReviewed: true, exactCandidateTreeReviewed: true, exactMaterializedTreeReviewed: true } }; } else { const reason = elements.discardReason.value.trim(); review = { decision: 'discard', ...(reason ? { reason: reason } : {}) }; } const payload = await request(state.mode === 'media' ? API.mediaReview : API.captionReview, versioned({ requestId: state.run.requestId, runId: state.run.runId, reviewId: state.run.reviewId, review: review, reviewedAt: new Date().toISOString() })); state.run = payload; updateRun(payload); }
  for (const radio of document.querySelectorAll('[name="source-mode"]')) radio.addEventListener('change', () => setMode(radio.value));
  elements.analysisStatusButton.addEventListener('click', () => checkAnalysis().catch(fail));
  elements.prepareButton.addEventListener('click', () => prepare().catch(fail));
  elements.inspectCaptionButton.addEventListener('click', () => { try { inspectCaption(); } catch (error) { fail(error); } });
  elements.providerDescriptor.addEventListener('input', clearProviderConfirmation);
  elements.runRequestId.addEventListener('input', clearProviderConfirmation);
  elements.generationRequestId.addEventListener('input', clearProviderConfirmation);
  elements.providerConfirmed.addEventListener('change', () => { if (!elements.providerConfirmed.checked) { state.providerConfirmationFingerprint = null; return; } try { state.providerConfirmationFingerprint = providerFingerprint(); } catch (error) { clearProviderConfirmation(); fail(error); } });
  elements.startRunButton.addEventListener('click', () => startRun().catch(fail));
  elements.pollRunButton.addEventListener('click', () => pollRun().catch(fail));
  elements.exactReview.addEventListener('change', () => { state.exactReviewConfirmationFingerprint = elements.exactReview.checked ? currentReviewFingerprint(state.run) : null; elements.storeButton.disabled = !elements.exactReview.checked || !state.exactReviewConfirmationFingerprint; });
  elements.storeButton.addEventListener('click', () => review('store').catch(fail));
  elements.discardButton.addEventListener('click', () => review('discard').catch(fail));
  state.token = consumeFragmentToken();
  if (!state.token) show(elements.runStatus, '缺少访问令牌。请通过带 #token=… 的本地地址重新打开。');
})();`;

function asset(body: string, contentType: string): ProcedureTutorialAuthoringUiAsset {
  return Object.freeze({
    body,
    contentType,
    headers: Object.freeze({ ...procedureTutorialAuthoringUiHeaders, 'content-type': contentType }),
  });
}

export const procedureTutorialAuthoringUiAssets = Object.freeze({
  '/procedure-tutorial-authoring': asset(html, 'text/html; charset=utf-8'),
  '/procedure-tutorial-authoring/': asset(html, 'text/html; charset=utf-8'),
  '/procedure-tutorial-authoring/app.js': asset(javascript, 'text/javascript; charset=utf-8'),
  '/procedure-tutorial-authoring/styles.css': asset(css, 'text/css; charset=utf-8'),
});

export type ProcedureTutorialAuthoringUiAssetPath = keyof typeof procedureTutorialAuthoringUiAssets;

export function resolveProcedureTutorialAuthoringUiAsset(
  pathname: string,
): ProcedureTutorialAuthoringUiAsset | undefined {
  return procedureTutorialAuthoringUiAssets[pathname as ProcedureTutorialAuthoringUiAssetPath];
}
