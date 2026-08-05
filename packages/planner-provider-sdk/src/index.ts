import type { PlannerProviderDescriptor, PlanningPromptPacket } from '@operatingline/protocol';

export interface PlannerProviderGenerateInput {
  readonly requestId: string;
  readonly packet: PlanningPromptPacket;
  readonly signal: AbortSignal;
}

export interface PlannerProvider {
  readonly descriptor: PlannerProviderDescriptor;
  generate(input: PlannerProviderGenerateInput): Promise<unknown>;
  close?(): void | Promise<void>;
}

export type { PlannerProviderDescriptor, PlanningPromptPacket } from '@operatingline/protocol';
