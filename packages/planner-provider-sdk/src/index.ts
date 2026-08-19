import type {
  PlannerDialoguePromptPacket,
  PlannerDialogueProviderResult,
  PlannerProviderDescriptor,
  PlannerProviderCostPolicy,
  PlannerProviderRuntimeProfile,
  PlanningPromptPacket,
  ProcedureAuthoringPromptPacket,
  ProcedureRefinementDialoguePromptPacket,
  ProcedureRefinementDialogueProviderResult,
  ProcedureRefinementPromptPacket,
  ReplanningPromptPacket,
} from '@operatingline/protocol';

export type PlannerProviderRuntimeOperation =
  | 'initial_plan'
  | 'local_replan'
  | 'procedure_authoring'
  | 'procedure_embedding'
  | 'procedure_refinement_dialogue'
  | 'procedure_refinement';

export interface PlannerProviderRuntimeTreatmentDescription {
  readonly profile: PlannerProviderRuntimeProfile;
  readonly generationSettings: {
    readonly normalizedParameters: Readonly<Record<string, unknown>>;
    readonly seed: number | null;
    readonly determinism: 'deterministic' | 'seeded_best_effort' | 'non_deterministic' | 'unknown';
  };
  readonly costPolicy?: PlannerProviderCostPolicy;
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

export const plannerProviderProcedureEmbeddingMaximumDocuments = 257 as const;
export const plannerProviderProcedureEmbeddingMaximumDocumentCharacters = 32_768 as const;

export interface PlannerProviderProcedureEmbeddingInput {
  readonly requestId: string;
  readonly documents: readonly string[];
  readonly signal: AbortSignal;
}

export interface PlannerProviderProcedureEmbeddingResult {
  readonly vectors: readonly (readonly number[])[];
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

export interface PlannerProviderProcedureRefinementDialogueInput {
  readonly requestId: string;
  readonly packet: ProcedureRefinementDialoguePromptPacket;
  readonly signal: AbortSignal;
  readonly emit: (event: PlannerProviderDialogueTextDelta) => void;
}

export interface PlannerProviderProcedureRefinementInput {
  readonly requestId: string;
  readonly packet: ProcedureRefinementPromptPacket;
  readonly signal: AbortSignal;
}

export interface PlannerProvider {
  readonly descriptor: PlannerProviderDescriptor;
  describeRuntimeTreatment?(
    operation: PlannerProviderRuntimeOperation,
  ): PlannerProviderRuntimeTreatmentDescription;
  generate(input: PlannerProviderGenerateInput): Promise<unknown>;
  authorProcedure?(input: PlannerProviderProcedureAuthoringInput): Promise<unknown>;
  embedProcedure?(
    input: PlannerProviderProcedureEmbeddingInput,
  ): Promise<PlannerProviderProcedureEmbeddingResult>;
  replan?(input: PlannerProviderReplanInput): Promise<unknown>;
  dialogue?(input: PlannerProviderDialogueInput): Promise<PlannerDialogueProviderResult>;
  procedureRefinementDialogue?(
    input: PlannerProviderProcedureRefinementDialogueInput,
  ): Promise<ProcedureRefinementDialogueProviderResult>;
  refineProcedure?(input: PlannerProviderProcedureRefinementInput): Promise<unknown>;
  close?(): void | Promise<void>;
}

export type {
  PlannerDialoguePromptPacket,
  PlannerDialogueProviderResult,
  PlannerProviderDescriptor,
  PlannerProviderCostPolicy,
  PlannerProviderRuntimeProfile,
  PlanningPromptPacket,
  ProcedureAuthoringPromptPacket,
  ProcedureRefinementDialoguePromptPacket,
  ProcedureRefinementDialogueProviderResult,
  ProcedureRefinementPromptPacket,
  ReplanningPromptPacket,
} from '@operatingline/protocol';
