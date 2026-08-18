import { createHash } from 'node:crypto';

import {
  procedureAuthoringPromptRequestSchema,
  procedureAuthoringTutorialTranscriptDocumentSchema,
  procedureTutorialTranscriptDocumentMaxBytes,
  procedureTutorialTranscriptImportRequestSchema,
  type ActionCatalog,
  type InteractionCatalog,
  type ProcedureAuthoringPromptPacket,
  type ProcedureAuthoringPromptRequest,
  type ProcedureAuthoringTutorialTranscriptDocument,
  type ProcedureTutorialTranscriptImportRequest,
} from '@operatingline/protocol';

import { buildProcedureAuthoringPromptPacket } from './procedure-authoring-prompt.js';

interface ParsedCaptionCue {
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
}

function hasInvalidCaptionControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (
      codePoint !== undefined &&
      (codePoint <= 8 ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127)
    ) {
      return true;
    }
  }
  return false;
}

export interface ParsedProcedureTutorialTranscriptImport {
  readonly request: ProcedureAuthoringPromptRequest;
  readonly document: ProcedureAuthoringTutorialTranscriptDocument;
}

function normalizedCaptionSource(content: string): string {
  const withoutBom = content.startsWith('\uFEFF') ? content.slice(1) : content;
  return withoutBom.replace(/\r\n?/g, '\n');
}

function captionBlocks(content: string): string[][] {
  return content
    .split(/\n[\t ]*\n+/)
    .map((block) => block.split('\n').map((line) => line.trimEnd()))
    .filter((lines) => lines.some((line) => line.trim().length > 0));
}

function stripCaptionTags(value: string): string {
  let result = '';
  let inTag = false;
  for (const character of value) {
    if (character === '<') {
      inTag = true;
    } else if (character === '>' && inTag) {
      inTag = false;
    } else if (!inTag) {
      result += character;
    }
  }
  return result;
}

function decodeCaptionEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  };
  return value.replace(/&(#(?:x[0-9a-fA-F]+|\d+)|amp|apos|gt|lt|nbsp|quot);/g, (match, key) => {
    if (typeof key !== 'string') return match;
    if (!key.startsWith('#')) return named[key] ?? match;
    const hexadecimal = key.startsWith('#x');
    const codePoint = Number.parseInt(key.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return match;
    try {
      return String.fromCodePoint(codePoint);
    } catch {
      return match;
    }
  });
}

function normalizedCaptionText(lines: readonly string[]): string {
  const text = decodeCaptionEntities(stripCaptionTags(lines.join('\n')))
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
  if (hasInvalidCaptionControlCharacter(text)) {
    throw new Error('Caption cue text contains an unsupported control character');
  }
  if (!/\S/.test(text)) {
    throw new Error('Caption cue text must contain a visible character');
  }
  return text;
}

function timestampMilliseconds(
  token: string,
  decimalSeparator: '.' | ',',
  hoursRequired: boolean,
): number {
  const components = token.split(':');
  if ((hoursRequired && components.length !== 3) || (!hoursRequired && components.length < 2)) {
    throw new Error('Invalid caption timestamp');
  }
  if (components.length !== 2 && components.length !== 3) {
    throw new Error('Invalid caption timestamp');
  }
  const hoursToken = components.length === 3 ? components[0]! : '00';
  const minutesToken = components.length === 3 ? components[1]! : components[0]!;
  const secondsToken = components.at(-1)!;
  if (!/^\d{2,}$/.test(hoursToken) || !/^\d{2}$/.test(minutesToken)) {
    throw new Error('Invalid caption timestamp');
  }
  const escapedSeparator = decimalSeparator === '.' ? '\\.' : ',';
  const secondsMatch = new RegExp(`^(\\d{2})${escapedSeparator}(\\d{3})$`).exec(secondsToken);
  if (secondsMatch === null) {
    throw new Error('Invalid caption timestamp');
  }
  const hours = Number(hoursToken);
  const minutes = Number(minutesToken);
  const seconds = Number(secondsMatch[1]);
  const milliseconds = Number(secondsMatch[2]);
  if (minutes > 59 || seconds > 59) {
    throw new Error('Invalid caption timestamp');
  }
  const result = ((hours * 60 + minutes) * 60 + seconds) * 1_000 + milliseconds;
  if (!Number.isSafeInteger(result)) {
    throw new Error('Caption timestamp exceeds the supported range');
  }
  return result;
}

function timingRange(
  line: string,
  format: 'webvtt' | 'srt',
): { readonly startMs: number; readonly endMs: number } {
  const parts = line.trim().split(/[\t ]+-->[\t ]+/);
  if (parts.length !== 2) {
    throw new Error(`Invalid ${format} cue timing line`);
  }
  const startToken = parts[0]!.trim();
  const endToken = parts[1]!.trim().split(/[\t ]+/)[0];
  if (endToken === undefined || endToken.length === 0) {
    throw new Error(`Invalid ${format} cue end timestamp`);
  }
  return format === 'srt'
    ? {
        startMs: timestampMilliseconds(startToken, ',', true),
        endMs: timestampMilliseconds(endToken, ',', true),
      }
    : {
        startMs: timestampMilliseconds(startToken, '.', false),
        endMs: timestampMilliseconds(endToken, '.', false),
      };
}

