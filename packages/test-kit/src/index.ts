import type { AdapterCapabilities, AppAdapter } from '@operatingline/adapter-sdk';
import type {
  PlannerProvider,
  PlannerProviderGenerateInput,
} from '@operatingline/planner-provider-sdk';
import {
  guideProtocolVersion,
  plannerProviderContractVersion,
  type AdapterStatus,
  type PlannerProviderDescriptor,
} from '@operatingline/protocol';

export class FakeBlenderAdapter implements AppAdapter {
  readonly id = 'fake-blender';
  readonly version = '0.1.0';
  readonly capabilities: AdapterCapabilities = {
    presentation: {
      taskTree: 'native',
      viewportOverlay: 'native',
      interactiveAnchors: 'emulated',
    },
    execution: {
      inspect: 'native',
      invokeActions: 'native',
      screenshot: 'native',
      rollbackModes: ['native_undo', 'checkpoint_restore'],
    },
    runtime: {
      dispatch: 'main_thread_serial',
      network: 'native',
      persistentProjectState: 'native',
    },
  };

  async getStatus(): Promise<AdapterStatus> {
    return {
      id: this.id,
      version: this.version,
      hostVersion: 'test',
      protocolVersions: [guideProtocolVersion],
      connected: true,
      capabilities: this.capabilities,
    };
  }
}

export type FakePlannerProviderHandler = (
  input: PlannerProviderGenerateInput,
) => unknown | Promise<unknown>;

export class FakePlannerProvider implements PlannerProvider {
  readonly descriptor: PlannerProviderDescriptor;
  readonly inputs: PlannerProviderGenerateInput[] = [];
  closeCalls = 0;
  private readonly handler: FakePlannerProviderHandler;

  constructor(
    handler: FakePlannerProviderHandler,
    descriptor: PlannerProviderDescriptor = {
      contractVersion: plannerProviderContractVersion,
      id: 'fake-planner',
      version: '0.1.0',
      displayName: 'Fake Planner',
      description: 'Deterministic planner provider for OperatingLine tests.',
      availability: { available: true },
      limits: { maxConcurrency: 1 },
      dataHandling: {
        executionLocation: 'local',
        dataTransmission: 'none',
        credentialManagement: 'provider_managed',
      },
    },
  ) {
    this.handler = handler;
    this.descriptor = descriptor;
  }

  async generate(input: PlannerProviderGenerateInput): Promise<unknown> {
    this.inputs.push(input);
    return this.handler(input);
  }

  close(): void {
    this.closeCalls += 1;
  }
}
