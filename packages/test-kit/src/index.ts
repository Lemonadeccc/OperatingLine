import type { AdapterCapabilities, AppAdapter } from '@operatingline/adapter-sdk';
import { guideProtocolVersion, type AdapterStatus } from '@operatingline/protocol';

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
