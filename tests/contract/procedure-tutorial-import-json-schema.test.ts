import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import {
  procedureAuthoringPromptPacketSchema,
  procedureTutorialTranscriptImportRequestSchema,
} from '@operatingline/protocol';

import { buildProcedureTutorialTranscriptPromptPacket } from '../../services/orchestrator/src/procedure-tutorial-transcript-import.js';
import { validatePublicJsonSchemaCases } from '../../services/orchestrator/test-support/public-json-schema-validator.js';

function publicSchema(filename: string): object {
  return JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as object;
}

const request = {
  formatVersion: '1.0.0',
  targetAdapterId: 'blender',
  actionCatalogVersion: blenderActionCatalog.catalogVersion,
  interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
  goal: 'Create an eye from a supplied caption document.',
  treeId: 'contract.tutorial.caption.eye',
  revision: 1,
  locale: 'en',
  tutorial: {
    video: {
      uri: 'https://www.youtube.com/watch?v=contract-caption-eye',
      title: 'Contract caption import fixture',
      durationMs: 10_000,
      rightsStatus: 'license_verified',
      license: 'CC-BY-4.0',
    },
    captionDocument: {
      origin: 'user_supplied',
      format: 'srt',
      content: '1\n00:00:01,000 --> 00:00:04,000\nAdd a UV sphere.\n',
      locale: 'en',
      defaultConfidence: 0.95,
    },
  },
} as const;

describe('public procedure tutorial transcript import JSON Schema', () => {
  it('matches the strict user-supplied caption document request contract', async () => {
    const cases = [
      { value: request, accepted: true },
      { value: { ...request, formatVersion: '2.0.0' }, accepted: false },
      {
        value: {
          ...request,
          tutorial: {
            ...request.tutorial,
            captionDocument: { ...request.tutorial.captionDocument, content: '   ' },
          },
        },
        accepted: false,
      },
      {
        value: {
          ...request,
          tutorial: {
            ...request.tutorial,
            captionDocument: {
              ...request.tutorial.captionDocument,
              origin: 'downloaded',
            },
          },
        },
        accepted: false,
      },
      {
        value: {
          ...request,
          tutorial: {
            ...request.tutorial,
            captionDocument: { ...request.tutorial.captionDocument, format: 'txt' },
          },
        },
        accepted: false,
      },
      {
        value: {
          ...request,
          tutorial: {
            ...request.tutorial,
            captionDocument: {
              ...request.tutorial.captionDocument,
              defaultConfidence: 1.1,
            },
          },
        },
        accepted: false,
      },
      {
        value: {
          ...request,
          tutorial: {
            ...request.tutorial,
            video: { ...request.tutorial.video, uri: 'http://example.com/tutorial' },
          },
        },
        accepted: false,
      },
      { value: { ...request, fetchVideo: true }, accepted: false },
    ] as const;

    for (const contractCase of cases) {
      expect(
        procedureTutorialTranscriptImportRequestSchema.safeParse(contractCase.value).success,
      ).toBe(contractCase.accepted);
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-tutorial-transcript-import-request.schema.json'),
      cases,
    );
  });

  it('binds packet 1.2.0 exclusively to transcript document provenance', async () => {
    const packet = buildProcedureTutorialTranscriptPromptPacket(
      request,
      blenderActionCatalog,
      blenderInteractionCatalog,
    );
    const wrongVersion = { ...packet, formatVersion: '1.1.0' };
    const missingDocument = structuredClone(packet);
    delete missingDocument.context.tutorialProvenance?.transcript.document;
    delete missingDocument.context.constraints.tutorialTranscriptDocumentBound;

    const cases = [
      { value: packet, accepted: true },
      { value: wrongVersion, accepted: false },
      { value: missingDocument, accepted: false },
    ] as const;
    for (const contractCase of cases) {
      expect(procedureAuthoringPromptPacketSchema.safeParse(contractCase.value).success).toBe(
        contractCase.accepted,
      );
    }
    await validatePublicJsonSchemaCases(
      publicSchema('procedure-authoring-prompt-packet.schema.json'),
      cases,
    );
  });
});
