import type {
  ActionBinding,
  AdapterCapabilities,
  AdapterStatus,
  ObservationExpectation,
  SemanticAnchor,
} from '@operatingline/protocol';

export type { AdapterCapabilities, AdapterStatus } from '@operatingline/protocol';

export interface AdapterActionResult {
  attemptId: string;
  succeeded: boolean;
  observations: unknown[];
  error?: string;
}

export interface AppAdapter {
  readonly id: string;
  readonly version: string;
  readonly capabilities: AdapterCapabilities;
  getStatus(): Promise<AdapterStatus>;
  execute?(action: ActionBinding): Promise<AdapterActionResult>;
  resolveAnchor?(anchor: SemanticAnchor): Promise<unknown>;
  observe?(expectation: ObservationExpectation): Promise<unknown>;
}
