import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalog,
  blenderInteractionCatalog,
} from '@operatingline/blender-action-catalog';
import type { ProcedureTutorialTranscriptImportRequest } from '@operatingline/protocol';

import {
  buildProcedureTutorialTranscriptPromptPacket,
  parseProcedureTutorialTranscriptImport,
} from '../../../services/orchestrator/src/procedure-tutorial-transcript-import.js';
import { buildProcedureAuthoringPromptPacket } from '../../../services/orchestrator/src/procedure-authoring-prompt.js';

function request(
  content: string,
  format: 'webvtt' | 'srt' = 'srt',
): ProcedureTutorialTranscriptImportRequest {
  return {
    formatVersion: '1.0.0',
    targetAdapterId: 'blender',
    actionCatalogVersion: blenderActionCatalog.catalogVersion,
    interactionCatalogVersion: blenderInteractionCatalog.catalogVersion,
    goal: 'Create and position an eye from the supplied tutorial captions.',
    treeId: 'tutorial.caption.eye.procedure',
    revision: 1,
    locale: 'en',
    tutorial: {
      video: {
        uri: 'https://www.youtube.com/watch?v=caption-eye',
        title: 'Caption import fixture',
        durationMs: 20_000,
        rightsStatus: 'permission_granted',
      },
      captionDocument: {
        origin: 'user_supplied',
        format,
        content,
        locale: 'en',
        defaultConfidence: 0.91,
      },
    },
  };
}

describe('procedure tutorial transcript import', () => {
  it('parses exact SRT bytes into a document-bound authoring packet', () => {
    const content =
      '\uFEFF1\r\n00:00:01,000 --> 00:00:04,500\r\nAdd a <b>UV sphere</b> &amp; set its radius.\r\n\r\n2\r\n00:00:05,000 --> 00:00:09,250\r\nMove it to the eye position.\r\n';
    const packet = buildProcedureTutorialTranscriptPromptPacket(
      request(content),
      blenderActionCatalog,
      blenderInteractionCatalog,
    );

    expect(packet.formatVersion).toBe('1.2.0');
    expect(packet.context.constraints.tutorialTranscriptDocumentBound).toBe(true);
    expect(packet.context.tutorialProvenance?.transcript).toMatchObject({
      origin: 'user_supplied',
      locale: 'en',
      document: {
        format: 'srt',
        contentSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
        contentBytes: Buffer.byteLength(content, 'utf8'),
        cueCount: 2,
        normalization: 'operatingline-caption-cues-v1',
        confidence: { origin: 'user_declared_default', value: 0.91 },
      },
      segments: [
        {
          order: 1,
          locator: { kind: 'video_segment', startMs: 1_000, endMs: 4_500 },
          text: 'Add a UV sphere & set its radius.',
          confidence: 0.91,
        },
        {
          order: 2,
          locator: { kind: 'video_segment', startMs: 5_000, endMs: 9_250 },
          text: 'Move it to the eye position.',
          confidence: 0.91,
        },
      ],
    });
    expect(packet.workflow.instructions.join('\n')).toContain('exact caption document digest');
  });

  it('parses WebVTT cue identifiers, settings, notes, tags, and entities', () => {
    const content = `WEBVTT Tutorial captions

NOTE generated metadata
This block is not a cue.

eye-create
00:01.000 --> 00:04.000 align:start position:0%
<v Instructor>Add the sphere</v> &lt;now&gt;.

00:05.250 --> 00:07.000
Name it Eye&#46;L.
`;
    const parsed = parseProcedureTutorialTranscriptImport(request(content, 'webvtt'));

    expect(parsed.document).toMatchObject({ format: 'webvtt', cueCount: 2 });
    expect(parsed.request.tutorial?.transcript.segments).toEqual([
      {
        startMs: 1_000,
        endMs: 4_000,
        text: 'Add the sphere <now>.',
        confidence: 0.91,
      },
      {
        startMs: 5_250,
        endMs: 7_000,
        text: 'Name it Eye.L.',
        confidence: 0.91,
      },
    ]);
  });

  it('rejects malformed, overlapping, out-of-range, and oversized caption input', () => {
    expect(() =>
      parseProcedureTutorialTranscriptImport(
        request('1\n00:00:01.000 --> 00:00:02.000\nWrong SRT separator.\n'),
      ),
    ).toThrow('Invalid caption timestamp');

    expect(() =>
      parseProcedureTutorialTranscriptImport(
        request(
          '1\n00:00:01,000 --> 00:00:05,000\nFirst cue.\n\n2\n00:00:04,000 --> 00:00:06,000\nOverlapping cue.\n',
        ),
      ),
    ).toThrow();

    expect(() =>
      parseProcedureTutorialTranscriptImport(
        request('1\n00:00:19,000 --> 00:00:21,000\nPast the video duration.\n'),
      ),
    ).toThrow();

    expect(() =>
      parseProcedureTutorialTranscriptImport(
        request('0\n00:00:01,000 --> 00:00:02,000\nInvalid identifier.\n'),
      ),
    ).toThrow('positive and strictly increasing');

    expect(() =>
      parseProcedureTutorialTranscriptImport(request('WEBVTT\n\nNOTE only metadata\n', 'webvtt')),
    ).toThrow('contains no caption cues');

    expect(() => parseProcedureTutorialTranscriptImport(request('界'.repeat(100_000)))).toThrow(
      'exceeds 262144 UTF-8 bytes',
    );

    expect(() =>
      parseProcedureTutorialTranscriptImport(
        request('1\n00:00:01,000 --> 00:00:02,000\nInvalid\u0000text.\n'),
      ),
    ).toThrow('unsupported control character');
  });

  it('rejects document metadata that drifts from its normalized segments', () => {
    const parsed = parseProcedureTutorialTranscriptImport(
      request('1\n00:00:01,000 --> 00:00:04,000\nAdd a sphere.\n'),
    );

    expect(() =>
      buildProcedureAuthoringPromptPacket(
        parsed.request,
        blenderActionCatalog,
        blenderInteractionCatalog,
        {
          tutorialTranscriptDocument: {
            ...parsed.document,
            cueCount: parsed.document.cueCount + 1,
          },
        },
      ),
    ).toThrow('cue count does not match');

    expect(() =>
      buildProcedureAuthoringPromptPacket(
        parsed.request,
        blenderActionCatalog,
        blenderInteractionCatalog,
        {
          tutorialTranscriptDocument: {
            ...parsed.document,
            confidence: { ...parsed.document.confidence, value: 0.5 },
          },
        },
      ),
    ).toThrow('confidence does not match');
  });
});
