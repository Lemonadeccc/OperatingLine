import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type { TutorialMediaProcessRunner } from './tutorial-media-process.js';

const maximumTsvBytes = 16 * 1_024 * 1_024;
const modifiers = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
const modifierAliases: Readonly<Record<string, (typeof modifiers)[number]>> = {
  alt: 'Alt',
  cmd: 'Meta',
  command: 'Meta',
  control: 'Ctrl',
  ctrl: 'Ctrl',
  meta: 'Meta',
  option: 'Alt',
  shift: 'Shift',
  super: 'Meta',
};
const namedKeys: Readonly<Record<string, string>> = {
  backspace: 'Backspace',
  delete: 'Delete',
  down: 'Down',
  end: 'End',
  enter: 'Enter',
  esc: 'Escape',
  escape: 'Escape',
  home: 'Home',
  insert: 'Insert',
  left: 'Left',
  pagedown: 'PageDown',
  pageup: 'PageUp',
  return: 'Enter',
  right: 'Right',
  space: 'Space',
  tab: 'Tab',
  up: 'Up',
};
const defaultTesseractLanguageCodes: Readonly<Record<string, string>> = {
  ar: 'ara',
  cs: 'ces',
  da: 'dan',
  de: 'deu',
  en: 'eng',
  es: 'spa',
  fi: 'fin',
  fr: 'fra',
  hi: 'hin',
  id: 'ind',
  it: 'ita',
  ja: 'jpn',
  ko: 'kor',
  nl: 'nld',
  no: 'nor',
  pl: 'pol',
  pt: 'por',
  ru: 'rus',
  sv: 'swe',
  th: 'tha',
  tr: 'tur',
  uk: 'ukr',
  vi: 'vie',
  zh: 'chi_sim',
  'zh-cn': 'chi_sim',
  'zh-hans': 'chi_sim',
  'zh-hant': 'chi_tra',
  'zh-hk': 'chi_tra',
  'zh-tw': 'chi_tra',
};

export type TutorialMediaOcrErrorCode = 'invalid_input' | 'ocr_failed';

export class TutorialMediaOcrError extends Error {
  constructor(readonly code: TutorialMediaOcrErrorCode) {
    super(code === 'invalid_input' ? 'The OCR input is invalid.' : 'OCR analysis failed.');
    this.name = 'TutorialMediaOcrError';
  }
}

export interface TutorialMediaOcrCandidate {
  readonly candidateId: string;
  readonly frameId: string;
  readonly bounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly confidence: number;
  readonly text: string;
  readonly locale: string | null;
}

export interface TutorialMediaShortcutCandidate {
  readonly candidateId: string;
  readonly frameId: string;
  readonly timestampMs: number;
  readonly keys: readonly string[];
  readonly confidence: number;
}

export interface TutorialMediaOcrResult {
  readonly ocrCandidates: readonly TutorialMediaOcrCandidate[];
  readonly shortcutCandidates: readonly TutorialMediaShortcutCandidate[];
}

export interface TutorialMediaOcr {
  analyze(input: {
    readonly framePath: string;
    readonly frameId: string;
    readonly timestampMs: number;
    readonly width: number;
    readonly height: number;
    readonly locale: string;
    readonly signal?: AbortSignal;
  }): Promise<TutorialMediaOcrResult>;
}

export interface TutorialMediaOcrOptions {
  readonly runner: TutorialMediaProcessRunner;
  readonly executable: string;
  readonly jobDirectory: string;
  readonly tessdataDirectory: string;
  readonly timeoutMs?: number;
  readonly languageCodes?: Readonly<Record<string, string>>;
}

interface TsvWord {
  readonly lineKey: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly confidence: number;
  readonly text: string;
}

