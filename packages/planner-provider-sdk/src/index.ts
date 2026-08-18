import type {
  PlannerDialoguePromptPacket,
  PlannerDialogueProviderResult,
  PlannerProviderDescriptor,
  PlannerProviderRuntimeProfile,
  PlanningPromptPacket,
  ProcedureAuthoringPromptPacket,
  ReplanningPromptPacket,
} from '@operatingline/protocol';

export type PlannerProviderRuntimeOperation =
  'initial_plan' | 'local_replan' | 'procedure_authoring';

export interface PlannerProviderRuntimeTreatmentDescription {
  readonly profile: PlannerProviderRuntimeProfile;
  readonly generationSettings: {
    readonly normalizedParameters: Readonly<Record<string, unknown>>;
    readonly seed: number | null;
    readonly determinism: 'deterministic' | 'seeded_best_effort' | 'non_deterministic' | 'unknown';
  };
}

export interface PlannerProviderGenerateInput {
  readonly requestId: string;
  readonly packet: PlanningPromptPacket;
  readonly signal: AbortSignal;
}

export interface PlannerProviderReplanInput {
  readonly requestId: string;
  readonly packet: ReplanningPromptPacket;
  readonly signal: AbortSignal;
}

export interface PlannerProviderProcedureAuthoringInput {
  readonly requestId: string;
  readonly packet: ProcedureAuthoringPromptPacket;
  readonly renderedPrompt: string;
  readonly signal: AbortSignal;
}

export interface PlannerProviderDialogueTextDelta {
  readonly type: 'assistant_text_delta';
  readonly delta: string;
}

export interface PlannerProviderDialogueInput {
  readonly requestId: string;
  readonly packet: PlannerDialoguePromptPacket;
  readonly signal: AbortSignal;
  readonly emit: (event: PlannerProviderDialogueTextDelta) => void;
}

export interface PlannerProvider {
  readonly descriptor: PlannerProviderDescriptor;
  describeRuntimeTreatment?(
    operation: PlannerProviderRuntimeOperation,
  ): PlannerProviderRuntimeTreatmentDescription;
  generate(input: PlannerProviderGenerateInput): Promise<unknown>;
  authorProcedure?(input: PlannerProviderProcedureAuthoringInput): Promise<unknown>;
  replan?(input: PlannerProviderReplanInput): Promise<unknown>;
  dialogue?(input: PlannerProviderDialogueInput): Promise<PlannerDialogueProviderResult>;
  close?(): void | Promise<void>;
}

export type {
  PlannerDialoguePromptPacket,
  PlannerDialogueProviderResult,
  PlannerProviderDescriptor,
  PlannerProviderRuntimeProfile,
  PlanningPromptPacket,
  ProcedureAuthoringPromptPacket,
  ReplanningPromptPacket,
} from '@operatingline/protocol';
