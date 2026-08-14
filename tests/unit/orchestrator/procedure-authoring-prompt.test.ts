import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  canonicalizeProtocolJsonValue,
  parseProcedureTree,
  procedureAuthoringPromptPacketMaxCanonicalBytes,
} from '@operatingline/protocol';

import {
  buildProcedureAuthoringPromptPacket,
  computeProcedureAuthoringPromptPacketContentSha256,
  procedureAuthoringPromptPacketContent,
  validateProcedureAuthoringPromptPacketIntegrity,
} from '../../../services/orchestrator/src/procedure-authoring-prompt.js';
import { validatePublicJsonSchemaCases } from '../../../services/orchestrator/test-support/public-json-schema-validator.js';

function fixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(resolve('protocol/fixtures/v1/snowman-eye.procedure.json'), 'utf8'),
  ) as Record<string, unknown>;
}

function forceInteractionTracksUnavailable(tree: Record<string, unknown>): void {
  for (const node of tree['nodes'] as Array<Record<string, unknown>>) {
    if (node['kind'] !== 'leaf') continue;
    const leafId = String(node['id']);
    node['menuTracks'] = [
      {
        id: `${leafId}.menu.unavailable`,
        availability: 'unavailable',
        title: 'Menu grounding pending',
        reason: 'A deterministic grounding stage has not materialized this track.',
        modality: 'menu',
      },
    ];
    node['shortcutTracks'] = [
      {
        id: `${leafId}.shortcut.unavailable`,
        availability: 'unavailable',
        title: 'Shortcut grounding pending',
        reason: 'A deterministic grounding stage has not materialized this track.',
        modality: 'shortcut',
      },
    ];
    node['mcpTracks'] = [
      {
        id: `${leafId}.mcp.unavailable`,
        availability: 'unavailable',
        title: 'MCP grounding pending',
        reason: 'A deterministic grounding stage has not materialized this track.',
        modality: 'mcp',
      },
    ];
  }
}

const goal = '制作雪人的头部，并创建、定位、缩放和命名左眼球体。';

