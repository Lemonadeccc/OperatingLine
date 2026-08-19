import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  procedureTutorialMediaAnalysisRequestSchema,
  type ProcedureTutorialMediaAnalysisRequest,
} from '../../../packages/protocol/src/index.js';
import { createTutorialMediaAsr } from '../../../services/orchestrator/src/tutorial-media-asr.js';
import {
  createTutorialFrameTimestamps,
  segmentTutorialTimeline,
} from '../../../services/orchestrator/src/tutorial-media-timeline.js';
import {
  createTutorialMediaOcr,
  parseCandidateShortcut,
} from '../../../services/orchestrator/src/tutorial-media-ocr.js';
import { createTutorialMediaProbe } from '../../../services/orchestrator/src/tutorial-media-probe.js';
import type {
  TutorialMediaProcessCommand,
  TutorialMediaProcessResult,
  TutorialMediaProcessRunOptions,
  TutorialMediaProcessRunner,
} from '../../../services/orchestrator/src/tutorial-media-process.js';
import { createTutorialMediaTranscoder } from '../../../services/orchestrator/src/tutorial-media-transcoder.js';
import {
  createYouTubeMediaAuthorizationVerifier,
  YouTubeMediaAuthorizationError,
} from '../../../services/orchestrator/src/youtube-media-authorization.js';
import { createYouTubeMediaSource } from '../../../services/orchestrator/src/youtube-media-source.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

async function fixtureDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'operatingline-media-tools-test-'));
  temporaryDirectories.push(path);
  return path;
}

function executable(root: string, name: string): string {
  return join(root, name);
}

function mediaRequest(
  overrides: Partial<ProcedureTutorialMediaAnalysisRequest> = {},
): ProcedureTutorialMediaAnalysisRequest {
  return procedureTutorialMediaAnalysisRequestSchema.parse({
    formatVersion: '1.0.0',
    requestId: '9cc2ef5e-110f-49fa-b72d-1e047ca38bca',
    videoId: 'dQw4w9WgXcQ',
    analysisProfile: 'youtube_tutorial_evidence_v1',
    locale: 'en-US',
    analysisWindow: { startMs: 0, endMs: 10_000 },
    requestedStages: ['download', 'probe', 'audio', 'asr', 'frames', 'ocr', 'segmentation'],
    rightsAuthorization: {
      basis: 'rights_holder_permission',
      reference: 'rights-fixture',
      confirmedAt: '2026-08-18T12:00:00.000Z',
    },
    platformDownloadAuthorization: {
      basis: 'youtube_written_approval',
      reference: 'youtube-fixture',
      confirmedAt: '2026-08-18T12:00:00.000Z',
    },
    approvals: {
      networkAccessApproved: true,
      mediaDownloadApproved: true,
      retentionApproved: true,
    },
    ...overrides,
  });
}

function fakeRunner(
  implementation: (
    command: TutorialMediaProcessCommand,
    options: TutorialMediaProcessRunOptions,
  ) => Promise<Partial<TutorialMediaProcessResult> | void>,
): TutorialMediaProcessRunner & {
  run: ReturnType<typeof vi.fn<TutorialMediaProcessRunner['run']>>;
} {
  const run = vi.fn<TutorialMediaProcessRunner['run']>(async (command, options) => {
    const result = await implementation(command, options);
    return {
      exitCode: 0,
      signal: null,
      stderr: new Uint8Array(),
      stdout: new Uint8Array(),
      ...result,
    };
  });
  return { close: vi.fn(async () => undefined), run };
}