function parseSrt(content: string): ParsedCaptionCue[] {
  const cues: ParsedCaptionCue[] = [];
  let previousCueNumber = -1;
  for (const lines of captionBlocks(content)) {
    const cueNumberToken = lines[0]?.trim() ?? '';
    if (!/^\d+$/.test(cueNumberToken)) {
      throw new Error('SRT cue must begin with a numeric identifier');
    }
    const cueNumber = Number(cueNumberToken);
    if (!Number.isSafeInteger(cueNumber) || cueNumber <= 0 || cueNumber <= previousCueNumber) {
      throw new Error('SRT cue identifiers must be positive and strictly increasing');
    }
    previousCueNumber = cueNumber;
    const timingLine = lines[1];
    if (timingLine === undefined) throw new Error('SRT cue is missing its timing line');
    const range = timingRange(timingLine, 'srt');
    cues.push({ ...range, text: normalizedCaptionText(lines.slice(2)) });
  }
  return cues;
}

function parseWebVtt(content: string): ParsedCaptionCue[] {
  const lines = content.split('\n');
  const header = lines[0]?.trimEnd() ?? '';
  if (!/^WEBVTT(?:[\t ].*)?$/.test(header)) {
    throw new Error('WebVTT document must begin with a WEBVTT header');
  }
  let cursor = 1;
  while (cursor < lines.length && lines[cursor]!.trim().length > 0) cursor += 1;
  if (cursor >= lines.length) {
    throw new Error('WebVTT header must be followed by a blank line and at least one cue');
  }
  while (cursor < lines.length && lines[cursor]!.trim().length === 0) cursor += 1;
  const cues: ParsedCaptionCue[] = [];
  for (const block of captionBlocks(lines.slice(cursor).join('\n'))) {
    const first = block[0]?.trim() ?? '';
    if (/^(?:NOTE(?:[\t ].*)?|STYLE|REGION)$/.test(first)) continue;
    const timingIndex = block.findIndex((line) => line.includes('-->'));
    if (timingIndex < 0 || timingIndex > 1) {
      throw new Error('WebVTT cue must contain a timing line after at most one identifier');
    }
    const range = timingRange(block[timingIndex]!, 'webvtt');
    cues.push({ ...range, text: normalizedCaptionText(block.slice(timingIndex + 1)) });
  }
  return cues;
}

export function parseProcedureTutorialTranscriptImport(
  requestInput: ProcedureTutorialTranscriptImportRequest,
): ParsedProcedureTutorialTranscriptImport {
  const importRequest = procedureTutorialTranscriptImportRequestSchema.parse(requestInput);
  const contentBytes = Buffer.byteLength(importRequest.tutorial.captionDocument.content, 'utf8');
  if (contentBytes > procedureTutorialTranscriptDocumentMaxBytes) {
    throw new Error(
      `Tutorial transcript document exceeds ${procedureTutorialTranscriptDocumentMaxBytes} UTF-8 bytes`,
    );
  }
  const normalizedSource = normalizedCaptionSource(importRequest.tutorial.captionDocument.content);
  if (hasInvalidCaptionControlCharacter(normalizedSource)) {
    throw new Error('Tutorial transcript document contains an unsupported control character');
  }
  const cues =
    importRequest.tutorial.captionDocument.format === 'srt'
      ? parseSrt(normalizedSource)
      : parseWebVtt(normalizedSource);
  if (cues.length === 0) {
    throw new Error('Tutorial transcript document contains no caption cues');
  }
  const document = procedureAuthoringTutorialTranscriptDocumentSchema.parse({
    format: importRequest.tutorial.captionDocument.format,
    contentSha256: createHash('sha256')
      .update(importRequest.tutorial.captionDocument.content, 'utf8')
      .digest('hex'),
    contentBytes,
    cueCount: cues.length,
    normalization: 'operatingline-caption-cues-v1',
    confidence: {
      origin: 'user_declared_default',
      value: importRequest.tutorial.captionDocument.defaultConfidence,
    },
  });
  const request = procedureAuthoringPromptRequestSchema.parse({
    targetAdapterId: importRequest.targetAdapterId,
    ...(importRequest.actionCatalogVersion === undefined
      ? {}
      : { actionCatalogVersion: importRequest.actionCatalogVersion }),
    ...(importRequest.interactionCatalogVersion === undefined
      ? {}
      : { interactionCatalogVersion: importRequest.interactionCatalogVersion }),
    goal: importRequest.goal,
    treeId: importRequest.treeId,
    revision: importRequest.revision,
    ...(importRequest.locale === undefined ? {} : { locale: importRequest.locale }),
    tutorial: {
      video: importRequest.tutorial.video,
      transcript: {
        origin: importRequest.tutorial.captionDocument.origin,
        ...(importRequest.tutorial.captionDocument.locale === undefined
          ? {}
          : { locale: importRequest.tutorial.captionDocument.locale }),
        segments: cues.map((cue) => ({
          ...cue,
          confidence: importRequest.tutorial.captionDocument.defaultConfidence,
        })),
      },
    },
  });
  return { request, document };
}

export function buildProcedureTutorialTranscriptPromptPacket(
  requestInput: ProcedureTutorialTranscriptImportRequest,
  actionCatalog: ActionCatalog,
  interactionCatalog: InteractionCatalog,
): ProcedureAuthoringPromptPacket {
  const parsed = parseProcedureTutorialTranscriptImport(requestInput);
  return buildProcedureAuthoringPromptPacket(parsed.request, actionCatalog, interactionCatalog, {
    tutorialTranscriptDocument: parsed.document,
  });
}
