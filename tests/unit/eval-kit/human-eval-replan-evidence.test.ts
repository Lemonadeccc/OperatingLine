import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { blenderActionCatalog } from '@operatingline/blender-action-catalog';
import {
  computeHumanEvalCaseSha256,
  contentWithoutIntegrity,
  createProviderEvalRun,
  loadHumanEvalDatasetDirectory,
  sealHumanEvalSuite,
} from '@operatingline/eval-kit';
import type { HumanEvalDatasetError } from '@operatingline/eval-kit';
import { buildReplanningPromptPacket, createLocalReplanScope } from '@operatingline/orchestrator';
import {
  guidePlanSchema,
  guideRevisionRequestSchema,
  humanEvalSuiteSchema,
  type GuidePlan,
  type HumanEvalSuite,
  type ProviderEvalRun,
} from '@operatingline/protocol';
import { describe, expect, it } from 'vitest';

import { buildProviderEvalRunFixture } from '../../support/human-eval-fixtures.js';

const revisionRequestId = '50000000-0000-4000-8000-000000000001';
const generationRequestId = '50000000-0000-4000-8000-000000000002';
const runId = '50000000-0000-4000-8000-000000000003';
const instanceId = '50000000-0000-4000-8000-000000000004';
const caseId = 'blender.snowman_rougher_body_replan';

function rawSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

async function publicSuite(): Promise<HumanEvalSuite> {
  return humanEvalSuiteSchema.parse(
    JSON.parse(
      await readFile(resolve('protocol/fixtures/v1/eval/blender-core/suite.json'), 'utf8'),
    ) as unknown,
  );
}

function suiteWithLocalPlanArtifacts(
  suite: HumanEvalSuite,
  exactPlanJson: string,
  decoyPlanJson: string,
): HumanEvalSuite {
  const content = structuredClone(contentWithoutIntegrity(suite));
  const evalCase = content.cases.find((candidate) => candidate.id === caseId);
  if (evalCase?.operation !== 'local_replan') {
    throw new Error(`Public suite is missing local-replan case ${caseId}`);
  }
  const baseReference = evalCase.references.find(
    (reference) => reference.artifactId === evalCase.basePlan.artifactId,
  );
  if (baseReference === undefined) {
    throw new Error('Public local-replan case is missing its declared base Plan artifact');
  }
  baseReference.uri = 'base-plan.json';
  baseReference.contentSha256 = rawSha256(exactPlanJson);
  evalCase.references.push({
    artifactId: 'snowman.replan_decoy',
    kind: 'guide_plan',
    mediaType: 'application/json',
    uri: 'decoy-plan.json',
    contentSha256: rawSha256(decoyPlanJson),
    metadata: { role: 'unrelated_guide_plan' },
  });
  return sealHumanEvalSuite(content);
}

function buildLocalReplanRun(suite: HumanEvalSuite, basePlan: GuidePlan): ProviderEvalRun {
  const evalCase = suite.cases.find((candidate) => candidate.id === caseId);
  if (evalCase?.operation !== 'local_replan') {
    throw new Error(`Suite is missing local-replan case ${caseId}`);
  }
  const reusableFixture = buildProviderEvalRunFixture();
  const revisionRequest = guideRevisionRequestSchema.parse({
    protocolVersion: '1.1.0',
    requestId: revisionRequestId,
    adapterId: evalCase.targetAdapterId,
    catalogVersion: evalCase.catalogVersion,
    instanceId,
    basePlan,
    references: evalCase.referencedNodeIds.map((nodeId) => ({
      nodeId,
      nodeNumber: '1.4.1',
    })),
    message: evalCase.revisionMessage,
    revisionThread: { threadId: revisionRequestId, turn: 1, parentRequestId: null },
    occurredAt: '2026-08-05T00:00:00.000Z',
  });
  const packet = buildReplanningPromptPacket({
    revisionRequest,
    targetRevision: basePlan.revision + 1,
    catalog: blenderActionCatalog,
    companionState: null,
    scope: createLocalReplanScope(revisionRequest),
  });

  return createProviderEvalRun({
    formatVersion: '1.0.0',
    runId,
    caseRef: {
      suiteId: suite.suiteId,
      suiteVersion: suite.suiteVersion,
      caseId: evalCase.id,
      caseContentSha256: computeHumanEvalCaseSha256(evalCase),
    },
    sourceKind: 'synthetic_test_fixture',
    sourceEvidence: { kind: 'synthetic_test_fixture' },
    replicateIndex: 1,
    parentRunId: null,
    profile: reusableFixture.profile,
    environment: {
      ...reusableFixture.environment,
      targetAdapterId: evalCase.targetAdapterId,
      catalogVersion: evalCase.catalogVersion,
      adapterVersion: '1.0.0',
      hostVersion: '4.5.0',
    },
    invocation: {
      operation: 'local_replan',
      request: {
        requestId: generationRequestId,
        revisionRequestId,
        providerId: reusableFixture.profile.descriptor.id,
      },
      packet,
    },
    generationSettings: {
      normalizedParameters: reusableFixture.generationSettings.normalizedParameters,
      seed: reusableFixture.generationSettings.seed,
      determinism: reusableFixture.generationSettings.determinism,
    },
    timing: {
      startedAt: '2026-08-05T00:00:00.000Z',
      completedAt: '2026-08-05T00:00:01.000Z',
    },
    outcome: {
      status: 'failed',
      operation: 'local_replan',
      error: {
        error: 'planner_provider_failed',
        requestId: generationRequestId,
        message: 'Intentional synthetic failure after capturing the immutable request.',
        retryMode: 'never',
      },
    },
    sourceEvents: [],
    artifacts: [],
    reproducibility: 'reproducible',
    provenance: reusableFixture.provenance,
    dataHandling: reusableFixture.dataHandling,
  });
}

