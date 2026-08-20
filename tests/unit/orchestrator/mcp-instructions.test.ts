import { describe, expect, it } from 'vitest';

import { operatingLineMcpInstructions } from '@operatingline/orchestrator';

describe('OperatingLine MCP instructions', () => {
  it('keeps the safe host-goal workflow self-contained in the first 512 characters', () => {
    const firstParagraph = operatingLineMcpInstructions.split('\n\n', 1)[0];
    const firstClientPreview = operatingLineMcpInstructions.slice(0, 512);

    expect(firstParagraph.length).toBeLessThanOrEqual(512);
    expect(firstClientPreview).toContain('operatingline.goal.requests.list');
    expect(firstClientPreview).toContain('operatingline.goal.prompt.get');
    expect(firstClientPreview).toContain('operatingline.planning.evaluate');
    expect(firstClientPreview).toContain('operatingline.guide.propose');
    expect(firstClientPreview).toContain('Never send model output to operatingline.guide.publish');
    expect(firstClientPreview).toContain('only enters Blender review');
    expect(firstClientPreview).toContain('Guide proposals never permit host execution');
    expect(operatingLineMcpInstructions).toContain('operatingline.procedure.tutorial.import');
    expect(operatingLineMcpInstructions).toContain('operatingline.procedure.tutorial.generate');
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.procedure.tutorial.youtube.import',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.procedure.tutorial.youtube.tracks.list',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.procedure.tutorial.youtube.tracks.recommend',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.procedure.tutorial.youtube.tracks.select',
    );
    expect(operatingLineMcpInstructions).toContain('documented 50-unit captions.list cost');
    expect(operatingLineMcpInstructions).toContain('neither listing nor recommendation selects');
    expect(operatingLineMcpInstructions).toContain(
      'without another network request, quota charge, caption download, or model call',
    );
    expect(operatingLineMcpInstructions).toContain(
      'whether it accepted or overrode the recomputed recommendation',
    );
    expect(operatingLineMcpInstructions).toContain(
      'reason note is retained in the local evidence ledger',
    );
    expect(operatingLineMcpInstructions).toContain('cannot fetch arbitrary public-video captions');
    expect(operatingLineMcpInstructions).toContain(
      'send its normalized cues and task context to that Provider',
    );
    expect(operatingLineMcpInstructions).toContain(
      'neither stores the tree, creates a Proposal, or executes the host',
    );
    expect(operatingLineMcpInstructions).toContain('operatingline.blender.action.execute');
    expect(operatingLineMcpInstructions).toContain('operatingline.blender.action.status');
    expect(operatingLineMcpInstructions).toContain('accepted and started, untouched');
    expect(operatingLineMcpInstructions).toContain(
      'UV Sphere, Icosphere, Cube, Plane, Torus, Cone, or Cylinder replays',
    );
    expect(operatingLineMcpInstructions).toContain(
      'every other action-level MCP path remains unavailable',
    );
    expect(operatingLineMcpInstructions).toContain(
      'never accepts arbitrary actions, Python, plan ids, step ids, or action parameters',
    );
    expect(operatingLineMcpInstructions).toContain(
      'recovery_required means delivery became indeterminate',
    );
    expect(operatingLineMcpInstructions).toContain(
      'recovery_required never replays input automatically',
    );
    expect(operatingLineMcpInstructions).toContain('native_terminal_reconcile');
    expect(operatingLineMcpInstructions).toContain(
      'bound to the polling replacement lease and rotates its recovery id',
    );
    expect(operatingLineMcpInstructions).toContain(
      'native_history_rebind as the strict suffix after the server current result',
    );
    expect(operatingLineMcpInstructions).toContain(
      'revalidates local authority before every timer turn',
    );
    expect(operatingLineMcpInstructions).toContain(
      'new Blender OS process never inherit the old instanceId or target lease',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.procedure.shortcut-proof.propose',
    );
    expect(operatingLineMcpInstructions).toContain('operatingline.blender.shortcut-proof.execute');
    expect(operatingLineMcpInstructions).toContain('operatingline.blender.shortcut-proof.status');
    expect(operatingLineMcpInstructions).toContain(
      'callers cannot submit raw events, keys, coordinates, operators, RNA, Python',
    );
    expect(operatingLineMcpInstructions).toContain(
      'managedActionResult as not_executed and managedIdentityVerified as false',
    );
    expect(operatingLineMcpInstructions).toContain('native Redo reports reapplied_locked');
    expect(operatingLineMcpInstructions).toContain(
      'a failure checkpoint never becomes success evidence',
    );
    expect(operatingLineMcpInstructions).not.toContain('the MCP track remains unavailable');
  });
});
