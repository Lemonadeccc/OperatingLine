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
    expect(operatingLineMcpInstructions).not.toContain('the MCP track remains unavailable');
  });
});
