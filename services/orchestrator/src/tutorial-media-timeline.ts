import { createHash } from 'node:crypto';

export type TutorialMediaTimelineErrorCode = 'invalid_input' | 'segmentation_failed';

export class TutorialMediaTimelineError extends Error {
  constructor(readonly code: TutorialMediaTimelineErrorCode) {
    super(
      code === 'invalid_input'
        ? 'The tutorial timeline input is invalid.'
        : 'Tutorial timeline segmentation failed.',
    );
    this.name = 'TutorialMediaTimelineError';
  }
}

export interface TutorialTimelineAsrSegment {
  readonly segmentId: string;
  readonly startMs: number;
  readonly endMs: number;
  readonly text: string;
  readonly confidence?: number | null;
}

export interface TutorialTimelineFrame {
  readonly frameId: string;
  readonly timestampMs: number;
  readonly artifactUri: string;
}

export interface TutorialTimelineVisualCandidate {
  readonly candidateId: string;
  readonly frameId: string;
}

export interface TutorialTimelineShortcutCandidate extends TutorialTimelineVisualCandidate {
  readonly timestampMs: number;
  readonly keys: readonly string[];
  readonly confidence: number;
}

export interface TutorialTimelineSemanticSegment {
  readonly segmentId: string;
  readonly order: number;
  readonly startMs: number;
  readonly endMs: number;
  readonly canonicalDescription: string;
  readonly confidence: number;
  readonly asrSegmentIds: readonly string[];
  readonly ocrCandidateIds: readonly string[];
  readonly uiCandidateIds: readonly string[];
  readonly shortcutCandidateIds: readonly string[];
  readonly evidence: readonly {
    readonly artifactUri: string;
    readonly frameId?: string;
    readonly timestampMs: number;
  }[];
}

export interface TutorialTimelineSegmentationInput {
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly asrSegments: readonly TutorialTimelineAsrSegment[];
  readonly frames: readonly TutorialTimelineFrame[];
  readonly ocrCandidates?: readonly TutorialTimelineVisualCandidate[];
  readonly uiCandidates?: readonly TutorialTimelineVisualCandidate[];
  readonly shortcutCandidates?: readonly TutorialTimelineShortcutCandidate[];
  readonly transcriptArtifactUri?: string;
  readonly gapThresholdMs?: number;
  readonly maximumSegmentDurationMs?: number;
}