describe('procedure authoring prompt', () => {
  it('pins catalogs, identity, candidate validation, and side-effect boundaries', async () => {
    const packet = buildProcedureAuthoringPromptPacket(
      {
        targetAdapterId: 'blender',
        actionCatalogVersion: blenderActionCatalog.catalogVersion,
        interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
        goal,
        treeId: 'snowman.eye.left.procedure',
        revision: 1,
        locale: 'zh-CN',
      },
      blenderActionCatalog,
      blenderInteractionCatalog,
    );

    expect(packet).toMatchObject({
      formatVersion: '1.0.0',
      context: {
        requestedTreeId: 'snowman.eye.left.procedure',
        recommendedRevision: 1,
        goalProvenance: {
          source: {
            id: 'source.snowman.eye.left.procedure.revision.1.goal',
            kind: 'natural_language',
            text: goal,
            locale: 'zh-CN',
          },
          evidence: {
            id: 'evidence.snowman.eye.left.procedure.revision.1.goal',
            confidence: 1,
          },
        },
        catalogBinding: {
          adapterId: 'blender',
          actionCatalog: { catalogVersion: blenderActionCatalog.catalogVersion },
          interactionCatalog: { catalogVersion: blenderInteractionCatalog.catalogVersion },
        },
        constraints: {
          allGeneratedLeavesCandidate: true,
          validatedHostVersionsEmpty: true,
          exactParametersRemainOnSemanticOperations: true,
          allInteractionTracksUnavailable: true,
          persistenceRequiresExplicitStore: true,
        },
      },
      retrieval: {
        toolName: 'operatingline.procedure.search',
        matching: 'exact_structured_filters',
        similarityScoreProduced: false,
      },
      workflow: {
        validationToolName: 'operatingline.procedure.authoring.validate',
        compileToolName: 'operatingline.procedure.compile',
      },
      limits: { maxCanonicalBytes: procedureAuthoringPromptPacketMaxCanonicalBytes },
      sideEffects: {
        modelCalled: false,
        procedureStored: false,
        proposalCreated: false,
        hostExecutionStarted: false,
      },
    });
    expect(packet).not.toHaveProperty('renderedPrompt');
    expect(packet.integrity.contentSha256).toBe(
      computeProcedureAuthoringPromptPacketContentSha256(
        procedureAuthoringPromptPacketContent(packet),
      ),
    );
    expect(canonicalizeProtocolJsonValue(packet).byteLength).toBeLessThanOrEqual(
      procedureAuthoringPromptPacketMaxCanonicalBytes,
    );
    expect(validateProcedureAuthoringPromptPacketIntegrity(packet)).toEqual(packet);
    const tamperedPacket = structuredClone(packet);
    tamperedPacket.context.goalProvenance.source.text = 'Tampered after sealing.';
    expect(() => validateProcedureAuthoringPromptPacketIntegrity(tamperedPacket)).toThrow(
      'integrity check failed',
    );

    const valid = fixture();
    forceInteractionTracksUnavailable(valid);
    const goalSource = packet.context.goalProvenance.source;
    const goalEvidence = {
      ...packet.context.goalProvenance.evidence,
      sourceId: goalSource.id,
    };
    valid['sources'] = [...(valid['sources'] as Array<Record<string, unknown>>), goalSource];
    valid['evidence'] = [...(valid['evidence'] as Array<Record<string, unknown>>), goalEvidence];
    const selfVerified = structuredClone(valid);
    const verifiedLeaf = (selfVerified['nodes'] as Array<Record<string, unknown>>).find(
      (node) => node['kind'] === 'leaf',
    );
    if (verifiedLeaf === undefined) throw new Error('Expected candidate fixture leaf');
    verifiedLeaf['validation'] = {
      status: 'verified',
      validatedHostVersions: ['4.5.3'],
      notes: ['Model asserted verification without a host replay.'],
    };
    const changedIdentity = { ...valid, id: 'different.procedure' };
    const changedSource = structuredClone(valid);
    (changedSource['sources'] as Array<Record<string, unknown>>).find(
      (source) => source['id'] === goalSource.id,
    )!['text'] = 'different goal';
    const availableTrack = fixture();
    availableTrack['sources'] = valid['sources'];
    availableTrack['evidence'] = valid['evidence'];
    const blankAdditionalSource = structuredClone(valid);
    (blankAdditionalSource['sources'] as Array<Record<string, unknown>>).push({
      id: 'source.blank',
      kind: 'natural_language',
      text: '   ',
    });
    const spacedAdditionalSource = structuredClone(valid);
    (spacedAdditionalSource['sources'] as Array<Record<string, unknown>>).push({
      id: 'source.spaced',
      kind: 'natural_language',
      text: '  Preserve these spaces.  ',
    });

    await validatePublicJsonSchemaCases(packet.responseContract.schema, [
      { value: valid, accepted: true },
      { value: availableTrack, accepted: false },
      { value: blankAdditionalSource, accepted: false },
      { value: spacedAdditionalSource, accepted: true },
      { value: selfVerified, accepted: false },
      { value: changedIdentity, accepted: false },
      { value: changedSource, accepted: false },
    ]);
  });

  it('preserves leading and trailing goal whitespace as exact provenance', () => {
    const exactGoal = '  Create an eye sphere without rewriting this text.  ';
    const packet = buildProcedureAuthoringPromptPacket(
      {
        targetAdapterId: 'blender',
        goal: exactGoal,
        treeId: 'exact.goal.procedure',
        revision: 2,
      },
      blenderActionCatalog,
      blenderInteractionCatalog,
    );

    expect(packet.context.goalProvenance.source.text).toBe(exactGoal);
  });

  it('rejects mismatched ActionCatalog and InteractionCatalog identities', () => {
    expect(() =>
      buildProcedureAuthoringPromptPacket(
        {
          targetAdapterId: 'other-host',
          goal: 'Create an object.',
          treeId: 'other.procedure',
          revision: 1,
        },
        blenderActionCatalog,
        blenderInteractionCatalog,
      ),
    ).toThrow('ActionCatalog does not match');

    const invalidAdapterRange = structuredClone(blenderInteractionCatalog);
    invalidAdapterRange.adapterVersionRange = '>=9.0.0 <10.0.0';
    expect(() =>
      buildProcedureAuthoringPromptPacket(
        {
          targetAdapterId: 'blender',
          goal: 'Create an object.',
          treeId: 'other.procedure',
          revision: 1,
        },
        blenderActionCatalog,
        invalidAdapterRange,
      ),
    ).toThrow('adapter range exceeds');
  });

  it('fails closed when a self-contained packet exceeds its canonical byte budget', () => {
    const oversizedActionCatalog = structuredClone(blenderActionCatalog);
    oversizedActionCatalog.description = '界🙂'.repeat(
      procedureAuthoringPromptPacketMaxCanonicalBytes / 2,
    );

    expect(() =>
      buildProcedureAuthoringPromptPacket(
        {
          targetAdapterId: 'blender',
          goal: 'Create an object.',
          treeId: 'oversized.procedure',
          revision: 1,
        },
        oversizedActionCatalog,
        blenderInteractionCatalog,
      ),
    ).toThrow(`exceeds ${procedureAuthoringPromptPacketMaxCanonicalBytes} canonical bytes`);
  });

  it('namespaces goal provenance so verified operations can retain another tree source', () => {
    const currentPacket = buildProcedureAuthoringPromptPacket(
      {
        targetAdapterId: 'blender',
        goal,
        treeId: 'snowman.eye.left.procedure',
        revision: 1,
      },
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const libraryPacket = buildProcedureAuthoringPromptPacket(
      {
        targetAdapterId: 'blender',
        goal: 'Create a reusable eye sphere.',
        treeId: 'library.eye.sphere',
        revision: 3,
      },
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    expect(currentPacket.context.goalProvenance.source.id).not.toBe(
      libraryPacket.context.goalProvenance.source.id,
    );
    expect(currentPacket.context.goalProvenance.evidence.id).not.toBe(
      libraryPacket.context.goalProvenance.evidence.id,
    );

    const candidate = fixture();
    forceInteractionTracksUnavailable(candidate);
    const currentSource = currentPacket.context.goalProvenance.source;
    const librarySource = libraryPacket.context.goalProvenance.source;
    const currentEvidence = {
      ...currentPacket.context.goalProvenance.evidence,
      sourceId: currentSource.id,
    };
    const libraryEvidence = {
      ...libraryPacket.context.goalProvenance.evidence,
      sourceId: librarySource.id,
    };
    candidate['sources'] = [
      ...(candidate['sources'] as Array<Record<string, unknown>>),
      currentSource,
      librarySource,
    ];
    candidate['evidence'] = [
      ...(candidate['evidence'] as Array<Record<string, unknown>>),
      currentEvidence,
      libraryEvidence,
    ];
    const leaf = (candidate['nodes'] as Array<Record<string, unknown>>).find(
      (node) => node['kind'] === 'leaf',
    );
    if (leaf === undefined) throw new Error('Expected procedure leaf');
    const semanticOperation = (leaf['semanticOperations'] as Array<Record<string, unknown>>)[0]!;
    semanticOperation['evidenceRefs'] = [
      ...(semanticOperation['evidenceRefs'] as string[]),
      libraryEvidence.id,
    ];

    expect(() => parseProcedureTree(candidate)).not.toThrow();
  });
});