describe('YouTube media source', () => {
  it('requires prior authorization and passes only the fixed yt-dlp argument surface', async () => {
    const root = await fixtureDirectory();
    const request = mediaRequest();
    let authorized = false;
    const authorizationVerifier = {
      verify: vi.fn(async () => {
        if (!authorized) throw new YouTubeMediaAuthorizationError('authorization_required');
      }),
    };
    const runner = fakeRunner(async (command, options) => {
      expect(options.maximumOutputBytes).toBe(256 * 1_024);
      expect(command.args).toEqual([
        '--ignore-config',
        '--no-playlist',
        '--no-progress',
        '--no-overwrites',
        '--no-cache-dir',
        '--no-cookies',
        '--restrict-filenames',
        '--format',
        'bestvideo*+bestaudio/best',
        '--max-filesize',
        '1024',
        '--ffmpeg-location',
        executable(root, 'ffmpeg'),
        '--merge-output-format',
        'mp4',
        '--remux-video',
        'mp4',
        '--output',
        join(root, 'source', 'media.%(ext)s'),
        '--print',
        'after_move:{"id":%(id)j,"title":%(title)j,"duration":%(duration)j,"filepath":%(filepath)j}',
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      ]);
      await writeFile(join(root, 'source', 'media.mp4'), 'video');
      return {
        stdout: Buffer.from(
          JSON.stringify({
            id: 'dQw4w9WgXcQ',
            title: 'Fixture',
            duration: 12.5,
            filepath: join(root, 'source', 'media.mp4'),
          }),
        ),
      };
    });
    const source = createYouTubeMediaSource({
      authorizationVerifier,
      executable: executable(root, 'yt-dlp'),
      ffmpegExecutable: executable(root, 'ffmpeg'),
      jobDirectory: root,
      maximumDownloadBytes: 1_024,
      runner,
    });

    await expect(source.download({ request })).rejects.toMatchObject({
      code: 'authorization_required',
    });
    expect(runner.run).not.toHaveBeenCalled();

    authorized = true;
    await expect(
      source.download({ request: { ...request, videoId: 'not-a-url!' } as never }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect(runner.run).not.toHaveBeenCalled();

    await expect(source.download({ request })).resolves.toEqual({
      durationMs: 12_500,
      mediaPath: join(root, 'source', 'media.mp4'),
      title: 'Fixture',
      videoId: 'dQw4w9WgXcQ',
    });
  });

  it('rejects mismatched metadata and non-regular output without leaking tool details', async () => {
    const root = await fixtureDirectory();
    const target = join(root, 'target.mp4');
    await writeFile(target, 'target');
    const runner = fakeRunner(async () => {
      await symlink(target, join(root, 'source', 'media.mp4'));
      return { stdout: Buffer.from(JSON.stringify({ id: 'wrong-id' })) };
    });
    const source = createYouTubeMediaSource({
      authorizationVerifier: { verify: vi.fn(async () => undefined) },
      executable: executable(root, 'yt-dlp'),
      ffmpegExecutable: executable(root, 'ffmpeg'),
      jobDirectory: root,
      runner,
    });
    const error = await source
      .download({ request: mediaRequest() })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'invalid_download' });
    expect(String(error)).not.toContain(root);
    expect(String(error)).not.toContain('youtube.com');
  });

  it('aborts an in-progress download as soon as the staging byte quota is exceeded', async () => {
    const root = await fixtureDirectory();
    const runner = fakeRunner(async (_command, options) => {
      await writeFile(join(root, 'source', 'media.part'), 'oversized');
      await new Promise<never>((_resolve, reject) => {
        const abort = () => reject(new DOMException('aborted', 'AbortError'));
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener('abort', abort, { once: true });
      });
    });
    const source = createYouTubeMediaSource({
      authorizationVerifier: { verify: vi.fn(async () => undefined) },
      executable: executable(root, 'yt-dlp'),
      ffmpegExecutable: executable(root, 'ffmpeg'),
      jobDirectory: root,
      maximumDownloadBytes: 4,
      runner,
    });

    await expect(source.download({ request: mediaRequest() })).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
  });

  it('verifies trusted registry bindings, validity, and recent confirmations', async () => {
    const now = new Date('2026-08-18T12:05:00.000Z');
    const verifier = createYouTubeMediaAuthorizationVerifier(
      {
        formatVersion: '1.0.0',
        authorizations: [
          {
            authorizationId: 'fixture-authorization',
            videoId: 'dQw4w9WgXcQ',
            rightsAuthorization: {
              basis: 'rights_holder_permission',
              reference: 'rights-fixture',
            },
            platformDownloadAuthorization: {
              basis: 'youtube_written_approval',
              reference: 'youtube-fixture',
            },
            validFrom: '2026-08-18T00:00:00.000Z',
            expiresAt: '2026-08-19T00:00:00.000Z',
          },
        ],
      },
      { now: () => now },
    );
    await expect(verifier.verify(mediaRequest())).resolves.toBeUndefined();
    await expect(
      verifier.verify(
        mediaRequest({
          platformDownloadAuthorization: {
            basis: 'youtube_written_approval',
            reference: 'untrusted-reference',
            confirmedAt: '2026-08-18T12:00:00.000Z',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'authorization_required' });
  });
});

describe('ffprobe media adapter', () => {
  it('parses one strict MP4 video stream and optional audio stream', async () => {
    const root = await fixtureDirectory();
    const mediaPath = join(root, 'media.mp4');
    await writeFile(mediaPath, 'video');
    const payload = {
      format: { duration: '10.000', format_name: 'mov,mp4,m4a,3gp,3g2,mj2' },
      streams: [
        {
          avg_frame_rate: '30/1',
          codec_name: 'h264',
          codec_type: 'video',
          height: 1080,
          nb_frames: '300',
          width: 1920,
        },
        { channels: 2, codec_name: 'aac', codec_type: 'audio', sample_rate: '48000' },
      ],
    };
    const runner = fakeRunner(async (command) => {
      expect(command.args).toEqual([
        '-v',
        'error',
        '-show_format',
        '-show_streams',
        '-of',
        'json',
        mediaPath,
      ]);
      return { stdout: Buffer.from(JSON.stringify(payload)) };
    });
    const probe = createTutorialMediaProbe({
      executable: executable(root, 'ffprobe'),
      jobDirectory: root,
      runner,
    });
    await expect(probe.probe(mediaPath)).resolves.toEqual({
      audio: { channels: 2, codec: 'aac', sampleRateHz: 48_000 },
      container: 'mp4',
      durationMs: 10_000,
      video: { codec: 'h264', frameCount: 300, frameRate: 30, height: 1080, width: 1920 },
    });
  });

  it('rejects malformed dimensions, inconsistent frames, and multiple video streams', async () => {
    const root = await fixtureDirectory();
    const mediaPath = join(root, 'media.mp4');
    await writeFile(mediaPath, 'video');
    const invalid = {
      format: { duration: '10', format_name: 'mp4' },
      streams: [
        {
          avg_frame_rate: '30/1',
          codec_name: 'h264',
          codec_type: 'video',
          height: 1080,
          nb_frames: '1',
          width: 1920,
        },
        {
          avg_frame_rate: '30/1',
          codec_name: 'h264',
          codec_type: 'video',
          height: 1080,
          nb_frames: '300',
          width: 1920,
        },
      ],
    };
    const probe = createTutorialMediaProbe({
      executable: executable(root, 'ffprobe'),
      jobDirectory: root,
      runner: fakeRunner(async () => ({ stdout: Buffer.from(JSON.stringify(invalid)) })),
    });
    await expect(probe.probe(mediaPath)).rejects.toMatchObject({ code: 'unsupported_media' });
  });
});

describe('ffmpeg transcoder adapter', () => {
  it('uses fixed 16 kHz mono WAV and single-PNG commands and validates outputs', async () => {
    const root = await fixtureDirectory();
    const mediaPath = join(root, 'media.mp4');
    await writeFile(mediaPath, 'video');
    const runner = fakeRunner(async (command) => {
      const output = command.args!.at(-1)!;
      await writeFile(output, 'derived');
    });
    const transcoder = createTutorialMediaTranscoder({
      executable: executable(root, 'ffmpeg'),
      jobDirectory: root,
      runner,
    });
    const audioPath = await transcoder.extractAudio(mediaPath, { startMs: 2_000, endMs: 8_000 });
    expect(runner.run.mock.calls[0]![0].args).toEqual([
      '-nostdin',
      '-n',
      '-ss',
      '2.000',
      '-i',
      mediaPath,
      '-t',
      '6.000',
      '-vn',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-c:a',
      'pcm_s16le',
      '-fs',
      String(512 * 1_024 * 1_024),
      audioPath,
    ]);
    const framePath = await transcoder.extractFrame(mediaPath, 1_234);
    expect(runner.run.mock.calls[1]![0].args).toEqual([
      '-nostdin',
      '-n',
      '-ss',
      '1.234',
      '-i',
      mediaPath,
      '-frames:v',
      '1',
      '-f',
      'image2',
      '-vcodec',
      'png',
      '-fs',
      String(32 * 1_024 * 1_024),
      framePath,
    ]);
    expect(await readFile(audioPath, 'utf8')).toBe('derived');
    expect(await readFile(framePath, 'utf8')).toBe('derived');
  });

  it('maps oversized direct outputs to the pipeline quota error', async () => {
    const root = await fixtureDirectory();
    const mediaPath = join(root, 'media.mp4');
    await writeFile(mediaPath, 'video');
    const runner = fakeRunner(async (command) => {
      await writeFile(command.args!.at(-1)!, 'oversized');
    });
    const transcoder = createTutorialMediaTranscoder({
      executable: executable(root, 'ffmpeg'),
      jobDirectory: root,
      maximumAudioBytes: 4,
      maximumFrameBytes: 4,
      runner,
    });

    await expect(
      transcoder.extractAudio(mediaPath, { startMs: 0, endMs: 1_000 }),
    ).rejects.toMatchObject({ code: 'quota_exceeded' });
    await expect(transcoder.extractFrame(mediaPath, 0)).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
  });
});

describe('whisper.cpp ASR adapter', () => {
  it('parses the current JSON shape with millisecond offsets and safe metrics', async () => {
    const root = await fixtureDirectory();
    const audioPath = join(root, 'audio.wav');
    const modelPath = join(root, 'model.bin');
    await Promise.all([writeFile(audioPath, 'audio'), writeFile(modelPath, 'model')]);
    const runner = fakeRunner(async (command) => {
      expect(command.args).toEqual([
        '-m',
        modelPath,
        '-f',
        audioPath,
        '-l',
        'en',
        '-ojf',
        '-of',
        join(root, 'asr', 'transcript'),
        '-np',
      ]);
      await writeFile(
        join(root, 'asr', 'transcript.json'),
        JSON.stringify({
          params: { model: '/untrusted/claimed-model.bin' },
          result: { language: 'en' },
          transcription: [
            {
              offsets: { from: 0, to: 1_200 },
              text: ' Open the menu.',
              avg_logprob: -0.25,
              no_speech_prob: 0.1,
              compression_ratio: 1.2,
            },
            { offsets: { from: 1_200, to: 2_000 }, text: 'Add a sphere.' },
          ],
        }),
      );
    });
    const asr = createTutorialMediaAsr({
      executable: executable(root, 'whisper-cli'),
      jobDirectory: root,
      modelPath,
      runner,
    });
    const segments = await asr.transcribe(audioPath, 'en');
    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({
      confidence: null,
      endMs: 1_200,
      metrics: { averageLogProbability: -0.25, compressionRatio: 1.2, noSpeechProbability: 0.1 },
      order: 1,
      startMs: 0,
      text: 'Open the menu.',
    });
    expect(segments[0]!.segmentId).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it('maps an oversized transcript output to the pipeline quota error', async () => {
    const root = await fixtureDirectory();
    const audioPath = join(root, 'audio.wav');
    const modelPath = join(root, 'model.bin');
    await Promise.all([writeFile(audioPath, 'audio'), writeFile(modelPath, 'model')]);
    const runner = fakeRunner(async () => {
      await writeFile(join(root, 'asr', 'transcript.json'), Buffer.alloc(16 * 1_024 * 1_024 + 1));
    });
    const asr = createTutorialMediaAsr({
      executable: executable(root, 'whisper'),
      jobDirectory: root,
      modelPath,
      runner,
    });

    await expect(asr.transcribe(audioPath, 'en')).rejects.toMatchObject({
      code: 'quota_exceeded',
    });
  });

  it('rejects overlapping offsets and never trusts the declared model field', async () => {
    const root = await fixtureDirectory();
    const audioPath = join(root, 'audio.wav');
    const modelPath = join(root, 'model.bin');
    await Promise.all([writeFile(audioPath, 'audio'), writeFile(modelPath, 'model')]);
    const runner = fakeRunner(async () => {
      await writeFile(
        join(root, 'asr', 'transcript.json'),
        JSON.stringify({
          params: { model: modelPath },
          result: { language: 'en' },
          transcription: [
            { offsets: { from: 100, to: 200 }, text: 'one' },
            { offsets: { from: 150, to: 300 }, text: 'two' },
          ],
        }),
      );
    });
    const asr = createTutorialMediaAsr({
      executable: executable(root, 'whisper'),
      jobDirectory: root,
      modelPath,
      runner,
    });
    await expect(asr.transcribe(audioPath, 'en')).rejects.toMatchObject({ code: 'asr_failed' });
  });
});

describe('Tesseract OCR adapter', () => {
  const header =
    'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext';

  it('strictly parses TSV words and emits only normalized candidate shortcuts', async () => {
    const root = await fixtureDirectory();
    const framePath = join(root, 'frame.png');
    const tessdataDirectory = join(root, 'tessdata');
    await Promise.all([writeFile(framePath, 'png'), mkdir(tessdataDirectory)]);
    const tsv = [
      header,
      '5\t1\t1\t1\t1\t1\t10\t20\t40\t20\t95\tShift',
      '5\t1\t1\t1\t1\t2\t55\t20\t10\t20\t90\t+',
      '5\t1\t1\t1\t1\t3\t70\t20\t30\t20\t85\tCtrl',
      '5\t1\t1\t1\t1\t4\t105\t20\t10\t20\t80\tA',
      '5\t1\t1\t1\t2\t1\t10\t60\t60\t20\t75\tHyper+Q',
      '4\t1\t1\t1\t2\t0\t0\t0\t0\t0\t-1\t',
    ].join('\n');
    const runner = fakeRunner(async (command) => {
      expect(command.args).toEqual([
        framePath,
        'stdout',
        '--tessdata-dir',
        tessdataDirectory,
        '-l',
        'eng',
        '-c',
        'tessedit_create_tsv=1',
      ]);
      return { stdout: Buffer.from(tsv) };
    });
    const ocr = createTutorialMediaOcr({
      executable: executable(root, 'tesseract'),
      jobDirectory: root,
      runner,
      tessdataDirectory,
    });
    const result = await ocr.analyze({
      frameId: '9cc2ef5e-110f-49fa-b72d-1e047ca38bca',
      framePath,
      height: 100,
      locale: 'en',
      timestampMs: 2_000,
      width: 200,
    });
    expect(result.ocrCandidates).toHaveLength(5);
    expect(result.ocrCandidates[0]).toMatchObject({
      bounds: { height: 0.2, width: 0.2, x: 0.05, y: 0.2 },
      confidence: 0.95,
      text: 'Shift',
    });
    expect(result.shortcutCandidates).toHaveLength(1);
    expect(result.shortcutCandidates[0]).toMatchObject({
      confidence: 0.8,
      keys: ['Ctrl', 'Shift', 'A'],
      timestampMs: 2_000,
    });
    expect(parseCandidateShortcut('Alt + Ctrl + Delete')).toEqual(['Ctrl', 'Alt', 'Delete']);
    expect(parseCandidateShortcut('Hyper + Q')).toBeNull();
  });

  it('rejects non-12-column TSV and out-of-frame boxes', async () => {
    const root = await fixtureDirectory();
    const framePath = join(root, 'frame.png');
    const tessdataDirectory = join(root, 'tessdata');
    await Promise.all([writeFile(framePath, 'png'), mkdir(tessdataDirectory)]);
    const runner = fakeRunner(async () => ({
      stdout: Buffer.from(`${header}\n5\t1\t1\t1\t1\t1\t90\t0\t20\t10\t99\tA`),
    }));
    const ocr = createTutorialMediaOcr({
      executable: executable(root, 'tesseract'),
      jobDirectory: root,
      runner,
      tessdataDirectory,
    });
    await expect(
      ocr.analyze({
        frameId: '9cc2ef5e-110f-49fa-b72d-1e047ca38bca',
        framePath,
        height: 100,
        locale: 'en',
        timestampMs: 0,
        width: 100,
      }),
    ).rejects.toMatchObject({ code: 'ocr_failed' });
  });

  it('rejects unsafe, missing, non-directory, and symlink tessdata paths without invoking Tesseract', async () => {
    const root = await fixtureDirectory();
    const framePath = join(root, 'frame.png');
    const filePath = join(root, 'not-a-directory');
    const missingPath = join(root, 'missing-tessdata');
    const symlinkPath = join(root, 'linked-tessdata');
    const realDirectory = join(root, 'real-tessdata');
    await Promise.all([
      writeFile(framePath, 'png'),
      writeFile(filePath, 'not a directory'),
      mkdir(realDirectory),
    ]);
    await symlink(realDirectory, symlinkPath);
    const runner = fakeRunner(async () => undefined);
    const analyzeInput = {
      frameId: '9cc2ef5e-110f-49fa-b72d-1e047ca38bca',
      framePath,
      height: 100,
      locale: 'en',
      timestampMs: 0,
      width: 100,
    } as const;

    expect(() =>
      createTutorialMediaOcr({
        executable: executable(root, 'tesseract'),
        jobDirectory: root,
        runner,
        tessdataDirectory: 'relative/tessdata',
      }),
    ).toThrowError(expect.objectContaining({ code: 'invalid_input' }));

    for (const tessdataDirectory of [missingPath, filePath, symlinkPath]) {
      const ocr = createTutorialMediaOcr({
        executable: executable(root, 'tesseract'),
        jobDirectory: root,
        runner,
        tessdataDirectory,
      });
      const error = await ocr.analyze(analyzeInput).catch((value: unknown) => value);
      expect(error).toMatchObject({ code: 'invalid_input' });
      expect(String(error)).not.toContain(tessdataDirectory);
    }
    expect(runner.run).not.toHaveBeenCalled();
  });
});

describe('deterministic tutorial timeline', () => {
  const artifactUri = `operatingline-media://sha256/${'a'.repeat(64)}`;
  const frame = (frameId: string, timestampMs: number) => ({ artifactUri, frameId, timestampMs });

  it('segments on punctuation, long gaps, max duration, and shortcuts in gaps with bound evidence', () => {
    const result = segmentTutorialTimeline({
      asrSegments: [
        { segmentId: 'a', startMs: 0, endMs: 1_000, text: 'Open the menu.' },
        { segmentId: 'b', startMs: 1_100, endMs: 2_000, text: 'Choose Mesh' },
        { segmentId: 'c', startMs: 4_000, endMs: 5_000, text: 'Add a sphere' },
      ],
      frames: [frame('f1', 500), frame('f2', 1_500), frame('f3', 3_000), frame('f4', 4_500)],
      maximumSegmentDurationMs: 10_000,
      shortcutCandidates: [
        {
          candidateId: 's1',
          confidence: 0.9,
          frameId: 'f3',
          keys: ['Shift', 'A'],
          timestampMs: 3_000,
        },
      ],
      windowEndMs: 5_000,
      windowStartMs: 0,
    });
    expect(result.map((segment) => [segment.startMs, segment.endMs])).toEqual([
      [0, 1_000],
      [1_100, 2_000],
      [2_750, 3_250],
      [4_000, 5_000],
    ]);
    expect(result[2]).toMatchObject({
      canonicalDescription: 'Observed shortcut candidate: Shift+A',
      shortcutCandidateIds: ['s1'],
    });
    expect(
      result.every((segment, index) => segment.order === index + 1 && segment.evidence.length > 0),
    ).toBe(true);
  });

  it('creates bounded strictly increasing unique frame timestamps', () => {
    const timestamps = createTutorialFrameTimestamps({
      asrSegments: [
        { startMs: 0, endMs: 1_000 },
        { startMs: 1_000, endMs: 5_000 },
      ],
      intervalMs: 1_000,
      maximumFrames: 5,
      shortcutTimestampsMs: [2_500, 2_500],
      windowEndMs: 5_000,
      windowStartMs: 0,
    });
    expect(timestamps).toHaveLength(5);
    expect(timestamps.at(-1)).toBe(4_999);
    expect(new Set(timestamps).size).toBe(timestamps.length);
    expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right));
    expect(timestamps.every((value, index) => index === 0 || value > timestamps[index - 1]!)).toBe(
      true,
    );
  });

  it('falls back to transcript evidence when the bounded frame schedule misses a segment', () => {
    const transcriptArtifactUri = `operatingline-media://sha256/${'b'.repeat(64)}`;
    const result = segmentTutorialTimeline({
      asrSegments: [{ segmentId: 'a', startMs: 0, endMs: 1_000, text: 'First step.' }],
      frames: [frame('later', 9_000)],
      transcriptArtifactUri,
      windowEndMs: 10_000,
      windowStartMs: 0,
    });
    expect(result[0]!.evidence).toEqual([{ artifactUri: transcriptArtifactUri, timestampMs: 0 }]);
  });
});
