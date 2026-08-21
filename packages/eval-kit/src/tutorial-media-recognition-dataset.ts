import { createHash } from 'node:crypto';

const sha256Pattern = /^[a-f0-9]{64}$/u;
const splits = ['train', 'calibration', 'held_out'] as const;
export type RecognitionDatasetSplit = (typeof splits)[number];

export interface RecognitionStratum {
  readonly host: string;
  readonly hostVersion: string;
  readonly uiScale: string;
}

export interface RecognitionSource {
  readonly sourceId: string;
  readonly sourceIdentitySha256: string;
  readonly sourceMediaSha256: string;
  readonly sourceVideoSha256: string;
  readonly sourceLineageSha256: string;
  readonly split: RecognitionDatasetSplit;
  readonly evidenceKind: 'real' | 'synthetic_fixture';
  readonly rights: {
    readonly status: 'evaluation_allowed';
    readonly basis: string;
    readonly evidenceSha256: string;
  };
}

export interface UiGroundTruth {
  readonly instanceId: string;
  readonly sourceId: string;
  readonly frameSha256: string;
  readonly timeRange: { readonly startMs: number; readonly endMs: number };
  readonly normalizedLabel: string;
  readonly menuId: string | null;
  readonly controlId: string | null;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly stratum: RecognitionStratum;
  readonly annotation: { readonly annotatorId: string; readonly policyVersion: string };
}

export interface ShortcutGroundTruth {
  readonly eventId: string;
  readonly sourceId: string;
  readonly frameSha256: string;
  readonly timestampMs: number;
  readonly normalizedKeys: readonly string[];
  readonly stratum: RecognitionStratum;
  readonly annotation: { readonly annotatorId: string; readonly policyVersion: string };
}

export interface RetrievalCandidate {
  readonly candidateId: string;
  readonly segmentId: string;
  readonly sourceId: string;
  readonly fixedDistractor: boolean;
}

export interface RetrievalQuery {
  readonly queryId: string;
  readonly sourceId: string;
  readonly adjudicatedIntent: string;
  readonly relevantSegmentIds: readonly string[];
  readonly stratum: RecognitionStratum;
  readonly annotation: {
    readonly annotatorId: string;
    readonly reviewerId: string;
    readonly adjudicatorId: string;
    readonly policyVersion: string;
  };
}

export interface TutorialMediaRecognitionDataset {
  readonly formatVersion: '1.0.0';
  readonly sources: readonly RecognitionSource[];
  readonly uiGroundTruth: readonly UiGroundTruth[];
  readonly shortcutGroundTruth: readonly ShortcutGroundTruth[];
  readonly retrievalCandidates: readonly RetrievalCandidate[];
  readonly retrievalQueries: readonly RetrievalQuery[];
}

export interface UiPrediction {
  readonly candidateId: string;
  readonly sourceId: string;
  readonly frameSha256: string;
  readonly timestampMs: number;
  readonly normalizedLabel: string;
  readonly bounds: UiGroundTruth['bounds'];
  readonly stratum: RecognitionStratum;
}

export interface ShortcutPrediction {
  readonly candidateId: string;
  readonly sourceId: string;
  readonly frameSha256: string;
  readonly timestampMs: number;
  readonly normalizedKeys: readonly string[];
  readonly stratum: RecognitionStratum;
}

export interface RetrievalPrediction {
  readonly queryId: string;
  readonly candidateId: string;
  readonly score: number;
}

export interface TutorialMediaRecognitionPredictions {
  readonly ui: readonly UiPrediction[];
  readonly shortcuts: readonly ShortcutPrediction[];
  readonly retrieval: readonly RetrievalPrediction[];
  readonly provenance?: {
    readonly modelSha256: string;
    readonly configSha256: string;
  };
}

function assert(condition: boolean): asserts condition {
  if (!condition) throw new Error('The tutorial media recognition dataset is invalid.');
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function validBox(box: UiGroundTruth['bounds']): boolean {
  return (
    [box.x, box.y, box.width, box.height].every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) &&
    box.x + box.width <= 1 &&
    box.y + box.height <= 1
  );
}

function validStratum(stratum: RecognitionStratum): boolean {
  return [stratum.host, stratum.hostVersion, stratum.uiScale].every(
    (value) =>
      value.trim().length > 0 &&
      value === value.trim() &&
      [...value].every((character) => {
        const codePoint = character.codePointAt(0)!;
        return codePoint > 31 && (codePoint < 127 || codePoint > 159);
      }),
  );
}

