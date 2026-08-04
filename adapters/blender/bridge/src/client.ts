import { createConnection } from 'node:net';

const frameDelimiter = 0;
const defaultMaximumResponseBytes = 10 * 1024 * 1024;
const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);

export interface BlenderMcpBridgeOptions {
  host?: string;
  port?: number;
  timeoutMs?: number;
  maximumResponseBytes?: number;
}

export interface BlenderMcpBridgeResponse {
  status: 'ok' | 'error';
  result?: unknown;
  message?: string;
}

export type OperatingLineBlenderControl = 'start' | 'next' | 'back' | 'toggle_overlay';
const operatingLineControls = new Set<OperatingLineBlenderControl>([
  'start',
  'next',
  'back',
  'toggle_overlay',
]);

export class BlenderMcpBridgeClient {
  readonly host: string;
  readonly port: number;
  readonly timeoutMs: number;
  readonly maximumResponseBytes: number;

  constructor(options: BlenderMcpBridgeOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.port = options.port ?? 9876;
    this.timeoutMs = options.timeoutMs ?? 5_000;
    this.maximumResponseBytes = options.maximumResponseBytes ?? defaultMaximumResponseBytes;

    if (!loopbackHosts.has(this.host)) {
      throw new Error('Blender MCP bridge only permits loopback hosts');
    }
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65_535) {
      throw new Error('Blender MCP bridge port must be an integer between 1 and 65535');
    }
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) {
      throw new Error('Blender MCP bridge timeout must be a positive integer');
    }
    if (!Number.isSafeInteger(this.maximumResponseBytes) || this.maximumResponseBytes < 1) {
      throw new Error('Blender MCP bridge response limit must be a positive integer');
    }
  }

  async invokeOperatingLineControl(
    control: OperatingLineBlenderControl,
  ): Promise<BlenderMcpBridgeResponse> {
    if (!operatingLineControls.has(control)) {
      throw new Error(`Unsupported OperatingLine Blender control: ${String(control)}`);
    }
    const operatorName = JSON.stringify(control);
    const code = [
      'import bpy',
      `operator = getattr(bpy.ops.operating_line, ${operatorName})`,
      "result = {'outcome': sorted(operator())}",
    ].join('\n');
    return this.executeInternal(code);
  }

  private executeInternal(code: string): Promise<BlenderMcpBridgeResponse> {
    const request = Buffer.from(
      `${JSON.stringify({ type: 'execute', code, strict_json: true })}\0`,
      'utf8',
    );

    return new Promise((resolve, reject) => {
      const socket = createConnection({ host: this.host, port: this.port });
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      let settled = false;

      const settle = (callback: () => void): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(deadline);
        socket.destroy();
        callback();
      };
      const succeed = (value: BlenderMcpBridgeResponse): void => settle(() => resolve(value));
      const fail = (error: Error): void => settle(() => reject(error));
      const deadline = setTimeout(
        () => fail(new Error('Blender MCP bridge request timed out')),
        this.timeoutMs,
      );

      socket.once('connect', () => socket.write(request));
      socket.on('data', (chunk: Buffer) => {
        const delimiterIndex = chunk.indexOf(frameDelimiter);
        const framePart = delimiterIndex === -1 ? chunk : chunk.subarray(0, delimiterIndex);
        receivedBytes += framePart.length;
        if (receivedBytes > this.maximumResponseBytes) {
          fail(new Error('Blender MCP bridge response exceeded the size limit'));
          return;
        }
        chunks.push(framePart);
        if (delimiterIndex === -1) {
          return;
        }

        try {
          const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!isBridgeResponse(parsed)) {
            throw new Error('Blender MCP bridge returned an invalid response');
          }
          succeed(parsed);
        } catch (error) {
          fail(error instanceof Error ? error : new Error(String(error)));
        }
      });
      socket.once('error', fail);
      socket.once('end', () => {
        if (!settled) {
          fail(new Error('Blender MCP bridge closed before a complete response'));
        }
      });
    });
  }
}

function isBridgeResponse(value: unknown): value is BlenderMcpBridgeResponse {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const status = Reflect.get(value, 'status');
  const message = Reflect.get(value, 'message');
  return (
    (status === 'ok' || status === 'error') &&
    (message === undefined || typeof message === 'string')
  );
}
