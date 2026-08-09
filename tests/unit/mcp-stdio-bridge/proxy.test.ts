import { describe, expect, it } from 'vitest';

import { loadMcpStdioBridgeConfig, parseLoopbackMcpUrl } from '@operatingline/mcp-stdio-bridge';

describe('MCP stdio bridge configuration', () => {
  it('accepts only an exact loopback MCP endpoint', () => {
    expect(parseLoopbackMcpUrl('http://127.0.0.1:43123/mcp/').href).toBe(
      'http://127.0.0.1:43123/mcp',
    );
    expect(parseLoopbackMcpUrl('http://[::1]:43123/mcp').hostname).toBe('[::1]');

    for (const endpoint of [
      'https://127.0.0.1:43123/mcp',
      'http://192.0.2.10:43123/mcp',
      'http://user:secret@127.0.0.1:43123/mcp',
      'http://127.0.0.1:43123/mcp?token=secret',
      'http://127.0.0.1:43123/api/v1/guide',
    ]) {
      expect(() => parseLoopbackMcpUrl(endpoint)).toThrow();
    }
  });

  it('requires a non-persisted token with a strict minimum length', () => {
    expect(
      loadMcpStdioBridgeConfig({
        OPERATINGLINE_ACCESS_TOKEN: 'local-token-with-16-plus-characters',
      }),
    ).toMatchObject({
      endpoint: new URL('http://127.0.0.1:43123/mcp'),
      accessToken: 'local-token-with-16-plus-characters',
    });
    expect(() => loadMcpStdioBridgeConfig({ OPERATINGLINE_ACCESS_TOKEN: 'short' })).toThrow(
      'at least 16 characters',
    );
    expect(() =>
      loadMcpStdioBridgeConfig({
        OPERATINGLINE_ACCESS_TOKEN: ' local-token-with-16-plus-characters ',
      }),
    ).toThrow('surrounding whitespace');
  });
});
