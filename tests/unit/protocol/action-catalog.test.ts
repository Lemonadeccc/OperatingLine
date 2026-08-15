import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blenderActionCatalog, blenderActionCatalogs } from '@operatingline/blender-action-catalog';
import {
  actionCatalogSchema,
  planningIntentSchema,
  planningContextSchema,
  planningPromptPacketSchema,
  planningQualityReportSchema,
  replanningPromptPacketSchema,
  validateActionCatalog,
  validateActionArguments,
} from '@operatingline/protocol';

describe('action catalog protocol', () => {
  it('validates the versioned Blender allowlist and argument contracts', () => {
    const catalog = actionCatalogSchema.parse(blenderActionCatalog);

    expect(catalog.catalogVersion).toBe('1.16.0');
    expect(catalog.adapterId).toBe('blender');
    expect(catalog.actions.map((action) => action.name)).toEqual([
      'blender.mesh.create_uv_sphere',
      'blender.mesh.create_icosphere',
      'blender.mesh.create_plane',
      'blender.mesh.create_cube',
      'blender.mesh.create_cone',
      'blender.mesh.create_cylinder',
      'blender.mesh.create_torus',
      'blender.mesh.create_primitive_batch',
      'blender.mesh.edit_subdivide',
      'blender.mesh.edit_triangulate',
      'blender.mesh.edit_extrude_region',
      'blender.mesh.edit_bevel_edges',
      'blender.mesh.edit_inset_faces',
      'blender.mesh.edit_poke_faces',
      'blender.modifier.add_bevel',
      'blender.modifier.add_solidify',
      'blender.modifier.add_subdivision_surface',
      'blender.geometry_nodes.create_transform',
      'blender.material.create_and_assign',
      'blender.material.create_palette_and_assign',
      'blender.rig.create_armature',
      'blender.rig.bind_skin_weights',
      'blender.animation.create_pose_keyframes',
      'blender.render_scene.create',
      'blender.render_rig.create',
      'blender.render.execute_preview',
    ]);
    expect(
      catalog.actions.find((action) => action.name === 'blender.render.execute_preview')?.safety,
    ).toMatchObject({ sideEffect: 'managed_file_write', fileAccess: 'managed_temp' });
    expect(catalog.planningPhases?.map((phase) => phase.id)).toEqual([
      'geometry',
      'materials',
      'animation',
      'render_setup',
      'output',
    ]);
    expect(catalog.semanticCapabilities?.map((capability) => capability.id)).toEqual([
      'geometry.ground_plane',
      'geometry.primitive_assembly',
      'geometry.edit_subdivide',
      'geometry.edit_triangulate',
      'geometry.edit_extrude_region',
      'geometry.edit_bevel_edges',
      'geometry.edit_inset_faces',
      'geometry.edit_poke_faces',
      'geometry.bevel_modifier',
      'geometry.solidify_modifier',
      'geometry.subdivision_surface_modifier',
      'geometry_nodes.transform',
      'appearance.principled_palette',
      'animation.rigid_armature',
      'animation.deform_skin_weights',
      'animation.rigid_pose_keyframes',
      'render.scene_setup',
      'output.png_preview',
    ]);
    expect(
      blenderActionCatalogs.map((versionedCatalog) => versionedCatalog.catalogVersion),
    ).toEqual([
      '1.0.0',
      '1.1.0',
      '1.2.0',
      '1.3.0',
      '1.4.0',
      '1.5.0',
      '1.6.0',
      '1.7.0',
      '1.8.0',
      '1.9.0',
      '1.10.0',
      '1.11.0',
      '1.12.0',
      '1.13.0',
      '1.14.0',
      '1.15.0',
      '1.16.0',
    ]);
  });

  it('rejects duplicate actions and required argument names absent from properties', () => {
    const duplicate = structuredClone(blenderActionCatalog);
    duplicate.actions.push(structuredClone(duplicate.actions[0]!));
    expect(() => validateActionCatalog(duplicate)).toThrow('duplicate action');

    const unknownRequired = structuredClone(blenderActionCatalog);
    unknownRequired.actions[0]!.argumentsSchema.required?.push('missingProperty');
    expect(() => validateActionCatalog(unknownRequired)).toThrow(
      'requires unknown argument property',
    );

    const unknownKeyword = structuredClone(blenderActionCatalog);
    const propertySchema = unknownKeyword.actions[0]!.argumentsSchema.properties.resourceId as {
      format?: string;
    };
    propertySchema.format = 'uuid';
    expect(() => validateActionCatalog(unknownKeyword)).toThrow('unknown keyword format');

    const repeatedPhaseAction = structuredClone(blenderActionCatalog);
    repeatedPhaseAction.planningPhases![1]!.actionNames.push(
      repeatedPhaseAction.planningPhases![0]!.actionNames[0]!,
    );
    expect(() => validateActionCatalog(repeatedPhaseAction)).toThrow(
      'assigned to more than one planning phase',
    );

    const duplicateCapability = structuredClone(blenderActionCatalog);
    duplicateCapability.semanticCapabilities!.push(
      structuredClone(duplicateCapability.semanticCapabilities![0]!),
    );
    expect(() => validateActionCatalog(duplicateCapability)).toThrow(
      'duplicate semantic capability',
    );

    const unknownCapabilityAction = structuredClone(blenderActionCatalog);
    unknownCapabilityAction.semanticCapabilities![0]!.actionNames.push('blender.unknown.action');
    expect(() => validateActionCatalog(unknownCapabilityAction)).toThrow(
      'references unknown action',
    );

    const duplicateCapabilityAction = structuredClone(blenderActionCatalog);
    duplicateCapabilityAction.semanticCapabilities![0]!.actionNames.push(
      duplicateCapabilityAction.semanticCapabilities![0]!.actionNames[0]!,
    );
    expect(actionCatalogSchema.safeParse(duplicateCapabilityAction).success).toBe(false);
    expect(() => validateActionCatalog(duplicateCapabilityAction)).toThrow(
      'contains duplicate action',
    );

    const capabilitiesWithoutPhases = structuredClone(blenderActionCatalog);
    delete capabilitiesWithoutPhases.planningPhases;
    expect(() => validateActionCatalog(capabilitiesWithoutPhases)).toThrow(
      'cannot declare semantic capabilities without planning phases',
    );
  });

  it('rejects version ranges that the runtime cannot evaluate', () => {
    for (const range of ['^0.1.0', '>=0.1', '>=0.1.0 ||', '>=0.1.0  <0.2.0']) {
      expect(
        actionCatalogSchema.safeParse({ ...blenderActionCatalog, adapterVersionRange: range })
          .success,
      ).toBe(false);
    }
  });

  it('rejects primitive arguments that the Blender executor cannot realize', () => {
    const schemaFor = (actionName: string) => {
      const action = blenderActionCatalog.actions.find(
        (candidate) => candidate.name === actionName,
      );
      expect(action, actionName).toBeDefined();
      return action!.argumentsSchema;
    };

    expect(
      validateActionArguments(
        {
          resourceId: 'tiny-sphere',
          objectName: 'OperatingLine.TinySphere',
          radius: 0.00001,
          location: [0, 0, 0],
        },
        schemaFor('blender.mesh.create_uv_sphere'),
      ),
    ).toContain('radius must be at least 0.0001');
    expect(
      validateActionArguments(
        {
          resourceId: 'icosphere-boundary',
          objectName: 'OperatingLine.BoundaryIcosphere',
          subdivisions: 5,
          radius: 1,
          location: [0, 0, 0],
        },
        schemaFor('blender.mesh.create_icosphere'),
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          resourceId: 'integral-float-torus',
          objectName: 'OperatingLine.IntegralFloatTorus',
          majorSegments: 16.0,
          minorSegments: 8.0,
          majorRadius: 2,
          minorRadius: 0.5,
          location: [0, 0, 0],
        },
        schemaFor('blender.mesh.create_torus'),
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          resourceId: 'fractional-torus',
          objectName: 'OperatingLine.FractionalTorus',
          majorSegments: 16.5,
          minorSegments: 8.5,
          majorRadius: 2,
          minorRadius: 0.5,
          location: [0, 0, 0],
        },
        schemaFor('blender.mesh.create_torus'),
      ),
    ).toEqual(['majorSegments must be integer', 'minorSegments must be integer']);
    expect(
      validateActionArguments(
        {
          resourceId: 'i'.repeat(181),
          objectName: 'OperatingLine.InvalidIcosphere',
          subdivisions: 6,
          radius: 0.00001,
          location: [0, 0, 0],
        },
        schemaFor('blender.mesh.create_icosphere'),
      ),
    ).toEqual([
      'resourceId must have length at most 180',
      'subdivisions must be at most 5',
      'radius must be at least 0.0001',
    ]);
    expect(
      validateActionArguments(
        {
          resourceId: 'flat-plane',
          objectName: 'OperatingLine.FlatPlane',
          size: 0.00001,
          location: [0, 0, 0],
        },
        schemaFor('blender.mesh.create_plane'),
      ),
    ).toContain('size must be at least 0.0001');
    expect(
      validateActionArguments(
        {
          resourceId: 'c'.repeat(180),
          objectName: 'OperatingLine.BoundaryCube',
          size: 1,
          location: [0, 0, 0],
        },
        schemaFor('blender.mesh.create_cube'),
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          resourceId: 'c'.repeat(181),
          objectName: 'OperatingLine.TooLongCube',
          size: 1,
          location: [0, 0, 0],
        },
        schemaFor('blender.mesh.create_cube'),
      ),
    ).toContain('resourceId must have length at most 180');
    expect(
      validateActionArguments(
        {
          resourceId: 'tiny-cube',
          objectName: 'OperatingLine.TinyCube',
          size: 0.00001,
          location: [0, 0, 0],
        },
        schemaFor('blender.mesh.create_cube'),
      ),
    ).toContain('size must be at least 0.0001');
    expect(
      validateActionArguments(
        {
          resourceId: 'zero-cone',
          objectName: 'OperatingLine.ZeroCone',
          radiusStart: 0,
          radiusEnd: 0,
          start: [0, 0, 0],
          end: [0, 0, 0],
        },
        schemaFor('blender.mesh.create_cone'),
      ),
    ).toEqual([
      'arguments properties start and end must differ',
      'arguments requires at least one positive value among radiusStart, radiusEnd',
    ]);
    expect(
      validateActionArguments(
        {
          resourceId: 'tiny-cylinder',
          objectName: 'OperatingLine.TinyCylinder',
          radius: 0.00001,
          start: [0, 0, 0],
          end: [0, 0, 0],
        },
        schemaFor('blender.mesh.create_cylinder'),
      ),
    ).toEqual(['radius must be at least 0.0001', 'arguments properties start and end must differ']);
    expect(
      validateActionArguments(
        {
          resourceId: 't'.repeat(180),
          objectName: 'OperatingLine.BoundaryTorus',
          majorSegments: 128,
          minorSegments: 64,
          majorRadius: 2,
          minorRadius: 0.5,
          location: [0, 0, 0],
        },
        schemaFor('blender.mesh.create_torus'),
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          resourceId: 't'.repeat(181),
          objectName: 'OperatingLine.InvalidTorus',
          majorSegments: 129,
          minorSegments: 65,
          majorRadius: 0.00001,
          minorRadius: 0.00001,
          location: [0, 0, 0],
        },
        schemaFor('blender.mesh.create_torus'),
      ),
    ).toEqual([
      'resourceId must have length at most 180',
      'majorSegments must be at most 128',
      'minorSegments must be at most 64',
      'majorRadius must be at least 0.0001',
      'minorRadius must be at least 0.0001',
    ]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.subdivided_mesh',
          resultMeshName: 'OperatingLine.Body.SubdividedMesh',
          cuts: 8.0,
          smooth: 1,
        },
        schemaFor('blender.mesh.edit_subdivide'),
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.subdivided_mesh',
          resultMeshName: 'OperatingLine.Body.SubdividedMesh',
          cuts: 9,
          smooth: 1.1,
        },
        schemaFor('blender.mesh.edit_subdivide'),
      ),
    ).toEqual(['cuts must be at most 8', 'smooth must be at most 1']);
    const triangulateSchema = schemaFor('blender.mesh.edit_triangulate');
    expect(triangulateSchema.additionalProperties).toBe(false);
    expect(triangulateSchema.required).toEqual(['targetId', 'resultMeshId', 'resultMeshName']);
    expect(Object.keys(triangulateSchema.properties)).toEqual([
      'targetId',
      'resultMeshId',
      'resultMeshName',
    ]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.triangulated_mesh',
          resultMeshName: 'OperatingLine.Body.TriangulatedMesh',
        },
        triangulateSchema,
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.triangulated_mesh',
          resultMeshName: 'Body.TriangulatedMesh',
          unexpected: true,
        },
        triangulateSchema,
      ),
    ).toEqual(['resultMeshName must match pattern ^OperatingLine\\.', 'unknown unexpected']);
    const extrudeSchema = schemaFor('blender.mesh.edit_extrude_region');
    expect(extrudeSchema.additionalProperties).toBe(false);
    expect(extrudeSchema.required).toEqual([
      'targetId',
      'resultMeshId',
      'resultMeshName',
      'polygonIndices',
      'translation',
    ]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.extruded_mesh',
          resultMeshName: 'OperatingLine.Body.ExtrudedMesh',
          polygonIndices: [0, 5],
          translation: [0, 0, 1],
        },
        extrudeSchema,
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.extruded_mesh',
          resultMeshName: 'OperatingLine.Body.ExtrudedMesh',
          polygonIndices: [0, 0, 8192],
          translation: [0, 0, 1001],
        },
        extrudeSchema,
      ),
    ).toEqual([
      'polygonIndices items must be unique',
      'polygonIndices[2] must be at most 8191',
      'translation[2] must be at most 1000',
      'translation vector length must be at most 1000',
    ]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.extruded_mesh',
          resultMeshName: 'OperatingLine.Body.ExtrudedMesh',
          polygonIndices: [0],
          translation: [0, 0, 0],
        },
        extrudeSchema,
      ),
    ).toEqual(['translation vector length must be at least 0.0001']);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'x'.repeat(181),
          resultMeshName: 'OperatingLine.Body.ExtrudedMesh',
          polygonIndices: [0],
          translation: [0, 0, 1],
        },
        extrudeSchema,
      ),
    ).toEqual(['resultMeshId must have length at most 180']);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.extruded_mesh',
          resultMeshName: 'OperatingLine.Body.ExtrudedMesh',
          polygonIndices: [0],
          translation: [491.34180453259, 870.9668369798349, 0],
        },
        extrudeSchema,
      ),
    ).toEqual(['translation vector length must be at most 1000']);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.extruded_mesh',
          resultMeshName: 'OperatingLine.Body.ExtrudedMesh',
          polygonIndices: [0],
          translation: [999.999985743048, 0.1688606043279722, 0],
        },
        extrudeSchema,
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          modifierId: 'model.body.bevel',
          modifierName: 'OperatingLine.Body.Bevel',
          width: 0.1,
          segments: 16.0,
          angleLimit: Math.PI,
        },
        schemaFor('blender.modifier.add_bevel'),
      ),
    ).toEqual([]);
    const bevelEdgesSchema = schemaFor('blender.mesh.edit_bevel_edges');
    const bevelEdgesAction = blenderActionCatalog.actions.find(
      (action) => action.name === 'blender.mesh.edit_bevel_edges',
    );
    expect(bevelEdgesAction).toMatchObject({
      resourceEffects: [
        { access: 'mutate', resourceType: 'OBJECT', argumentPath: 'targetId' },
        { access: 'create', resourceType: 'MESH', argumentPath: 'resultMeshId' },
      ],
      supportedAnchorKinds: ['object', 'operator', 'unavailable'],
      supportedObservationKinds: ['resource_exists', 'mesh_edges_beveled'],
      rollbackModes: ['compensating_action'],
      safety: {
        sideEffect: 'scene_write',
        requiresPlanApproval: true,
        networkAccess: false,
        fileAccess: 'none',
      },
    });
    expect(bevelEdgesSchema.additionalProperties).toBe(false);
    expect(bevelEdgesSchema.required).toEqual([
      'targetId',
      'resultMeshId',
      'resultMeshName',
      'width',
      'segments',
      'profile',
    ]);
    expect(Object.keys(bevelEdgesSchema.properties)).toEqual(bevelEdgesSchema.required);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.beveled_mesh',
          resultMeshName: 'OperatingLine.Body.BeveledMesh',
          width: 0.0001,
          segments: 16,
          profile: 1,
        },
        bevelEdgesSchema,
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.beveled_mesh',
          resultMeshName: 'OperatingLine.Body.BeveledMesh',
          width: 0,
          segments: 17,
          profile: -0.1,
        },
        bevelEdgesSchema,
      ),
    ).toEqual([
      'width must be at least 0.0001',
      'segments must be at most 16',
      'profile must be at least 0',
    ]);
    const insetFacesSchema = schemaFor('blender.mesh.edit_inset_faces');
    const insetFacesAction = blenderActionCatalog.actions.find(
      (action) => action.name === 'blender.mesh.edit_inset_faces',
    );
    expect(insetFacesAction).toMatchObject({
      resourceEffects: [
        { access: 'mutate', resourceType: 'OBJECT', argumentPath: 'targetId' },
        { access: 'create', resourceType: 'MESH', argumentPath: 'resultMeshId' },
      ],
      supportedAnchorKinds: ['object', 'operator', 'unavailable'],
      supportedObservationKinds: ['resource_exists', 'mesh_faces_inset'],
      rollbackModes: ['compensating_action'],
    });
    expect(insetFacesSchema.additionalProperties).toBe(false);
    expect(insetFacesSchema.required).toEqual([
      'targetId',
      'resultMeshId',
      'resultMeshName',
      'thickness',
      'depth',
    ]);
    expect(Object.keys(insetFacesSchema.properties)).toEqual(insetFacesSchema.required);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.inset_mesh',
          resultMeshName: 'OperatingLine.Body.InsetMesh',
          thickness: 0.0001,
          depth: -100,
        },
        insetFacesSchema,
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.inset_mesh',
          resultMeshName: 'OperatingLine.Body.InsetMesh',
          thickness: 0,
          depth: 101,
        },
        insetFacesSchema,
      ),
    ).toEqual(['thickness must be at least 0.0001', 'depth must be at most 100']);
    const pokeFacesSchema = schemaFor('blender.mesh.edit_poke_faces');
    const pokeFacesAction = blenderActionCatalog.actions.find(
      (action) => action.name === 'blender.mesh.edit_poke_faces',
    );
    expect(pokeFacesAction).toMatchObject({
      resourceEffects: [
        { access: 'mutate', resourceType: 'OBJECT', argumentPath: 'targetId' },
        { access: 'create', resourceType: 'MESH', argumentPath: 'resultMeshId' },
      ],
      supportedAnchorKinds: ['object', 'operator', 'unavailable'],
      supportedObservationKinds: ['resource_exists', 'mesh_faces_poked'],
      rollbackModes: ['compensating_action'],
    });
    expect(pokeFacesSchema.additionalProperties).toBe(false);
    expect(pokeFacesSchema.required).toEqual([
      'targetId',
      'resultMeshId',
      'resultMeshName',
      'offset',
    ]);
    expect(Object.keys(pokeFacesSchema.properties)).toEqual(pokeFacesSchema.required);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.poked_mesh',
          resultMeshName: 'OperatingLine.Body.PokedMesh',
          offset: -100,
        },
        pokeFacesSchema,
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          resultMeshId: 'model.body.poked_mesh',
          resultMeshName: 'OperatingLine.Body.PokedMesh',
          offset: 101,
        },
        pokeFacesSchema,
      ),
    ).toEqual(['offset must be at most 100']);
    const solidifySchema = schemaFor('blender.modifier.add_solidify');
    expect(solidifySchema.additionalProperties).toBe(false);
    expect(solidifySchema.required).toEqual([
      'targetId',
      'modifierId',
      'modifierName',
      'thickness',
      'offset',
    ]);
    expect(Object.keys(solidifySchema.properties)).toEqual([
      'targetId',
      'modifierId',
      'modifierName',
      'thickness',
      'offset',
    ]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          modifierId: 'model.body.solidify',
          modifierName: 'OperatingLine.Body.Solidify',
          thickness: 0.0001,
          offset: -1,
        },
        solidifySchema,
      ),
    ).toEqual([]);
    const subdivisionSurfaceSchema = schemaFor('blender.modifier.add_subdivision_surface');
    expect(subdivisionSurfaceSchema.additionalProperties).toBe(false);
    expect(subdivisionSurfaceSchema.required).toEqual([
      'targetId',
      'modifierId',
      'modifierName',
      'viewportLevel',
    ]);
    expect(Object.keys(subdivisionSurfaceSchema.properties)).toEqual([
      'targetId',
      'modifierId',
      'modifierName',
      'viewportLevel',
    ]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          modifierId: 'model.body.subdivision',
          modifierName: 'OperatingLine.Body.Subdivision',
          viewportLevel: 1,
        },
        subdivisionSurfaceSchema,
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          modifierId: 'model.body.subdivision',
          modifierName: 'OperatingLine.Body.Subdivision',
          viewportLevel: 3,
        },
        subdivisionSurfaceSchema,
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          modifierId: 'model.body.subdivision',
          modifierName: 'OperatingLine.Body.Subdivision',
          viewportLevel: 0,
        },
        subdivisionSurfaceSchema,
      ),
    ).toEqual(['viewportLevel must be at least 1']);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          modifierId: 'model.body.subdivision',
          modifierName: 'OperatingLine.Body.Subdivision',
          viewportLevel: 4,
        },
        subdivisionSurfaceSchema,
      ),
    ).toEqual(['viewportLevel must be at most 3']);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          modifierId: 'model.body.solidify',
          modifierName: 'OperatingLine.Body.Solidify',
          thickness: 100,
          offset: 1,
        },
        solidifySchema,
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          modifierId: 'model.body.solidify',
          modifierName: 'OperatingLine.Body.Solidify',
          thickness: 0,
          offset: -1.1,
        },
        solidifySchema,
      ),
    ).toEqual(['thickness must be at least 0.0001', 'offset must be at least -1']);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          modifierId: 'model.body.nodes',
          modifierName: 'OperatingLine.Body.GeometryNodes',
          nodeGroupId: 'model.body.transform_nodes',
          nodeGroupName: 'OperatingLine.Body.TransformNodes',
          translation: [-1000, 1000, 0],
          rotation: [-Math.PI * 2, Math.PI * 2, 0],
          scale: [0.0001, 1000, 1],
        },
        schemaFor('blender.geometry_nodes.create_transform'),
      ),
    ).toEqual([]);
    expect(
      validateActionArguments(
        {
          targetId: 'model.body',
          modifierId: 'model.body.nodes',
          modifierName: 'OperatingLine.Body.GeometryNodes',
          nodeGroupId: 'model.body.transform_nodes',
          nodeGroupName: 'OperatingLine.Body.TransformNodes',
          translation: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [0, 1, 1],
        },
        schemaFor('blender.geometry_nodes.create_transform'),
      ),
    ).toContain('scale[0] must be at least 0.0001');
  });

  it('rejects duplicate vertices and non-normalized skin weights before execution', () => {
    const skinAction = blenderActionCatalog.actions.find(
      (candidate) => candidate.name === 'blender.rig.bind_skin_weights',
    );
    expect(skinAction).toBeDefined();

    const skinArguments = {
      targetId: 'model.body',
      armatureId: 'model.rig',
      modifierId: 'model.body.skin',
      modifierName: 'OperatingLine.Body.Skin',
      preserveVolume: true,
      weights: [
        {
          vertexIndex: 0,
          influences: [
            { boneName: 'OperatingLine.Root', weight: 0.25 },
            { boneName: 'OperatingLine.Tip', weight: 0.75 },
          ],
        },
      ],
    };

    expect(validateActionArguments(skinArguments, skinAction!.argumentsSchema)).toEqual([]);
    expect(
      validateActionArguments(
        { ...skinArguments, weights: [...skinArguments.weights, skinArguments.weights[0]] },
        skinAction!.argumentsSchema,
      ),
    ).toContain('weights[1].vertexIndex must be unique');
    expect(
      validateActionArguments(
        {
          ...skinArguments,
          weights: [
            {
              vertexIndex: 0,
              influences: [
                { boneName: 'OperatingLine.Root', weight: 0.25 },
                { boneName: 'OperatingLine.Tip', weight: 0.5 },
              ],
            },
          ],
        },
        skinAction!.argumentsSchema,
      ),
    ).toContain('weights[0].influences weights must sum to 1');
  });

  it('accepts strict catalog capability coverage with unique structural ids', () => {
    const planningIntent = {
      goal: 'Build and render a colored primitive scene.',
      requiredPhaseIds: ['geometry', 'materials', 'render_setup', 'output'],
      capabilityCoverage: {
        policyVersion: 'catalog_capability_coverage_v1',
        requirements: [
          {
            requirementId: 'ground',
            statement: 'Add a ground plane.',
            coverage: [{ capabilityId: 'geometry.ground_plane', stepIds: ['step-ground'] }],
          },
        ],
      },
    } as const;

    expect(planningIntentSchema.parse(planningIntent)).toEqual(planningIntent);
    expect(
      planningIntentSchema.safeParse({
        ...planningIntent,
        capabilityCoverage: {
          ...planningIntent.capabilityCoverage,
          score: 1,
        },
      }).success,
    ).toBe(false);

    const duplicateRequirement = structuredClone(planningIntent);
    duplicateRequirement.capabilityCoverage.requirements.push(
      structuredClone(duplicateRequirement.capabilityCoverage.requirements[0]!),
    );
    expect(planningIntentSchema.safeParse(duplicateRequirement).success).toBe(false);

    const duplicateCapability = structuredClone(planningIntent);
    duplicateCapability.capabilityCoverage.requirements[0]!.coverage.push(
      structuredClone(duplicateCapability.capabilityCoverage.requirements[0]!.coverage[0]!),
    );
    expect(planningIntentSchema.safeParse(duplicateCapability).success).toBe(false);

    const duplicateStep = structuredClone(planningIntent);
    duplicateStep.capabilityCoverage.requirements[0]!.coverage[0]!.stepIds.push('step-ground');
    expect(planningIntentSchema.safeParse(duplicateStep).success).toBe(false);

    expect(
      planningIntentSchema.safeParse({
        goal: planningIntent.goal,
        requiredPhaseIds: planningIntent.requiredPhaseIds,
      }).success,
    ).toBe(true);
  });

  it('emits strict language-neutral catalog and planning-context schemas', () => {
    for (const filename of ['action-catalog.schema.json', 'planning-context.schema.json']) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        additionalProperties?: boolean;
      };
      expect(schema.additionalProperties).toBe(false);
    }

    for (const filename of [
      'planning-prompt-packet.schema.json',
      'replanning-prompt-packet.schema.json',
    ]) {
      const schema = JSON.parse(readFileSync(resolve('protocol/schemas/v1', filename), 'utf8')) as {
        properties?: { formatVersion?: { enum?: string[] } };
      };
      expect(schema.properties?.formatVersion?.enum).toEqual(['1.0.0', '1.1.0']);
    }

    expect(
      planningContextSchema.safeParse({
        protocolVersion: '1.0.0',
        targetAdapterId: 'blender',
        goal: null,
        requestedPlanId: null,
        recommendedRevision: null,
        catalog: blenderActionCatalog,
        companionStates: [],
        constraints: {
          singleAdapterPlan: true,
          executableActionsMustBeLeaves: true,
          dependenciesMustReferenceExecutableActions: true,
          unknownActionsMustBeRejected: true,
          semanticAnchorsOnly: true,
          immutablePlanRevisions: true,
          humanApprovalRequired: true,
          executionOrder: 'dependsOn_topology_then_order_then_id',
        },
        submission: {
          toolName: 'operatingline.guide.propose',
          targetAdapterId: 'blender',
          description: 'Submit the complete plan.',
        },
        qualityGate: {
          toolName: 'operatingline.planning.evaluate',
          baselineVersion: '1.1.0',
          requiredPhaseSelection: 'planner_declared_from_goal',
          description: 'Evaluate phase coverage.',
        },
      }).success,
    ).toBe(true);
  });

  it('rejects planning context adapter mismatches and phase/gate mismatches', () => {
    const context = {
      protocolVersion: '1.1.0',
      targetAdapterId: 'blender',
      goal: null,
      requestedPlanId: null,
      recommendedRevision: null,
      catalog: blenderActionCatalog,
      companionStates: [],
      constraints: {
        singleAdapterPlan: true,
        executableActionsMustBeLeaves: true,
        dependenciesMustReferenceExecutableActions: true,
        unknownActionsMustBeRejected: true,
        semanticAnchorsOnly: true,
        immutablePlanRevisions: true,
        humanApprovalRequired: true,
        executionOrder: 'dependsOn_topology_then_order_then_id',
      },
      submission: {
        toolName: 'operatingline.guide.propose',
        targetAdapterId: 'blender',
        description: 'Submit the complete plan.',
      },
      qualityGate: {
        toolName: 'operatingline.planning.evaluate',
        baselineVersion: '1.1.0',
        requiredPhaseSelection: 'planner_declared_from_goal',
        description: 'Evaluate phase coverage.',
      },
    } as const;

    expect(planningContextSchema.safeParse(context).success).toBe(true);
    expect(
      planningContextSchema.safeParse({
        ...context,
        qualityGate: { ...context.qualityGate, baselineVersion: '1.0.0' },
      }).success,
    ).toBe(false);

    expect(
      planningContextSchema.safeParse({
        ...context,
        companionStates: [
          {
            protocolVersion: '1.1.0',
            reportId: '00000000-0000-4000-8000-000000000010',
            sequence: 1,
            adapterId: 'other',
            instanceId: '00000000-0000-4000-8000-000000000011',
            companionVersion: '0.1.0',
            hostVersion: '5.1.1',
            plan: null,
            planContentSha256: null,
            executionId: null,
            phase: 'idle',
            activeStepId: null,
            completedStepIds: [],
            transition: 'snapshot',
            stepId: null,
            observations: [],
            error: null,
            occurredAt: '2026-08-05T00:00:00.000Z',
          },
        ],
      }).success,
    ).toBe(false);
    expect(planningContextSchema.safeParse({ ...context, targetAdapterId: 'other' }).success).toBe(
      false,
    );
    expect(
      planningContextSchema.safeParse({
        ...context,
        submission: { ...context.submission, targetAdapterId: 'other' },
      }).success,
    ).toBe(false);
    expect(planningContextSchema.safeParse({ ...context, qualityGate: undefined }).success).toBe(
      false,
    );

    const historicalContext = {
      ...context,
      catalog: blenderActionCatalogs[0],
      qualityGate: undefined,
    };
    expect(planningContextSchema.safeParse(historicalContext).success).toBe(true);
    expect(
      planningContextSchema.safeParse({
        ...historicalContext,
        qualityGate: context.qualityGate,
      }).success,
    ).toBe(false);

    expect(
      planningContextSchema.safeParse({
        ...context,
        catalog: blenderActionCatalogs[2],
        qualityGate: { ...context.qualityGate, baselineVersion: '1.0.0' },
      }).success,
    ).toBe(true);
    expect(
      planningContextSchema.safeParse({
        ...context,
        catalog: blenderActionCatalogs[2],
        qualityGate: { ...context.qualityGate, baselineVersion: '1.1.0' },
      }).success,
    ).toBe(false);
  });

  it('selects packet format 1.1.0 exactly when semantic capabilities exist', () => {
    const planningContext = {
      protocolVersion: '1.1.0',
      targetAdapterId: 'blender',
      goal: 'Build a scene.',
      requestedPlanId: 'scene-plan',
      recommendedRevision: 1,
      catalog: blenderActionCatalog,
      companionStates: [],
      constraints: {
        singleAdapterPlan: true,
        executableActionsMustBeLeaves: true,
        dependenciesMustReferenceExecutableActions: true,
        unknownActionsMustBeRejected: true,
        semanticAnchorsOnly: true,
        immutablePlanRevisions: true,
        humanApprovalRequired: true,
        executionOrder: 'dependsOn_topology_then_order_then_id',
      },
      submission: {
        toolName: 'operatingline.guide.propose',
        targetAdapterId: 'blender',
        description: 'Submit the plan.',
      },
      qualityGate: {
        toolName: 'operatingline.planning.evaluate',
        baselineVersion: '1.1.0',
        requiredPhaseSelection: 'planner_declared_from_goal',
        description: 'Evaluate the plan.',
      },
    } as const;
    const planningPacket = {
      formatVersion: '1.1.0',
      context: planningContext,
      responseContract: { mediaType: 'application/json', schema: {} },
      workflow: {
        evaluateToolName: 'operatingline.planning.evaluate',
        submitToolName: 'operatingline.guide.propose',
        instructions: ['Return JSON.'],
      },
      renderedPrompt: 'Prompt.',
    } as const;
    expect(planningPromptPacketSchema.safeParse(planningPacket).success).toBe(true);
    expect(
      planningPromptPacketSchema.safeParse({ ...planningPacket, formatVersion: '1.0.0' }).success,
    ).toBe(false);

    const historicalPlanningPacket = {
      ...planningPacket,
      formatVersion: '1.0.0',
      context: {
        ...planningContext,
        catalog: blenderActionCatalogs[2],
        qualityGate: { ...planningContext.qualityGate, baselineVersion: '1.0.0' },
      },
    } as const;
    expect(planningPromptPacketSchema.safeParse(historicalPlanningPacket).success).toBe(true);
    expect(
      planningPromptPacketSchema.safeParse({
        ...historicalPlanningPacket,
        formatVersion: '1.1.0',
      }).success,
    ).toBe(false);

    const basePlan = JSON.parse(
      readFileSync(resolve('protocol/fixtures/v1/snowman-teaching.plan.json'), 'utf8'),
    ) as unknown;
    const revisionRequestBase = {
      protocolVersion: '1.2.0',
      requestId: '00000000-0000-4000-8000-000000000001',
      adapterId: 'blender',
      instanceId: '00000000-0000-4000-8000-000000000002',
      basePlan,
      references: [{ nodeId: 'snowman.model.head', nodeNumber: '1.2.3' }],
      message: 'Make the head larger.',
      revisionThread: {
        threadId: '00000000-0000-4000-8000-000000000001',
        turn: 1,
        parentRequestId: null,
      },
      occurredAt: '2026-08-05T00:00:00.000Z',
    } as const;
    const scope = {
      policyVersion: 'referenced_subtrees_v1',
      mode: 'referenced_subtrees',
      referencedRootIds: ['snowman.model.head'],
      normalizedRootIds: ['snowman.model.head'],
      rules: {
        completePlanRequired: true,
        planTitleMutable: false,
        rootStepIdMutable: false,
        outsideScopeMutable: false,
        referencedRootAttachmentMutable: false,
        descendantMoves: 'within_same_normalized_root',
        newSteps: 'within_normalized_roots',
        noOpAllowed: false,
      },
    } as const;
    const replanningPacket = {
      formatVersion: '1.1.0',
      operation: 'local_replan',
      context: {
        revisionRequest: {
          ...revisionRequestBase,
          catalogVersion: blenderActionCatalog.catalogVersion,
        },
        targetRevision: 7,
        catalog: blenderActionCatalog,
        companionState: null,
        scope,
      },
      responseContract: { mediaType: 'application/json', schema: {} },
      workflow: {
        evaluateToolName: 'operatingline.planning.evaluate',
        submitToolName: 'operatingline.replan.propose',
        instructions: ['Return JSON.'],
      },
      renderedPrompt: 'Prompt.',
    } as const;
    expect(replanningPromptPacketSchema.safeParse(replanningPacket).success).toBe(true);
    expect(
      replanningPromptPacketSchema.safeParse({
        ...replanningPacket,
        formatVersion: '1.0.0',
      }).success,
    ).toBe(false);

    const historicalReplanningPacket = {
      ...replanningPacket,
      formatVersion: '1.0.0',
      context: {
        ...replanningPacket.context,
        revisionRequest: {
          ...revisionRequestBase,
          catalogVersion: blenderActionCatalogs[2]!.catalogVersion,
        },
        catalog: blenderActionCatalogs[2],
      },
    } as const;
    expect(replanningPromptPacketSchema.safeParse(historicalReplanningPacket).success).toBe(true);
    expect(
      replanningPromptPacketSchema.safeParse({
        ...historicalReplanningPacket,
        formatVersion: '1.1.0',
      }).success,
    ).toBe(false);
  });

  it('keeps capability coverage out of quality baseline 1.0 reports', () => {
    const capabilityCoverage = {
      policyVersion: 'catalog_capability_coverage_v1',
      requirements: [
        {
          requirementId: 'ground',
          statement: 'Add a ground plane.',
          coverage: [{ capabilityId: 'geometry.ground_plane', stepIds: ['step-ground'] }],
        },
      ],
    } as const;
    const report = {
      protocolVersion: '1.1.0',
      baselineVersion: '1.1.0',
      targetAdapterId: 'blender',
      catalogVersion: '1.3.0',
      goal: 'Build a scene.',
      plan: { id: 'scene-plan', revision: 1 },
      requiredPhaseIds: [],
      valid: true,
      summary: {
        errorCount: 0,
        warningCount: 0,
        executableStepCount: 1,
        groupStepCount: 0,
        usedPhaseCount: 0,
        requiredPhaseCount: 0,
      },
      phases: [],
      capabilityCoverage,
      findings: [],
    } as const;

    expect(planningQualityReportSchema.safeParse(report).success).toBe(true);
    expect(
      planningQualityReportSchema.safeParse({ ...report, capabilityCoverage: undefined }).success,
    ).toBe(false);
    expect(
      planningQualityReportSchema.safeParse({
        ...report,
        capabilityCoverage: undefined,
        valid: false,
        summary: { ...report.summary, errorCount: 1 },
        findings: [
          {
            code: 'coverage.missing',
            severity: 'error',
            message: 'Capability coverage is required.',
            stepIds: [],
            phaseIds: [],
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      planningQualityReportSchema.safeParse({
        ...report,
        valid: false,
        summary: { ...report.summary, errorCount: 1 },
        findings: [
          {
            code: 'coverage.missing',
            severity: 'error',
            message: 'Capability coverage is required.',
            stepIds: [],
            phaseIds: [],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      planningQualityReportSchema.safeParse({ ...report, baselineVersion: '1.0.0' }).success,
    ).toBe(false);
    expect(
      planningQualityReportSchema.safeParse({
        ...report,
        baselineVersion: '1.0.0',
        capabilityCoverage: undefined,
      }).success,
    ).toBe(true);
  });
});