function stableUuid(parts: readonly (string | number)[]): string {
  const hex = createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((Number.parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`;
}

function validPath(value: string): boolean {
  return isAbsolute(value) && resolve(value) === value && !value.includes('\0');
}

function integer(value: string): number | undefined {
  if (!/^-?\d+$/u.test(value)) return;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

async function validateTessdataDirectory(path: string): Promise<void> {
  try {
    const info = await lstat(path);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new TutorialMediaOcrError('invalid_input');
    }
  } catch (error) {
    if (error instanceof TutorialMediaOcrError) throw error;
    throw new TutorialMediaOcrError('invalid_input');
  }
}

export function resolveTesseractLanguageCode(
  locale: string,
  overrides: Readonly<Record<string, string>> = {},
): string | undefined {
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u.test(locale)) return;
  const normalized = locale.toLowerCase();
  const primary = normalized.split('-')[0]!;
  const languageCode =
    overrides[normalized] ??
    overrides[primary] ??
    defaultTesseractLanguageCodes[normalized] ??
    defaultTesseractLanguageCodes[primary];
  return languageCode !== undefined && /^[A-Za-z0-9_]{2,32}$/u.test(languageCode)
    ? languageCode
    : undefined;
}

function shortcutKey(token: string): string | undefined {
  const normalized = token.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
  if (/^[a-z]$/u.test(normalized)) return normalized.toUpperCase();
  if (/^[0-9]$/u.test(normalized)) return normalized;
  if (/^f(?:[1-9]|1\d|2[0-4])$/u.test(normalized)) return normalized.toUpperCase();
  return namedKeys[normalized];
}

export function parseCandidateShortcut(text: string): readonly string[] | null {
  const tokens = text
    .split(/(?:\s*\+\s*|\s+)/u)
    .map((token) => token.trim())
    .filter(Boolean);
  if (tokens.length < 2 || tokens.length > 8) return null;
  const foundModifiers = new Set<(typeof modifiers)[number]>();
  let key: string | undefined;
  for (const token of tokens) {
    const normalized = token.toLowerCase().replaceAll(/[^a-z0-9]/gu, '');
    const modifier = modifierAliases[normalized];
    if (modifier !== undefined) {
      foundModifiers.add(modifier);
      continue;
    }
    const candidateKey = shortcutKey(token);
    if (candidateKey === undefined || key !== undefined) return null;
    key = candidateKey;
  }
  if (foundModifiers.size === 0 || key === undefined) return null;
  return [...modifiers.filter((modifier) => foundModifiers.has(modifier)), key];
}

function parseTsv(bytes: Uint8Array, width: number, height: number): readonly TsvWord[] {
  if (bytes.byteLength === 0 || bytes.byteLength > maximumTsvBytes) {
    throw new TutorialMediaOcrError('ocr_failed');
  }
  const lines = Buffer.from(bytes).toString('utf8').replaceAll('\r\n', '\n').split('\n');
  const header = lines.shift();
  if (
    header !==
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'
  ) {
    throw new TutorialMediaOcrError('ocr_failed');
  }
  const words: TsvWord[] = [];
  for (const line of lines) {
    if (line === '') continue;
    const columns = line.split('\t');
    if (columns.length !== 12) throw new TutorialMediaOcrError('ocr_failed');
    const [
      levelText,
      page,
      block,
      paragraph,
      lineNumber,
      ,
      leftText,
      topText,
      widthText,
      heightText,
      confidenceText,
      text,
    ] = columns as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];
    const level = integer(levelText);
    const confidence = Number(confidenceText);
    if (level === undefined || !Number.isFinite(confidence))
      throw new TutorialMediaOcrError('ocr_failed');
    if (level !== 5 || confidence === -1 || text.trim() === '') continue;
    const left = integer(leftText);
    const top = integer(topText);
    const boxWidth = integer(widthText);
    const boxHeight = integer(heightText);
    if (
      confidence < 0 ||
      confidence > 100 ||
      left === undefined ||
      top === undefined ||
      boxWidth === undefined ||
      boxHeight === undefined ||
      left < 0 ||
      top < 0 ||
      boxWidth <= 0 ||
      boxHeight <= 0 ||
      left + boxWidth > width ||
      top + boxHeight > height ||
      text.length > 4_096
    ) {
      throw new TutorialMediaOcrError('ocr_failed');
    }
    words.push({
      confidence: confidence / 100,
      height: boxHeight,
      left,
      lineKey: `${page}:${block}:${paragraph}:${lineNumber}`,
      text: text.trim(),
      top,
      width: boxWidth,
    });
  }
  return words;
}

export function createTutorialMediaOcr(options: TutorialMediaOcrOptions): TutorialMediaOcr {
  if (
    !validPath(options.executable) ||
    !validPath(options.jobDirectory) ||
    !validPath(options.tessdataDirectory)
  ) {
    throw new TutorialMediaOcrError('invalid_input');
  }
  return {
    async analyze(input) {
      const languageCode = resolveTesseractLanguageCode(input.locale, options.languageCodes);
      if (
        !validPath(input.framePath) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          input.frameId,
        ) ||
        !Number.isSafeInteger(input.timestampMs) ||
        input.timestampMs < 0 ||
        !Number.isSafeInteger(input.width) ||
        input.width <= 0 ||
        input.width > 16_384 ||
        !Number.isSafeInteger(input.height) ||
        input.height <= 0 ||
        input.height > 16_384 ||
        !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u.test(input.locale) ||
        languageCode === undefined
      ) {
        throw new TutorialMediaOcrError('invalid_input');
      }
      await validateTessdataDirectory(options.tessdataDirectory);
      try {
        const frame = await lstat(input.framePath);
        if (frame.isSymbolicLink() || !frame.isFile() || frame.size <= 0) {
          throw new TutorialMediaOcrError('invalid_input');
        }
        const result = await options.runner.run(
          {
            executable: options.executable,
            cwd: options.jobDirectory,
            args: [
              input.framePath,
              'stdout',
              '--tessdata-dir',
              options.tessdataDirectory,
              '-l',
              languageCode,
              '-c',
              'tessedit_create_tsv=1',
            ],
          },
          {
            signal: input.signal,
            timeoutMs: options.timeoutMs ?? 120_000,
            maximumOutputBytes: maximumTsvBytes,
          },
        );
        const words = parseTsv(result.stdout, input.width, input.height);
        const ocrCandidates = words.map((word) => ({
          bounds: {
            x: word.left / input.width,
            y: word.top / input.height,
            width: word.width / input.width,
            height: word.height / input.height,
          },
          candidateId: stableUuid([input.frameId, word.lineKey, word.left, word.top, word.text]),
          confidence: word.confidence,
          frameId: input.frameId,
          locale: input.locale,
          text: word.text,
        }));
        const shortcutCandidates: TutorialMediaShortcutCandidate[] = [];
        const byLine = new Map<string, TsvWord[]>();
        for (const word of words)
          byLine.set(word.lineKey, [...(byLine.get(word.lineKey) ?? []), word]);
        for (const [lineKey, lineWords] of byLine) {
          const keys = parseCandidateShortcut(lineWords.map((word) => word.text).join(' '));
          if (keys === null) continue;
          shortcutCandidates.push({
            candidateId: stableUuid([input.frameId, lineKey, ...keys]),
            confidence: Math.min(...lineWords.map((word) => word.confidence)),
            frameId: input.frameId,
            keys,
            timestampMs: input.timestampMs,
          });
        }
        return { ocrCandidates, shortcutCandidates };
      } catch (error) {
        if (error instanceof TutorialMediaOcrError && error.code === 'invalid_input') throw error;
        throw new TutorialMediaOcrError('ocr_failed');
      }
    },
  };
}
