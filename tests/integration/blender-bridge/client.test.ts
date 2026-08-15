import { createServer } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { BlenderMcpBridgeClient } from '@operatingline/blender-mcp-bridge';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

describe('Blender MCP TCP bridge', () => {
  it('uses the installed extension framing while exposing only allow-listed controls', async () => {
    let request = '';
    const server = createServer((socket) => {
      socket.on('data', (chunk) => {
        request += chunk.toString('utf8');
        if (!request.includes('\0')) {
          return;
        }
        socket.end(`${JSON.stringify({ status: 'ok', result: { outcome: ['FINISHED'] } })}\0`);
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not return a TCP address');
    }

    const client = new BlenderMcpBridgeClient({ port: address.port });
    await expect(client.invokeOperatingLineControl('next')).resolves.toMatchObject({
      status: 'ok',
      result: { outcome: ['FINISHED'] },
    });

    const parsed = JSON.parse(request.slice(0, request.indexOf('\0'))) as {
      type: string;
      code: string;
      strict_json: boolean;
    };
    expect(parsed).toMatchObject({ type: 'execute', strict_json: true });
    expect(parsed.code).toContain('bpy.ops.operating_line');
    expect(parsed.code).toContain('"next"');
  });

  it('rejects remote hosts', () => {
    expect(() => new BlenderMcpBridgeClient({ host: '192.0.2.1' })).toThrow(
      'only permits loopback hosts',
    );
  });

  it('rejects controls outside the OperatingLine allow-list before connecting', async () => {
    const client = new BlenderMcpBridgeClient();
    await expect(client.invokeOperatingLineControl('arbitrary_python' as never)).rejects.toThrow(
      'Unsupported OperatingLine Blender control',
    );
  });

  it('handles fragmented frames and rejects oversized responses', async () => {
    const fragmentedServer = createServer((socket) => {
      socket.once('data', () => {
        socket.write('{"status":"ok",');
        socket.end('"result":true}\0');
      });
    });
    servers.push(fragmentedServer);
    await new Promise<void>((resolve) => fragmentedServer.listen(0, '127.0.0.1', resolve));
    const fragmentedAddress = fragmentedServer.address();
    if (!fragmentedAddress || typeof fragmentedAddress === 'string') {
      throw new Error('Test server did not return a TCP address');
    }
    await expect(
      new BlenderMcpBridgeClient({ port: fragmentedAddress.port }).invokeOperatingLineControl(
        'start',
      ),
    ).resolves.toMatchObject({ status: 'ok', result: true });

    const oversizedServer = createServer((socket) => {
      socket.once('data', () => socket.end('{"status":"ok"}\0'));
    });
    servers.push(oversizedServer);
    await new Promise<void>((resolve) => oversizedServer.listen(0, '127.0.0.1', resolve));
    const oversizedAddress = oversizedServer.address();
    if (!oversizedAddress || typeof oversizedAddress === 'string') {
      throw new Error('Test server did not return a TCP address');
    }
    await expect(
      new BlenderMcpBridgeClient({
        port: oversizedAddress.port,
        maximumResponseBytes: 4,
      }).invokeOperatingLineControl('start'),
    ).rejects.toThrow('exceeded the size limit');
  });

  it('rejects invalid transport limits', () => {
    expect(() => new BlenderMcpBridgeClient({ timeoutMs: 0 })).toThrow(
      'timeout must be a positive integer',
    );
    expect(() => new BlenderMcpBridgeClient({ maximumResponseBytes: Number.NaN })).toThrow(
      'response limit must be a positive integer',
    );
  });

  it('enforces a wall-clock timeout against slow-drip responses', async () => {
    let resolveSocketClosed: (() => void) | undefined;
    const socketClosed = new Promise<void>((resolve) => {
      resolveSocketClosed = resolve;
    });
    let unexpectedSocketError: Error | undefined;
    const server = createServer((socket) => {
      socket.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code !== 'ECONNRESET' && error.code !== 'EPIPE') {
          unexpectedSocketError = error;
        }
      });
      socket.once('close', () => resolveSocketClosed?.());
      socket.once('data', () => {
        const response = `${JSON.stringify({ status: 'ok', result: true })}\0`;
        let index = 0;
        const interval = setInterval(() => {
          if (index >= response.length) {
            clearInterval(interval);
            socket.end();
            return;
          }
          socket.write(response[index]);
          index += 1;
        }, 10);
        socket.once('close', () => clearInterval(interval));
      });
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Test server did not return a TCP address');
    }

    await expect(
      new BlenderMcpBridgeClient({ port: address.port, timeoutMs: 30 }).invokeOperatingLineControl(
        'start',
      ),
    ).rejects.toThrow('request timed out');
    await socketClosed;
    expect(unexpectedSocketError).toBeUndefined();
  });
});
