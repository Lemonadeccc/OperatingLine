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
      'bounded 9-action current whole-action Blender set',
    );
    expect(operatingLineMcpInstructions).toContain('seven mesh primitives');
    expect(operatingLineMcpInstructions).toContain('one replacement-mesh Edit action (Subdivide)');
    expect(operatingLineMcpInstructions).toContain('Subdivision Surface');
    expect(operatingLineMcpInstructions).toContain(
      'one no-bake, no-render light-trails lookdev scene',
    );
    expect(operatingLineMcpInstructions).toContain(
      'every other action-level MCP path remains unavailable',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.geometry-nodes.light-trails.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.geometry-nodes.light-trails.status',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.animation.pose-keyframes.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.animation.pose-keyframes.status',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.rig.armature.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain('operatingline.blender.rig.armature.status');
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.rig.skin-weights.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain('operatingline.blender.rig.skin-weights.status');
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.modifier.solidify.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.modifier.solidify.status',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.modifier.bevel.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain('operatingline.blender.modifier.bevel.status');
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.modifier.subdivision-surface.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.modifier.subdivision-surface.status',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.modifier.mirror.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain('operatingline.blender.modifier.mirror.status');
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.mesh.edit-bevel-edges.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.mesh.edit-bevel-edges.status',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.mesh.edit-inset-faces.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.mesh.edit-inset-faces.status',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.mesh.edit-triangulate.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.mesh.edit-triangulate.status',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.mesh.edit-extrude-region.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.mesh.edit-extrude-region.status',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.mesh.edit-poke-faces.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.mesh.edit-poke-faces.status',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.material.single.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain('operatingline.blender.material.single.status');
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.material.palette.execute-next',
    );
    expect(operatingLineMcpInstructions).toContain('operatingline.blender.material.palette.status');
    expect(operatingLineMcpInstructions).toContain(
      'Transform Geometry, no-bake Light Trails, Pose Animation, Armature, Skin Weights, Solidify, Bevel Modifier, Single Material, Material Palette, Subdivision Surface, Mirror, Edit Bevel, Edit Inset, Edit Triangulate, Extrude Region, and Edit Poke',
    );
    expect(operatingLineMcpInstructions).toContain('sixteen bounded operation-level MCP leaves');
    expect(operatingLineMcpInstructions).toContain(
      'Material Palette operation 03 carries the complete accepted materials array without mutating Blender',
    );
    expect(operatingLineMcpInstructions).toContain('twelve times');
    expect(operatingLineMcpInstructions).toContain('fifty-four times');
    expect(operatingLineMcpInstructions).toContain('nine times');
    expect(operatingLineMcpInstructions).toContain('four times');
    expect(operatingLineMcpInstructions).toContain('seven times');
    expect(operatingLineMcpInstructions).toContain('six times');
    expect(operatingLineMcpInstructions).toContain('[V+L, E+2L, F+L]');
    expect(operatingLineMcpInstructions).toContain('[V, E+L-3F, L-2F]');
    expect(operatingLineMcpInstructions).toContain(
      '[V+selectedVertexCount, E+selectedEdgeCount+boundaryEdgeCount, F+boundaryEdgeCount]',
    );
    expect(operatingLineMcpInstructions).toContain('[V+F, E+L, L]');
    expect(operatingLineMcpInstructions).toContain('triangle-only output');
    expect(operatingLineMcpInstructions).toContain('finite nondegenerate result');
    expect(operatingLineMcpInstructions).toContain('unique checkpoint lineage');
    expect(operatingLineMcpInstructions).toContain('real float32 host representation');
    expect(operatingLineMcpInstructions).toContain(
      'never accepts arbitrary actions, Python, plan ids, step ids, or action arguments',
    );
    expect(operatingLineMcpInstructions).toContain(
      'menu tracks, and shortcut tracks are not action execution proof',
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
    expect(operatingLineMcpInstructions).toContain(
      'installed InteractionCatalog proof declaration',
    );
    expect(operatingLineMcpInstructions).not.toContain('InteractionCatalog 1.44 proof');
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
      'operatingline.procedure.menu-control-proof.propose',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.menu-control-proof.execute',
    );
    expect(operatingLineMcpInstructions).toContain(
      'operatingline.blender.menu-control-proof.status',
    );
    expect(operatingLineMcpInstructions).toContain(
      'version 1.1 process session and document incarnation',
    );
    expect(operatingLineMcpInstructions).toContain('pre_dispatch_authority_expired');
    expect(operatingLineMcpInstructions).toContain(
      'a failure checkpoint never becomes success evidence',
    );
    expect(operatingLineMcpInstructions).not.toContain('the MCP track remains unavailable');
    expect(operatingLineMcpInstructions).not.toContain('managed primitive');
  });
});