function stableUuid(parts: readonly (string | number)[]): string {
  const hex = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function millisecond(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= 86_400_000;
}

function sentenceEnd(text: string): boolean {
  return /[.!?。！？]\s*$/u.test(text);
}

function unique<Value>(values: readonly Value[]): Value[] {
  return [...new Set(values)];
}

function validateOrderedInput(input: TutorialTimelineSegmentationInput): void {
  if (
    !millisecond(input.windowStartMs) ||
    !millisecond(input.windowEndMs) ||
    input.windowEndMs <= input.windowStartMs
  ) {
    throw new TutorialMediaTimelineError('invalid_input');
  }
  if (
    input.transcriptArtifactUri !== undefined &&
    !/^operatingline-media:\/\/sha256\/[a-f0-9]{64}$/u.test(input.transcriptArtifactUri)
  ) {
    throw new TutorialMediaTimelineError('invalid_input');
  }
  let previousEnd = input.windowStartMs;
  const ids = new Set<string>();
  for (const segment of input.asrSegments) {
    if (
      ids.has(segment.segmentId) ||
      !millisecond(segment.startMs) ||
      !millisecond(segment.endMs) ||
      segment.startMs < previousEnd ||
      segment.endMs <= segment.startMs ||
      segment.startMs < input.windowStartMs ||
      segment.endMs > input.windowEndMs ||
      segment.text.trim().length === 0 ||
      segment.text.length > 20_000 ||
      (segment.confidence !== undefined &&
        segment.confidence !== null &&
        (!Number.isFinite(segment.confidence) || segment.confidence < 0 || segment.confidence > 1))
    ) {
      throw new TutorialMediaTimelineError('invalid_input');
    }
    ids.add(segment.segmentId);
    previousEnd = segment.endMs;
  }
  let previousFrame = -1;
  const frameIds = new Set<string>();
  for (const frame of input.frames) {
    if (
      !millisecond(frame.timestampMs) ||
      frame.timestampMs <= previousFrame ||
      frame.timestampMs < input.windowStartMs ||
      frame.timestampMs > input.windowEndMs ||
      !/^operatingline-media:\/\/sha256\/[a-f0-9]{64}$/u.test(frame.artifactUri) ||
      frameIds.has(frame.frameId)
    ) {
      throw new TutorialMediaTimelineError('invalid_input');
    }
    frameIds.add(frame.frameId);
    previousFrame = frame.timestampMs;
  }
  for (const candidates of [input.ocrCandidates ?? [], input.uiCandidates ?? []]) {
    const candidateIds = new Set<string>();
    for (const candidate of candidates) {
      if (candidateIds.has(candidate.candidateId) || !frameIds.has(candidate.frameId)) {
        throw new TutorialMediaTimelineError('invalid_input');
      }
      candidateIds.add(candidate.candidateId);
    }
  }
  const shortcutIds = new Set<string>();
  const frameById = new Map(input.frames.map((frame) => [frame.frameId, frame]));
  for (const shortcut of input.shortcutCandidates ?? []) {
    if (
      !millisecond(shortcut.timestampMs) ||
      shortcut.timestampMs < input.windowStartMs ||
      shortcut.timestampMs > input.windowEndMs ||
      shortcut.keys.length === 0 ||
      shortcut.confidence < 0 ||
      shortcut.confidence > 1 ||
      shortcutIds.has(shortcut.candidateId) ||
      !frameIds.has(shortcut.frameId) ||
      frameById.get(shortcut.frameId)?.timestampMs !== shortcut.timestampMs
    ) {
      throw new TutorialMediaTimelineError('invalid_input');
    }
    shortcutIds.add(shortcut.candidateId);
  }
}

/** Deterministic candidate segmentation. It deliberately does not infer Blender actions or menus. */
export function segmentTutorialTimeline(
  input: TutorialTimelineSegmentationInput,
): readonly TutorialTimelineSemanticSegment[] {
  validateOrderedInput(input);
  const gapThresholdMs = input.gapThresholdMs ?? 1_500;
  const maximumDurationMs = input.maximumSegmentDurationMs ?? 30_000;
  if (
    !Number.isSafeInteger(gapThresholdMs) ||
    gapThresholdMs < 0 ||
    !Number.isSafeInteger(maximumDurationMs) ||
    maximumDurationMs <= 0
  ) {
    throw new TutorialMediaTimelineError('invalid_input');
  }

  const groups: TutorialTimelineAsrSegment[][] = [];
  for (const asr of input.asrSegments) {
    const current = groups.at(-1);
    const previous = current?.at(-1);
    const shortcutInGap =
      previous !== undefined &&
      (input.shortcutCandidates ?? []).some(
        (shortcut) => shortcut.timestampMs > previous.endMs && shortcut.timestampMs <= asr.startMs,
      );
    if (
      current === undefined ||
      previous === undefined ||
      asr.startMs - previous.endMs >= gapThresholdMs ||
      sentenceEnd(previous.text) ||
      asr.endMs - current[0]!.startMs > maximumDurationMs ||
      shortcutInGap
    ) {
      if (asr.endMs - asr.startMs > maximumDurationMs) {
        throw new TutorialMediaTimelineError('segmentation_failed');
      }
      groups.push([asr]);
    } else {
      current.push(asr);
    }
  }

  const ranges: { startMs: number; endMs: number; asr: TutorialTimelineAsrSegment[] }[] =
    groups.map((group) => ({ startMs: group[0]!.startMs, endMs: group.at(-1)!.endMs, asr: group }));
  for (const shortcut of input.shortcutCandidates ?? []) {
    if (
      ranges.some(
        (range) => shortcut.timestampMs >= range.startMs && shortcut.timestampMs <= range.endMs,
      )
    ) {
      continue;
    }
    const nextIndex = ranges.findIndex((range) => shortcut.timestampMs < range.startMs);
    const previousRange = nextIndex <= 0 ? undefined : ranges[nextIndex - 1];
    const nextRange = nextIndex === -1 ? undefined : ranges[nextIndex];
    const startMs = Math.max(
      input.windowStartMs,
      previousRange?.endMs ?? input.windowStartMs,
      shortcut.timestampMs - 250,
    );
    const endMs = Math.min(
      input.windowEndMs,
      nextRange?.startMs ?? input.windowEndMs,
      shortcut.timestampMs + 250,
    );
    if (endMs > startMs) ranges.push({ asr: [], endMs, startMs });
  }
  ranges.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.startMs < ranges[index - 1]!.endMs) {
      throw new TutorialMediaTimelineError('segmentation_failed');
    }
  }

  return ranges.map((range, index) => {
    const frames = input.frames.filter(
      (frame) => frame.timestampMs >= range.startMs && frame.timestampMs <= range.endMs,
    );
    const frameIds = new Set(frames.map((frame) => frame.frameId));
    const shortcuts = (input.shortcutCandidates ?? []).filter(
      (candidate) =>
        candidate.timestampMs >= range.startMs &&
        candidate.timestampMs <= range.endMs &&
        frameIds.has(candidate.frameId),
    );
    const ocr = (input.ocrCandidates ?? []).filter((candidate) => frameIds.has(candidate.frameId));
    const ui = (input.uiCandidates ?? []).filter((candidate) => frameIds.has(candidate.frameId));
    const asrText = range.asr
      .map((segment) => segment.text.trim())
      .join(' ')
      .trim();
    const shortcutText = shortcuts.map((candidate) => candidate.keys.join('+')).join(', ');
    const description = (asrText || `Observed shortcut candidate: ${shortcutText}`).slice(0, 4_096);
    const confidences = [
      ...range.asr.flatMap((segment) => segment.confidence ?? []),
      ...shortcuts.map((shortcut) => shortcut.confidence),
    ];
    const confidence =
      confidences.length === 0
        ? 0.5
        : confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
    const evidence: {
      artifactUri: string;
      frameId?: string;
      timestampMs: number;
    }[] = frames.slice(0, 2_000).map((frame) => ({
      artifactUri: frame.artifactUri,
      frameId: frame.frameId,
      timestampMs: frame.timestampMs,
    }));
    if (evidence.length === 0) {
      if (input.transcriptArtifactUri === undefined) {
        throw new TutorialMediaTimelineError('segmentation_failed');
      }
      evidence.push({
        artifactUri: input.transcriptArtifactUri,
        timestampMs: range.startMs,
      });
    }
    return {
      asrSegmentIds: range.asr.map((segment) => segment.segmentId),
      canonicalDescription: description,
      confidence,
      endMs: range.endMs,
      evidence,
      ocrCandidateIds: unique(ocr.map((candidate) => candidate.candidateId)).slice(0, 1_000),
      order: index + 1,
      segmentId: stableUuid([range.startMs, range.endMs, description]),
      shortcutCandidateIds: unique(shortcuts.map((candidate) => candidate.candidateId)).slice(
        0,
        1_000,
      ),
      startMs: range.startMs,
      uiCandidateIds: unique(ui.map((candidate) => candidate.candidateId)).slice(0, 1_000),
    };
  });
}

