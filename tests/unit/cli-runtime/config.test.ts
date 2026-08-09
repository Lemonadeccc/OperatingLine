import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadCliRuntimeConfig } from '../../../services/cli-runtime/src/config.js';

const requiredEnvironment = {
  OPERATINGLINE_ACCESS_TOKEN: 'local-access-token-value',
};

describe('local AI client runtime configuration', () => {
  it('uses bounded defaults and does not require provider API keys', () => {
    expect(loadCliRuntimeConfig(requiredEnvironment)).toEqual({
      accessToken: 'local-access-token-value',
      databasePath: resolve('.data/operating-line-cli.db'),
      port: 0,
      plannerProviderTimeoutMs: 120_000,
      codex: { executable: 'codex' },
      claude: { executable: 'claude', maximumBudgetUsd: 1 },
    });
    expect(() => loadCliRuntimeConfig({})).toThrow('OPERATINGLINE_ACCESS_TOKEN');
    expect(() => loadCliRuntimeConfig({ OPERATINGLINE_ACCESS_TOKEN: 'short' })).toThrow(
      'at least 16 characters',
    );
    expect(() =>
      loadCliRuntimeConfig({
        OPERATINGLINE_ACCESS_TOKEN: ' local-access-token-value ',
      }),
    ).toThrow('surrounding whitespace');
  });

  it('loads explicit executable, model, budget, timeout, database, and port values', () => {
    expect(
      loadCliRuntimeConfig({
        ...requiredEnvironment,
        OPERATINGLINE_DATABASE_PATH: 'tmp/clients.db',
        OPERATINGLINE_PORT: '43123',
        OPERATINGLINE_PLANNER_TIMEOUT_MS: '90000',
        OPERATINGLINE_CODEX_BIN: '/opt/codex/bin/codex',
        OPERATINGLINE_CODEX_MODEL: 'gpt-explicit',
        OPERATINGLINE_CLAUDE_BIN: '/opt/claude/bin/claude',
        OPERATINGLINE_CLAUDE_MODEL: 'claude-explicit',
        OPERATINGLINE_CLAUDE_MAX_BUDGET_USD: '0.75',
      }),
    ).toEqual({
      accessToken: 'local-access-token-value',
      databasePath: resolve('tmp/clients.db'),
      port: 43_123,
      plannerProviderTimeoutMs: 90_000,
      codex: { executable: '/opt/codex/bin/codex', model: 'gpt-explicit' },
      claude: {
        executable: '/opt/claude/bin/claude',
        model: 'claude-explicit',
        maximumBudgetUsd: 0.75,
      },
    });
  });

  it('rejects unsafe or out-of-range settings before the runtime starts', () => {
    for (const port of ['-1', '1.5', '65536', 'not-a-port']) {
      expect(() =>
        loadCliRuntimeConfig({ ...requiredEnvironment, OPERATINGLINE_PORT: port }),
      ).toThrow('OPERATINGLINE_PORT');
    }
    for (const timeout of ['99', '120001', '1.5']) {
      expect(() =>
        loadCliRuntimeConfig({
          ...requiredEnvironment,
          OPERATINGLINE_PLANNER_TIMEOUT_MS: timeout,
        }),
      ).toThrow('OPERATINGLINE_PLANNER_TIMEOUT_MS');
    }
    for (const budget of ['0', '100.01', 'NaN']) {
      expect(() =>
        loadCliRuntimeConfig({
          ...requiredEnvironment,
          OPERATINGLINE_CLAUDE_MAX_BUDGET_USD: budget,
        }),
      ).toThrow('OPERATINGLINE_CLAUDE_MAX_BUDGET_USD');
    }
    expect(() =>
      loadCliRuntimeConfig({
        ...requiredEnvironment,
        OPERATINGLINE_CODEX_BIN: ' codex ',
      }),
    ).toThrow('executable');
  });
});
