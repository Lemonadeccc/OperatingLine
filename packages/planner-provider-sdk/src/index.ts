import type {
  PlannerProviderDescriptor,
  PlanningPromptPacket,
  ReplanningPromptPacket,
} from '@operatingline/protocol';

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

export interface PlannerProvider {
  readonly descriptor: PlannerProviderDescriptor;
  generate(input: PlannerProviderGenerateInput): Promise<unknown>;
  replan?(input: PlannerProviderReplanInput): Promise<unknown>;
  close?(): void | Promise<void>;
}

export type {
  PlannerProviderDescriptor,
  PlanningPromptPacket,
  ReplanningPromptPacket,
} from '@operatingline/protocol';
