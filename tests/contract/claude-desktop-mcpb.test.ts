import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const manifestPath = resolve('distributions/claude-desktop/manifest.json');

describe('Claude Desktop MCPB contract', () => {
  it('uses the official manifest schema and a sensitive loopback-only configuration', () => {
    const source = readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(source) as {
      manifest_version?: string;
      server?: { mcp_config?: { env?: Record<string, string> } };
      user_config?: Record<string, { default?: string; sensitive?: boolean; required?: boolean }>;
      tools_generated?: boolean;
      prompts_generated?: boolean;
    };

    expect(manifest.manifest_version).toBe('0.4');
    expect(manifest.tools_generated).toBe(true);
    expect(manifest.prompts_generated).toBe(true);
    expect(manifest.user_config?.runtime_url).toMatchObject({
      default: 'http://127.0.0.1:43123/mcp',
      required: true,
    });
    expect(manifest.user_config?.access_token).toMatchObject({ sensitive: true, required: true });
    expect(manifest.server?.mcp_config?.env).toEqual({
      OPERATINGLINE_MCP_URL: '${user_config.runtime_url}',
      OPERATINGLINE_ACCESS_TOKEN: '${user_config.access_token}',
    });
    expect(source).not.toContain('replace-with-a-local-secret-token');
    expect(source).not.toMatch(/Bearer [A-Za-z0-9_-]{16,}/u);

    expect(() =>
      execFileSync('pnpm', ['exec', 'mcpb', 'validate', manifestPath], {
        cwd: resolve('.'),
        stdio: 'pipe',
      }),
    ).not.toThrow();
  });
});
