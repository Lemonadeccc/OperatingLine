import { describe, expect, it } from 'vitest';

import {
  procedureTutorialAuthoringUiAssets,
  procedureTutorialAuthoringUiContentSecurityPolicy,
  procedureTutorialAuthoringUiHeaders,
  resolveProcedureTutorialAuthoringUiAsset,
} from '../../../services/orchestrator/src/procedure-tutorial-authoring-ui.js';

describe('Procedure tutorial authoring UI assets', () => {
  it('serves independent HTML, CSS, and JavaScript assets', () => {
    expect(Object.keys(procedureTutorialAuthoringUiAssets)).toEqual([
      '/procedure-tutorial-authoring',
      '/procedure-tutorial-authoring/',
      '/procedure-tutorial-authoring/app.js',
      '/procedure-tutorial-authoring/styles.css',
    ]);
    expect(
      resolveProcedureTutorialAuthoringUiAsset('/procedure-tutorial-authoring')?.contentType,
    ).toBe('text/html; charset=utf-8');
    expect(resolveProcedureTutorialAuthoringUiAsset('/missing')).toBeUndefined();
  });

  it('uses a self-only CSP, no-store headers, and no inline executable content', () => {
    const html = procedureTutorialAuthoringUiAssets['/procedure-tutorial-authoring'].body;
    expect(procedureTutorialAuthoringUiContentSecurityPolicy).toContain("default-src 'none'");
    expect(procedureTutorialAuthoringUiContentSecurityPolicy).toContain("script-src 'self'");
    expect(procedureTutorialAuthoringUiContentSecurityPolicy).toContain("style-src 'self'");
    expect(procedureTutorialAuthoringUiContentSecurityPolicy).not.toContain("'unsafe-inline'");
    expect(procedureTutorialAuthoringUiContentSecurityPolicy).not.toContain("'unsafe-eval'");
    expect(procedureTutorialAuthoringUiHeaders).toMatchObject({
      'cache-control': 'no-store',
      'content-security-policy': procedureTutorialAuthoringUiContentSecurityPolicy,
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
    });
    expect(html).toContain('<script src="/procedure-tutorial-authoring/app.js" defer></script>');
    expect(html).not.toMatch(/<script(?![^>]*\bsrc=)[^>]*>/iu);
    expect(html).not.toMatch(/<style\b/iu);
    expect(html).not.toMatch(/\son[a-z]+\s*=/iu);
  });

  it('keeps only the access token in sessionStorage and never handles OAuth tokens', () => {
    const html = procedureTutorialAuthoringUiAssets['/procedure-tutorial-authoring'].body;
    const script = procedureTutorialAuthoringUiAssets['/procedure-tutorial-authoring/app.js'].body;
    expect(script).toContain("const TOKEN_KEY = 'operatingline.accessToken'");
    expect(script).toContain('sessionStorage.setItem(TOKEN_KEY, token)');
    expect(script).toContain("authorization: 'Bearer ' + state.token");
    expect(script).not.toContain('localStorage');
    expect(script).not.toMatch(/oauth(?:Token|_token)/iu);
    expect(script).not.toMatch(/console\.(?:debug|info|log|warn|error)\s*\(/u);
    expect(html).toContain('页面不会读取、保存或请求 OAuth token');
  });

  it('covers preparation, polling, exact hash review, and editor handoff', () => {
    const html = procedureTutorialAuthoringUiAssets['/procedure-tutorial-authoring'].body;
    const script = procedureTutorialAuthoringUiAssets['/procedure-tutorial-authoring/app.js'].body;
    for (const path of [
      '/api/v1/procedure/tutorial/media/jobs/status',
      '/api/v1/procedure/tutorial/media/authoring/prepare',
      '/api/v1/procedure/tutorial/media/authoring/runs',
      '/api/v1/procedure/tutorial/media/authoring/runs/status',
      '/api/v1/procedure/tutorial/media/authoring/runs/review',
      '/api/v1/procedure/tutorial/authoring/runs',
      '/api/v1/procedure/tutorial/authoring/runs/status',
      '/api/v1/procedure/tutorial/authoring/runs/review',
    ])
      expect(script).toContain(path);
    expect(html).toContain('Caption track selection receipt');
    expect(html).toContain('Analysis request ID');
    expect(html).toContain('Preparation');
    expect(html).toContain('Packet');
    expect(html).toContain('Candidate');
    expect(html).toContain('Materialized');
    expect(html).toContain('永不自动创建 Proposal 或执行 Blender');
    expect(script).toContain('window.setTimeout(() => pollRun().catch(fail), 1500)');
    expect(script).toContain('exactPreparationReviewed: true');
    expect(script).toContain('exactCandidateTreeReviewed: true');
    expect(script).toContain("review('discard')");
    expect(script).toContain("'/procedure-editor?treeId='");
  });

  it('binds Provider and exact-review confirmations to the current immutable inputs', () => {
    const script = procedureTutorialAuthoringUiAssets['/procedure-tutorial-authoring/app.js'].body;

    expect(script).toContain('providerConfirmationFingerprint');
    expect(script).toContain(
      "elements.providerDescriptor.addEventListener('input', clearProviderConfirmation)",
    );
    expect(script).toContain(
      "elements.runRequestId.addEventListener('input', clearProviderConfirmation)",
    );
    expect(script).toContain(
      "elements.generationRequestId.addEventListener('input', clearProviderConfirmation)",
    );
    expect(script).toContain('state.providerConfirmationFingerprint !== fingerprint');
    expect(script).toContain(
      'const nextReviewFingerprint = currentReviewFingerprint(run); if (state.reviewFingerprint !== nextReviewFingerprint) { clearExactReview(); state.reviewFingerprint = nextReviewFingerprint; }',
    );
    expect(script).toContain('packetContentSha256: packet.integrity.contentSha256');
    expect(script).toContain('candidateTreeContentSha256: materialization.inputTreeContentSha256');
    expect(script).toContain(
      'materializedTreeContentSha256: materialization.outputTreeContentSha256',
    );
    expect(script).toContain('state.exactReviewConfirmationFingerprint !== fingerprint');
  });

  it('provides accessible live states and responsive, reduced-motion styling', () => {
    const html = procedureTutorialAuthoringUiAssets['/procedure-tutorial-authoring'].body;
    const css = procedureTutorialAuthoringUiAssets['/procedure-tutorial-authoring/styles.css'].body;
    expect(html).toContain('role="status" aria-live="polite" aria-atomic="true"');
    expect(html).toContain('class="skip-link"');
    expect(html).toContain('<fieldset class="mode-picker">');
    expect(css).toContain(':focus-visible');
    expect(css).toContain('@media (max-width:850px)');
    expect(css).toContain('@media (prefers-reduced-motion:reduce)');
  });
});