export interface TutorialFrameTimestampInput {
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly intervalMs: number;
  readonly maximumFrames: number;
  readonly asrSegments?: readonly Pick<TutorialTimelineAsrSegment, 'startMs' | 'endMs'>[];
  readonly shortcutTimestampsMs?: readonly number[];
}

/** Returns a bounded, strictly increasing, duplicate-free deterministic extraction schedule. */
export function createTutorialFrameTimestamps(
  input: TutorialFrameTimestampInput,
): readonly number[] {
  if (
    !millisecond(input.windowStartMs) ||
    !millisecond(input.windowEndMs) ||
    input.windowEndMs <= input.windowStartMs ||
    !Number.isSafeInteger(input.intervalMs) ||
    input.intervalMs <= 0 ||
    !Number.isSafeInteger(input.maximumFrames) ||
    input.maximumFrames <= 0 ||
    input.maximumFrames > 120
  ) {
    throw new TutorialMediaTimelineError('invalid_input');
  }
  // Analysis windows are end-exclusive. Seeking exactly to media duration commonly produces no
  // frame, so the final candidate is clamped to the last millisecond inside the window.
  const finalTimestampMs = input.windowEndMs - 1;
  const mandatory = new Set<number>([input.windowStartMs, finalTimestampMs]);
  for (const timestamp of input.shortcutTimestampsMs ?? []) {
    if (
      !millisecond(timestamp) ||
      timestamp < input.windowStartMs ||
      timestamp >= input.windowEndMs
    ) {
      throw new TutorialMediaTimelineError('invalid_input');
    }
    mandatory.add(timestamp);
  }
  for (const segment of input.asrSegments ?? []) {
    for (const timestamp of [segment.startMs, Math.min(segment.endMs - 1, finalTimestampMs)]) {
      if (
        !millisecond(timestamp) ||
        timestamp < input.windowStartMs ||
        timestamp >= input.windowEndMs
      ) {
        throw new TutorialMediaTimelineError('invalid_input');
      }
      mandatory.add(timestamp);
    }
  }
  const mandatoryValues = [...mandatory].sort((left, right) => left - right);
  if (mandatoryValues.length > input.maximumFrames) {
    const selected = new Set<number>();
    for (let index = 0; index < input.maximumFrames; index += 1) {
      const position =
        input.maximumFrames === 1
          ? 0
          : Math.round((index * (mandatoryValues.length - 1)) / (input.maximumFrames - 1));
      selected.add(mandatoryValues[position]!);
    }
    return [...selected].sort((left, right) => left - right);
  }
  const all = new Set(mandatoryValues);
  for (
    let timestamp = input.windowStartMs;
    timestamp < input.windowEndMs && all.size < input.maximumFrames;
    timestamp += input.intervalMs
  ) {
    all.add(timestamp);
  }
  return [...all].sort((left, right) => left - right);
}