export function normalizeRecognitionUiLabel(value: string): string {
  return value.normalize('NFKC').trim().replaceAll(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

export function normalizeRecognitionKeyChord(keys: readonly string[]): readonly string[] | null {
  const modifierAliases: Readonly<Record<string, string>> = {
    control: 'Ctrl',
    ctrl: 'Ctrl',
    option: 'Alt',
    alt: 'Alt',
    shift: 'Shift',
    command: 'Meta',
    cmd: 'Meta',
    meta: 'Meta',
    super: 'Meta',
  };
  const modifierOrder = ['Ctrl', 'Alt', 'Shift', 'Meta'];
  const found = new Set<string>();
  let key: string | undefined;
  for (const token of keys) {
    const modifier = modifierAliases[token.toLocaleLowerCase('en-US')];
    if (modifier !== undefined) {
      found.add(modifier);
    } else if (key === undefined) {
      key = token.length === 1 ? token.toLocaleUpperCase('en-US') : token;
    } else {
      return null;
    }
  }
  if (
    key === undefined ||
    !/^(?:[A-Z0-9]|F(?:[1-9]|1\d|2[0-4])|Backspace|Delete|Down|End|Enter|Escape|Home|Insert|Left|PageDown|PageUp|Right|Space|Tab|Up)$/u.test(
      key,
    )
  )
    return null;
  return [...modifierOrder.filter((modifier) => found.has(modifier)), key];
}

export function validateTutorialMediaRecognitionDataset(
  dataset: TutorialMediaRecognitionDataset,
): TutorialMediaRecognitionDataset {
  assert(dataset.formatVersion === '1.0.0' && dataset.sources.length > 0);
  assert(unique(dataset.sources.map((source) => source.sourceId)));
  const sourceById = new Map(dataset.sources.map((source) => [source.sourceId, source]));
  const groupSplits = new Map<string, RecognitionDatasetSplit>();
  for (const source of dataset.sources) {
    assert(
      sha256Pattern.test(source.sourceIdentitySha256) &&
        sha256Pattern.test(source.sourceMediaSha256) &&
        sha256Pattern.test(source.sourceVideoSha256) &&
        sha256Pattern.test(source.sourceLineageSha256) &&
        sha256Pattern.test(source.rights.evidenceSha256),
    );
    assert(
      (source.evidenceKind === 'real' || source.evidenceKind === 'synthetic_fixture') &&
        source.rights.status === 'evaluation_allowed' &&
        source.rights.basis.length > 0 &&
        splits.includes(source.split),
    );
    for (const group of [
      source.sourceIdentitySha256,
      source.sourceMediaSha256,
      source.sourceVideoSha256,
      source.sourceLineageSha256,
    ]) {
      const previous = groupSplits.get(group);
      assert(previous === undefined || previous === source.split);
      groupSplits.set(group, source.split);
    }
  }
  assert(
    unique(dataset.uiGroundTruth.map((item) => item.instanceId)) &&
      unique(dataset.shortcutGroundTruth.map((item) => item.eventId)) &&
      unique(dataset.retrievalQueries.map((item) => item.queryId)) &&
      unique(dataset.retrievalCandidates.map((item) => item.candidateId)) &&
      unique(dataset.retrievalCandidates.map((item) => item.segmentId)),
  );
  assert(
    unique(
      dataset.uiGroundTruth.map((item) =>
        JSON.stringify([
          item.sourceId,
          item.frameSha256,
          item.timeRange,
          item.normalizedLabel,
          item.bounds,
        ]),
      ),
    ) &&
      unique(
        dataset.shortcutGroundTruth.map((item) =>
          JSON.stringify([item.sourceId, item.frameSha256, item.timestampMs, item.normalizedKeys]),
        ),
      ),
  );
  for (const item of dataset.uiGroundTruth) {
    assert(
      sourceById.has(item.sourceId) &&
        sha256Pattern.test(item.frameSha256) &&
        item.timeRange.startMs >= 0 &&
        item.timeRange.endMs >= item.timeRange.startMs &&
        item.normalizedLabel.length > 0 &&
        item.normalizedLabel === normalizeRecognitionUiLabel(item.normalizedLabel) &&
        validBox(item.bounds) &&
        validStratum(item.stratum) &&
        item.annotation.annotatorId.length > 0 &&
        item.annotation.policyVersion.length > 0,
    );
  }
  for (const item of dataset.shortcutGroundTruth) {
    assert(
      sourceById.has(item.sourceId) &&
        sha256Pattern.test(item.frameSha256) &&
        Number.isSafeInteger(item.timestampMs) &&
        item.timestampMs >= 0 &&
        item.normalizedKeys.length > 0 &&
        item.normalizedKeys.every((key) => key.length > 0) &&
        JSON.stringify(normalizeRecognitionKeyChord(item.normalizedKeys)) ===
          JSON.stringify(item.normalizedKeys) &&
        validStratum(item.stratum) &&
        item.annotation.annotatorId.length > 0 &&
        item.annotation.policyVersion.length > 0,
    );
  }
  const segmentIds = new Set(dataset.retrievalCandidates.map((item) => item.segmentId));
  for (const candidate of dataset.retrievalCandidates) {
    const source = sourceById.get(candidate.sourceId);
    assert(
      source !== undefined &&
        candidate.segmentId.length > 0 &&
        typeof candidate.fixedDistractor === 'boolean',
    );
  }
  for (const query of dataset.retrievalQueries) {
    const source = sourceById.get(query.sourceId);
    assert(
      source !== undefined &&
        query.adjudicatedIntent.length > 0 &&
        query.relevantSegmentIds.length > 0 &&
        unique(query.relevantSegmentIds) &&
        query.relevantSegmentIds.every((id) => segmentIds.has(id)) &&
        validStratum(query.stratum),
    );
    assert(
      query.annotation.annotatorId !== query.annotation.reviewerId &&
        query.annotation.annotatorId !== query.annotation.adjudicatorId &&
        query.annotation.reviewerId !== query.annotation.adjudicatorId &&
        query.annotation.policyVersion.length > 0,
    );
  }
  for (const query of dataset.retrievalQueries)
    assert(
      query.relevantSegmentIds.every((id) =>
        dataset.retrievalCandidates.some(
          (candidate) =>
            candidate.segmentId === id &&
            !candidate.fixedDistractor &&
            sourceById.get(candidate.sourceId)?.split === sourceById.get(query.sourceId)?.split &&
            sourceById.get(candidate.sourceId)?.evidenceKind ===
              sourceById.get(query.sourceId)?.evidenceKind,
        ),
      ),
    );
  return dataset;
}

function stratumKey(stratum: RecognitionStratum): string {
  return canonical([stratum.host, stratum.hostVersion, stratum.uiScale]);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function metrics(tp: number, fp: number, fn: number) {
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision,
    recall,
    f1: precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall),
  };
}

export function normalizedBoxIou(
  left: UiGroundTruth['bounds'],
  right: UiGroundTruth['bounds'],
): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  const intersection = width * height;
  return ratio(intersection, left.width * left.height + right.width * right.height - intersection);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(',')}}`;
}

function canonicalSha256(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

interface MatchEdge {
  readonly truthId: string;
  readonly predictionId: string;
  readonly quality: readonly number[];
}

function compareEdges(left: MatchEdge, right: MatchEdge): number {
  const length = Math.max(left.quality.length, right.quality.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (right.quality[index] ?? 0) - (left.quality[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return (
    left.predictionId.localeCompare(right.predictionId) || left.truthId.localeCompare(right.truthId)
  );
}

/** Deterministic maximum-cardinality bipartite matching with quality-ordered edges. */
function maximumMatching(edges: readonly MatchEdge[]): Map<string, string> {
  const byTruth = new Map<string, MatchEdge[]>();
  for (const edge of [...edges].sort(compareEdges)) {
    const truthEdges = byTruth.get(edge.truthId) ?? [];
    truthEdges.push(edge);
    byTruth.set(edge.truthId, truthEdges);
  }
  const matchedTruthByPrediction = new Map<string, string>();
  const matchedPredictionByTruth = new Map<string, string>();
  const truthIds = [...byTruth.keys()].sort((left, right) => {
    const leftBest = byTruth.get(left)?.[0];
    const rightBest = byTruth.get(right)?.[0];
    if (leftBest !== undefined && rightBest !== undefined) {
      const qualityOrder = compareEdges(leftBest, rightBest);
      if (qualityOrder !== 0) return qualityOrder;
    }
    return left.localeCompare(right);
  });

  const augment = (truthId: string, visitedPredictions: Set<string>): boolean => {
    for (const edge of byTruth.get(truthId) ?? []) {
      if (visitedPredictions.has(edge.predictionId)) continue;
      visitedPredictions.add(edge.predictionId);
      const previousTruth = matchedTruthByPrediction.get(edge.predictionId);
      if (previousTruth === undefined || augment(previousTruth, visitedPredictions)) {
        matchedTruthByPrediction.set(edge.predictionId, truthId);
        matchedPredictionByTruth.set(truthId, edge.predictionId);
        return true;
      }
    }
    return false;
  };

  for (const truthId of truthIds) augment(truthId, new Set());
  return matchedPredictionByTruth;
}

function retrievalMetrics(
  queries: readonly RetrievalQuery[],
  retrievalByQuery: ReadonlyMap<string, readonly RetrievalPrediction[]>,
  candidateById: ReadonlyMap<string, RetrievalCandidate>,
) {
  let recall1 = 0;
  let recall5 = 0;
  let reciprocalRanks = 0;
  for (const query of queries) {
    const ranked = [...(retrievalByQuery.get(query.queryId) ?? [])].sort(
      (left, right) =>
        right.score - left.score || left.candidateId.localeCompare(right.candidateId),
    );
    const relevant = new Set(query.relevantSegmentIds);
    const rank =
      ranked.findIndex((entry) => relevant.has(candidateById.get(entry.candidateId)!.segmentId)) +
      1;
    if (rank === 1) recall1 += 1;
    if (rank > 0 && rank <= 5) recall5 += 1;
    if (rank > 0) reciprocalRanks += 1 / rank;
  }
  return {
    queryCount: queries.length,
    recallAt1: ratio(recall1, queries.length),
    recallAt5: ratio(recall5, queries.length),
    mrr: ratio(reciprocalRanks, queries.length),
  };
}

function uiClassMetrics(
  truth: readonly UiGroundTruth[],
  predictions: readonly UiPrediction[],
  matches: ReadonlyMap<string, string>,
) {
  const labels = [
    ...new Set([
      ...truth.map((item) => item.normalizedLabel),
      ...predictions.map((item) => item.normalizedLabel),
    ]),
  ].sort();
  const perClass = labels.map((label) => {
    const classTruth = truth.filter((item) => item.normalizedLabel === label);
    const classPredictions = predictions.filter((item) => item.normalizedLabel === label);
    const tp = classTruth.filter((item) => matches.has(item.instanceId)).length;
    return {
      label,
      support: classTruth.length,
      ...metrics(tp, classPredictions.length - tp, classTruth.length - tp),
    };
  });
  return {
    macroF1: ratio(
      perClass.reduce((sum, item) => sum + item.f1, 0),
      perClass.length,
    ),
    perClass,
  };
}

export function scoreTutorialMediaRecognition(
  uncheckedDataset: TutorialMediaRecognitionDataset,
  predictions: TutorialMediaRecognitionPredictions,
) {
  const dataset = validateTutorialMediaRecognitionDataset(uncheckedDataset);
  const sourceById = new Map(dataset.sources.map((source) => [source.sourceId, source]));
  assert(
    unique(predictions.ui.map((item) => item.candidateId)) &&
      unique(predictions.shortcuts.map((item) => item.candidateId)) &&
      predictions.ui.every(
        (item) => item.normalizedLabel === normalizeRecognitionUiLabel(item.normalizedLabel),
      ) &&
      predictions.shortcuts.every(
        (item) =>
          JSON.stringify(normalizeRecognitionKeyChord(item.normalizedKeys)) ===
            JSON.stringify(item.normalizedKeys) &&
          sourceById.has(item.sourceId) &&
          sha256Pattern.test(item.frameSha256) &&
          Number.isSafeInteger(item.timestampMs) &&
          item.timestampMs >= 0 &&
          validStratum(item.stratum),
      ) &&
      predictions.ui.every(
        (item) =>
          sourceById.has(item.sourceId) &&
          sha256Pattern.test(item.frameSha256) &&
          Number.isSafeInteger(item.timestampMs) &&
          item.timestampMs >= 0 &&
          validBox(item.bounds) &&
          validStratum(item.stratum),
      ) &&
      (predictions.provenance === undefined ||
        (sha256Pattern.test(predictions.provenance.modelSha256) &&
          sha256Pattern.test(predictions.provenance.configSha256))),
  );
  const isReleaseSource = (sourceId: string): boolean => {
    const source = sourceById.get(sourceId);
    return source?.split === 'held_out' && source.evidenceKind === 'real';
  };
  const evaluatedSources = dataset.sources
    .filter((source) => isReleaseSource(source.sourceId))
    .sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const uiTruth = dataset.uiGroundTruth
    .filter((item) => isReleaseSource(item.sourceId))
    .sort((a, b) => a.instanceId.localeCompare(b.instanceId));
  const uiPredictions = predictions.ui
    .filter((item) => isReleaseSource(item.sourceId))
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const uiMatches = maximumMatching(
    uiTruth.flatMap((truth) =>
      uiPredictions.flatMap((prediction) => {
        const iou = normalizedBoxIou(prediction.bounds, truth.bounds);
        const timeDistance = Math.min(
          Math.abs(prediction.timestampMs - truth.timeRange.startMs),
          Math.abs(prediction.timestampMs - truth.timeRange.endMs),
        );
        return prediction.sourceId === truth.sourceId &&
          prediction.frameSha256 === truth.frameSha256 &&
          prediction.normalizedLabel === truth.normalizedLabel &&
          stratumKey(prediction.stratum) === stratumKey(truth.stratum) &&
          prediction.timestampMs >= truth.timeRange.startMs - 500 &&
          prediction.timestampMs <= truth.timeRange.endMs + 500 &&
          iou >= 0.5
          ? [
              {
                truthId: truth.instanceId,
                predictionId: prediction.candidateId,
                quality: [iou, -timeDistance],
              },
            ]
          : [];
      }),
    ),
  );
  const matchedUi = new Set(uiMatches.values());
  const shortcutTruth = dataset.shortcutGroundTruth
    .filter((item) => isReleaseSource(item.sourceId))
    .sort((a, b) => a.eventId.localeCompare(b.eventId));
  const shortcutPredictions = predictions.shortcuts
    .filter((item) => isReleaseSource(item.sourceId))
    .sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  const shortcutMatches = maximumMatching(
    shortcutTruth.flatMap((truth) =>
      shortcutPredictions.flatMap((prediction) => {
        const timeDistance = Math.abs(prediction.timestampMs - truth.timestampMs);
        return prediction.sourceId === truth.sourceId &&
          prediction.frameSha256 === truth.frameSha256 &&
          prediction.normalizedKeys.join('+') === truth.normalizedKeys.join('+') &&
          stratumKey(prediction.stratum) === stratumKey(truth.stratum) &&
          timeDistance <= 500
          ? [
              {
                truthId: truth.eventId,
                predictionId: prediction.candidateId,
                quality: [-timeDistance],
              },
            ]
          : [];
      }),
    ),
  );
  const matchedShortcuts = new Set(shortcutMatches.values());
  const evaluatedQueries = dataset.retrievalQueries
    .filter((query) => isReleaseSource(query.sourceId))
    .sort((left, right) => left.queryId.localeCompare(right.queryId));
  const evaluatedCandidates = dataset.retrievalCandidates
    .filter((candidate) => isReleaseSource(candidate.sourceId))
    .sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const candidateById = new Map(
    evaluatedCandidates.map((candidate) => [candidate.candidateId, candidate]),
  );
  const allCandidateIds = new Set(dataset.retrievalCandidates.map((item) => item.candidateId));
  const allQueryIds = new Set(dataset.retrievalQueries.map((query) => query.queryId));
  const evaluatedQueryIds = new Set(evaluatedQueries.map((query) => query.queryId));
  const retrievalByQuery = new Map<string, RetrievalPrediction[]>();
  for (const prediction of predictions.retrieval) {
    assert(
      Number.isFinite(prediction.score) &&
        allCandidateIds.has(prediction.candidateId) &&
        allQueryIds.has(prediction.queryId),
    );
    if (!evaluatedQueryIds.has(prediction.queryId) || !candidateById.has(prediction.candidateId))
      continue;
    const list = retrievalByQuery.get(prediction.queryId) ?? [];
    assert(!list.some((entry) => entry.candidateId === prediction.candidateId));
    list.push(prediction);
    retrievalByQuery.set(prediction.queryId, list);
  }
  for (const query of evaluatedQueries) {
    const ranked = retrievalByQuery.get(query.queryId) ?? [];
    assert(
      ranked.length === candidateById.size &&
        ranked.every((entry) => candidateById.has(entry.candidateId)),
    );
  }
  const aggregateUi = metrics(
    uiMatches.size,
    uiPredictions.length - uiMatches.size,
    uiTruth.length - uiMatches.size,
  );
  const aggregateShortcuts = metrics(
    shortcutMatches.size,
    shortcutPredictions.length - shortcutMatches.size,
    shortcutTruth.length - shortcutMatches.size,
  );
  const aggregateRetrieval = retrievalMetrics(evaluatedQueries, retrievalByQuery, candidateById);
  const aggregateUiClasses = uiClassMetrics(uiTruth, uiPredictions, uiMatches);
  const stratumByKey = new Map<string, RecognitionStratum>();
  for (const item of [
    ...uiTruth,
    ...uiPredictions,
    ...shortcutTruth,
    ...shortcutPredictions,
    ...evaluatedQueries,
  ])
    stratumByKey.set(stratumKey(item.stratum), item.stratum);
  const strataKeys = [
    ...new Set([
      ...uiTruth.map((item) => stratumKey(item.stratum)),
      ...uiPredictions.map((item) => stratumKey(item.stratum)),
      ...shortcutTruth.map((item) => stratumKey(item.stratum)),
      ...shortcutPredictions.map((item) => stratumKey(item.stratum)),
      ...evaluatedQueries.map((item) => stratumKey(item.stratum)),
    ]),
  ].sort();
  const strata = strataKeys.map((key) => {
    const ui = uiTruth.filter((item) => stratumKey(item.stratum) === key);
    const uiPredictionSet = uiPredictions.filter((item) => stratumKey(item.stratum) === key);
    const shortcut = shortcutTruth.filter((item) => stratumKey(item.stratum) === key);
    const shortcutPredictionSet = shortcutPredictions.filter(
      (item) => stratumKey(item.stratum) === key,
    );
    const queries = evaluatedQueries.filter((item) => stratumKey(item.stratum) === key);
    const uiTp = ui.filter((item) => uiMatches.has(item.instanceId)).length;
    const shortcutTp = shortcut.filter((item) => shortcutMatches.has(item.eventId)).length;
    const uiMetrics = metrics(uiTp, uiPredictionSet.length - uiTp, ui.length - uiTp);
    const uiClasses = uiClassMetrics(ui, uiPredictionSet, uiMatches);
    const shortcutMetrics = metrics(
      shortcutTp,
      shortcutPredictionSet.length - shortcutTp,
      shortcut.length - shortcutTp,
    );
    const retrieval = retrievalMetrics(queries, retrievalByQuery, candidateById);
    const maximumAggregateDrop = Math.max(
      0,
      aggregateUi.precision - uiMetrics.precision,
      aggregateUi.recall - uiMetrics.recall,
      aggregateUi.f1 - uiMetrics.f1,
      aggregateUiClasses.macroF1 - uiClasses.macroF1,
      aggregateShortcuts.precision - shortcutMetrics.precision,
      aggregateShortcuts.recall - shortcutMetrics.recall,
      aggregateShortcuts.f1 - shortcutMetrics.f1,
      aggregateRetrieval.recallAt1 - retrieval.recallAt1,
      aggregateRetrieval.recallAt5 - retrieval.recallAt5,
      aggregateRetrieval.mrr - retrieval.mrr,
    );
    const supportAvailable = queries.length >= 10 && ui.length >= 20 && shortcut.length >= 20;
    const currentStratum = stratumByKey.get(key)!;
    return {
      stratum: currentStratum,
      realSupport: {
        retrievalQueries: queries.length,
        uiInstances: ui.length,
        shortcutEvents: shortcut.length,
      },
      ui: { ...uiMetrics, macroF1: uiClasses.macroF1 },
      shortcuts: shortcutMetrics,
      retrieval,
      maximumAggregateDrop,
      qualityGate: maximumAggregateDrop <= 0.1 ? ('pass' as const) : ('fail' as const),
      availability:
        supportAvailable && maximumAggregateDrop <= 0.1
          ? ('available' as const)
          : ('unavailable' as const),
    };
  });
  const perShortcutClass = [...new Set(shortcutTruth.map((item) => item.normalizedKeys.join('+')))]
    .sort()
    .map((label) => {
      const truth = shortcutTruth.filter((item) => item.normalizedKeys.join('+') === label);
      const predicted = shortcutPredictions.filter(
        (item) => item.normalizedKeys.join('+') === label,
      );
      const tp = truth.filter((item) => shortcutMatches.has(item.eventId)).length;
      return {
        label,
        support: truth.length,
        ...metrics(tp, predicted.length - tp, truth.length - tp),
      };
    });
  const content = {
    formatVersion: '1.0.0' as const,
    evaluatedSplit: 'held_out' as const,
    evidenceKind: 'real' as const,
    evaluatedCorpusSha256: canonicalSha256({
      sources: evaluatedSources,
      uiGroundTruth: uiTruth,
      shortcutGroundTruth: shortcutTruth,
      retrievalCandidates: evaluatedCandidates,
      retrievalQueries: evaluatedQueries,
    }),
    bindings: {
      modelSha256: predictions.provenance?.modelSha256 ?? null,
      configSha256: predictions.provenance?.configSha256 ?? null,
      sourceLineageSha256: canonicalSha256(
        evaluatedSources.map((source) => ({
          sourceId: source.sourceId,
          sourceIdentitySha256: source.sourceIdentitySha256,
          sourceMediaSha256: source.sourceMediaSha256,
          sourceVideoSha256: source.sourceVideoSha256,
          sourceLineageSha256: source.sourceLineageSha256,
        })),
      ),
      candidatePoolSha256: canonicalSha256(evaluatedCandidates),
      querySetSha256: canonicalSha256(
        evaluatedQueries.map(({ relevantSegmentIds: _relevance, ...query }) => query),
      ),
      relevanceJudgmentsSha256: canonicalSha256(
        evaluatedQueries.map((query) => ({
          queryId: query.queryId,
          relevantSegmentIds: [...query.relevantSegmentIds].sort(),
        })),
      ),
    },
    policy: {
      normalizationPolicy: 'tutorial-media-recognition-normalization-v1' as const,
      keyToleranceMs: 500,
      uiIouThreshold: 0.5,
      retrievalTieBreak: 'candidate_id_ascending' as const,
      minimumRealStratumSupport: { retrievalQueries: 10, uiInstances: 20, shortcutEvents: 20 },
      maximumAggregateDrop: 0.1,
      minimumAggregateQuality: {
        uiMacroF1: 0.85,
        shortcutPrecision: 0.9,
        shortcutRecall: 0.9,
        retrievalRecallAt5: 0.9,
        retrievalMrr: 0.8,
      },
    },
    ui: {
      ...aggregateUi,
      falsePositiveCandidateIds: uiPredictions
        .filter((item) => !matchedUi.has(item.candidateId))
        .map((item) => item.candidateId),
      falseNegativeInstanceIds: uiTruth
        .filter((item) => !uiMatches.has(item.instanceId))
        .map((item) => item.instanceId),
      ...aggregateUiClasses,
    },
    shortcuts: {
      ...aggregateShortcuts,
      falsePositiveCandidateIds: shortcutPredictions
        .filter((item) => !matchedShortcuts.has(item.candidateId))
        .map((item) => item.candidateId),
      falseNegativeEventIds: shortcutTruth
        .filter((item) => !shortcutMatches.has(item.eventId))
        .map((item) => item.eventId),
      perClass: perShortcutClass,
    },
    retrieval: aggregateRetrieval,
    strata,
    aggregateQualityGate:
      aggregateUiClasses.macroF1 >= 0.85 &&
      aggregateShortcuts.precision >= 0.9 &&
      aggregateShortcuts.recall >= 0.9 &&
      aggregateRetrieval.recallAt5 >= 0.9 &&
      aggregateRetrieval.mrr >= 0.8
        ? ('pass' as const)
        : ('fail' as const),
    realCalibrationEligible:
      predictions.provenance !== undefined &&
      evaluatedSources.length > 0 &&
      strata.length > 0 &&
      strata.every((stratum) => stratum.availability === 'available') &&
      aggregateUiClasses.macroF1 >= 0.85 &&
      aggregateShortcuts.precision >= 0.9 &&
      aggregateShortcuts.recall >= 0.9 &&
      aggregateRetrieval.recallAt5 >= 0.9 &&
      aggregateRetrieval.mrr >= 0.8,
  };
  return {
    ...content,
    reportSha256: createHash('sha256').update(canonical(content)).digest('hex'),
  };
}
