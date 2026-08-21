import {
  validateProcedureTutorialMediaRecognitionArtifactIntegrity,
  type ProcedureTutorialMediaRecognitionArtifact,
  type ProcedureTutorialMediaRecognitionArtifactContent,
  type ProcedureTutorialMediaRecognitionProvenance,
} from '@operatingline/protocol';

import {
  recognitionSha256,
  type RecognizerIsolationAttestation,
} from './tutorial-media-process-isolation.js';
import {
  runTutorialMediaUiRecognizer,
  type RecognizerFrameInput,
  type RecognizerIsolationSupervisorDescriptor,
} from './tutorial-media-ui-recognizer-process.js';
import type { RecognizerIsolationSupervisor } from './tutorial-media-process-isolation.js';

export const tutorialMediaRecognitionStageContract = Object.freeze({
  stage: 'recognition' as const,
  predecessor: 'ocr' as const,
  successor: 'segmentation' as const,
  artifactKind: 'ui_recognition_observations' as const,
  contractVersion: '1.0.0' as const,
});

export type TutorialMediaUiRecognitionProvenance = ProcedureTutorialMediaRecognitionProvenance;
export type TutorialMediaUiRecognitionArtifactContent =
  ProcedureTutorialMediaRecognitionArtifactContent;
export type TutorialMediaUiRecognitionArtifact = ProcedureTutorialMediaRecognitionArtifact;

function artifactProvenance(
  descriptor: RecognizerIsolationSupervisorDescriptor,
  attestation: RecognizerIsolationAttestation,
): TutorialMediaUiRecognitionProvenance {
  return {
    adapterId: descriptor.adapterId,
    adapterVersion: descriptor.adapterVersion,
    modelId: descriptor.modelId,
    modelVersion: descriptor.modelVersion,
    executableSha256: descriptor.executableSha256,
    modelSha256: descriptor.modelSha256,
    licenseId: descriptor.licenseId,
    licenseSha256: descriptor.licenseSha256,
    configSha256: descriptor.configSha256,
    versionOutputSha256: descriptor.versionOutputSha256,
    locale: descriptor.locale,
    platform: descriptor.platform,
    isolationBackendId: attestation.backendId,
    isolationBackendVersion: attestation.backendVersion,
    isolationBackendVersionSha256: attestation.backendVersionSha256,
    supervisorSha256: attestation.supervisorSha256,
    isolationPolicySha256: attestation.policySha256,
    isolationAttestationSha256: attestation.attestationSha256,
  };
}

export async function recognizeTutorialMediaUi(options: {
  readonly descriptor: RecognizerIsolationSupervisorDescriptor;
  readonly supervisor: RecognizerIsolationSupervisor;
  readonly frames: readonly RecognizerFrameInput[];
  readonly signal?: AbortSignal;
}): Promise<TutorialMediaUiRecognitionArtifact> {
  const result = await runTutorialMediaUiRecognizer(options);
  const content: TutorialMediaUiRecognitionArtifactContent = {
    formatVersion: '1.0.0',
    artifactKind: 'ui_recognition_observations',
    stage: 'recognition',
    input: {
      frames: options.frames
        .map((frame) => ({
          frameId: frame.frameId,
          frameSha256: frame.frameSha256,
          ocrArtifactSha256: frame.ocrArtifactSha256,
          ocrCandidatesSha256: frame.ocrCandidatesSha256,
          timestampMs: frame.timestampMs,
        }))
        .sort((left, right) => left.frameId.localeCompare(right.frameId)),
    },
    observations: {
      uiCandidates: [...result.uiCandidates].sort((left, right) =>
        left.candidateId.localeCompare(right.candidateId),
      ),
      keyCandidates: result.keyCandidates
        .map((candidate) => ({ ...candidate, normalizedKeys: [...candidate.normalizedKeys] }))
        .sort((left, right) => left.candidateId.localeCompare(right.candidateId)),
    },
    provenance: artifactProvenance(options.descriptor, result.isolationAttestation),
  };
  return await validateProcedureTutorialMediaRecognitionArtifactIntegrity({
    ...content,
    contentSha256: recognitionSha256(content),
  });
}
