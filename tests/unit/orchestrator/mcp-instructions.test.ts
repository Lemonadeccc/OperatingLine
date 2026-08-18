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
    expect(firstClientPreview).toContain('never permits host execution');
    expect(operatingLineMcpInstructions).toContain('operatingline.procedure.tutorial.import');
    expect(operatingLineMcpInstructions).toContain('operatingline.procedure.tutorial.generate');
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.procedure.tutorial.youtube.import',
    );
    expect(operatingLineMcpInstructions).toContain('cannot fetch arbitrary public-video captions');
    expect(operatingLineMcpInstructions).toContain(
      'send its normalized cues and task context to that Provider',
    );
    expect(operatingLineMcpInstructions).toContain(
      'neither stores the tree, creates a Proposal, or executes the host',
    );
  });
});