async function writeDataset(
  directory: string,
  suite: HumanEvalSuite,
  run: ProviderEvalRun,
  exactPlanJson: string,
  decoyPlanJson: string,
): Promise<void> {
  await mkdir(join(directory, 'runs'), { recursive: true });
  await Promise.all([
    writeFile(join(directory, 'suite.json'), JSON.stringify(suite)),
    writeFile(join(directory, 'runs', `${run.runId}.run.json`), JSON.stringify(run)),
    writeFile(join(directory, 'base-plan.json'), exactPlanJson),
    writeFile(join(directory, 'decoy-plan.json'), decoyPlanJson),
  ]);
}

describe('local-replan base Plan evidence', () => {
  it('accepts the immutable Plan from the exact artifact declared by case.basePlan.artifactId', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'operatingline-replan-evidence-'));
    try {
      const basePlanJson = await readFile(
        resolve('protocol/fixtures/v1/snowman.plan.json'),
        'utf8',
      );
      const basePlan = guidePlanSchema.parse(JSON.parse(basePlanJson) as unknown);
      const suite = suiteWithLocalPlanArtifacts(await publicSuite(), basePlanJson, basePlanJson);
      const run = buildLocalReplanRun(suite, basePlan);
      await writeDataset(directory, suite, run, basePlanJson, basePlanJson);

      await expect(
        loadHumanEvalDatasetDirectory(directory, { artifactRoots: { repo: resolve('.') } }),
      ).resolves.toMatchObject({ verificationLevel: 'artifact_verified' });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('rejects a changed exact artifact even when another guide_plan contains the immutable Plan', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'operatingline-replan-evidence-'));
    try {
      const basePlanJson = await readFile(
        resolve('protocol/fixtures/v1/snowman.plan.json'),
        'utf8',
      );
      const basePlan = guidePlanSchema.parse(JSON.parse(basePlanJson) as unknown);
      const changedPlan = structuredClone(basePlan);
      changedPlan.title = `${changedPlan.title} (tampered)`;
      const changedPlanJson = JSON.stringify(guidePlanSchema.parse(changedPlan));
      const suite = suiteWithLocalPlanArtifacts(await publicSuite(), changedPlanJson, basePlanJson);
      const run = buildLocalReplanRun(suite, basePlan);
      await writeDataset(directory, suite, run, changedPlanJson, basePlanJson);

      await expect(
        loadHumanEvalDatasetDirectory(directory, { artifactRoots: { repo: resolve('.') } }),
      ).rejects.toMatchObject<HumanEvalDatasetError>({
        issues: [expect.stringContaining('does not match its exact immutable base Plan')],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('verifies the declared immutable base Plan even before any local-replan run exists', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'operatingline-replan-evidence-'));
    try {
      const basePlanJson = await readFile(
        resolve('protocol/fixtures/v1/snowman.plan.json'),
        'utf8',
      );
      const basePlan = guidePlanSchema.parse(JSON.parse(basePlanJson) as unknown);
      const changedPlan = structuredClone(basePlan);
      changedPlan.title = `${changedPlan.title} (tampered before collection)`;
      const changedPlanJson = JSON.stringify(guidePlanSchema.parse(changedPlan));
      const suite = suiteWithLocalPlanArtifacts(await publicSuite(), changedPlanJson, basePlanJson);
      await Promise.all([
        writeFile(join(directory, 'suite.json'), JSON.stringify(suite)),
        writeFile(join(directory, 'base-plan.json'), changedPlanJson),
        writeFile(join(directory, 'decoy-plan.json'), basePlanJson),
      ]);

      await expect(
        loadHumanEvalDatasetDirectory(directory, { artifactRoots: { repo: resolve('.') } }),
      ).rejects.toMatchObject<HumanEvalDatasetError>({
        issues: [expect.stringContaining('does not match its exact immutable base Plan')],
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
