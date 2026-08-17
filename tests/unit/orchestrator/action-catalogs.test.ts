import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { blenderActionCatalog, blenderActionCatalogs } from '@operatingline/blender-action-catalog';
import { createActionCatalogRegistry } from '@operatingline/orchestrator';

describe('action catalog registry', () => {
  it('selects the latest semantic catalog version and supports exact lookup', () => {
    const registry = createActionCatalogRegistry(blenderActionCatalogs);

    expect(registry.get({ targetAdapterId: 'blender' }).catalogVersion).toBe('1.21.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.18.0' }).catalogVersion,
    ).toBe('1.18.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.14.0' }).catalogVersion,
    ).toBe('1.14.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.13.0' }).catalogVersion,
    ).toBe('1.13.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.12.0' }).catalogVersion,
    ).toBe('1.12.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.11.0' }).catalogVersion,
    ).toBe('1.11.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.10.0' }).catalogVersion,
    ).toBe('1.10.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.9.0' }).catalogVersion,
    ).toBe('1.9.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.7.0' }).catalogVersion,
    ).toBe('1.7.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.6.0' }).catalogVersion,
    ).toBe('1.6.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.5.0' }).catalogVersion,
    ).toBe('1.5.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.4.0' }).catalogVersion,
    ).toBe('1.4.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.3.0' }).catalogVersion,
    ).toBe('1.3.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.2.0' }).catalogVersion,
    ).toBe('1.2.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.1.0' }).catalogVersion,
    ).toBe('1.1.0');
    expect(
      registry.get({ targetAdapterId: 'blender', catalogVersion: '1.0.0' }).catalogVersion,
    ).toBe('1.0.0');
  });

  it('freezes ActionCatalog 1.12.0 and changes only Subdivision Surface coverage in 1.13.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/action-catalog-1.12.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'b7669aebe0d7d3874a0add18d29f284875d74f7d1853db7f80a7406f41a0ab1a',
    );

    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderActionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/action-catalog-1.13.0.json'), 'utf8'),
    ) as typeof blenderActionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.planningNotes = frozen.planningNotes;
    active.planningPhases![0]!.actionNames = active.planningPhases![0]!.actionNames.filter(
      (actionName) => actionName !== 'blender.modifier.add_subdivision_surface',
    );
    active.semanticCapabilities = active.semanticCapabilities?.filter(
      (capability) => capability.id !== 'geometry.subdivision_surface_modifier',
    );
    active.actions = active.actions.filter(
      (action) => action.name !== 'blender.modifier.add_subdivision_surface',
    );
    expect(active).toEqual(frozen);
  });

  it('keeps the latest TypeScript and Blender extension action catalogs byte-identical', () => {
    expect(
      readFileSync(
        resolve('adapters/blender/extension/operating_line/resources/action-catalog.json'),
      ),
    ).toEqual(readFileSync(resolve('adapters/blender/catalog/v1/action-catalog.json')));
  });

  it('freezes ActionCatalog 1.13.0 and changes only Bevel Edges coverage in 1.14.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/action-catalog-1.13.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'b1ac2f7fee2ea2ea5b71d2bd42ee0911cc28c5e609d70cd499055c4dcd54fb3d',
    );

    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderActionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/action-catalog-1.14.0.json'), 'utf8'),
    ) as typeof blenderActionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.planningNotes = frozen.planningNotes;
    active.planningPhases![0]!.actionNames = active.planningPhases![0]!.actionNames.filter(
      (actionName) => actionName !== 'blender.mesh.edit_bevel_edges',
    );
    active.semanticCapabilities = active.semanticCapabilities?.filter(
      (capability) => capability.id !== 'geometry.edit_bevel_edges',
    );
    active.actions = active.actions.filter(
      (action) => action.name !== 'blender.mesh.edit_bevel_edges',
    );
    expect(active).toEqual(frozen);
  });

  it('freezes ActionCatalog 1.14.0 and changes only Inset Faces coverage in 1.15.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/action-catalog-1.14.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '2ce43ec9df153468872a3549e7a77b393c3c9bccc849bc8f2da480691bc59524',
    );

    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderActionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/action-catalog-1.15.0.json'), 'utf8'),
    ) as typeof blenderActionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.planningNotes = frozen.planningNotes;
    active.planningPhases![0]!.actionNames = active.planningPhases![0]!.actionNames.filter(
      (actionName) => actionName !== 'blender.mesh.edit_inset_faces',
    );
    active.semanticCapabilities = active.semanticCapabilities?.filter(
      (capability) => capability.id !== 'geometry.edit_inset_faces',
    );
    active.actions = active.actions.filter(
      (action) => action.name !== 'blender.mesh.edit_inset_faces',
    );
    expect(active).toEqual(frozen);
  });

  it('freezes ActionCatalog 1.15.0 and changes only Poke Faces coverage in 1.16.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/action-catalog-1.15.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'f203a1dbb8630cab0026d5d607ffe255c5c40ceff4cf3182bafc3f0df661539d',
    );

    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderActionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/action-catalog-1.16.0.json'), 'utf8'),
    ) as typeof blenderActionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.planningNotes = frozen.planningNotes;
    active.planningPhases![0]!.actionNames = active.planningPhases![0]!.actionNames.filter(
      (actionName) => actionName !== 'blender.mesh.edit_poke_faces',
    );
    active.semanticCapabilities = active.semanticCapabilities?.filter(
      (capability) => capability.id !== 'geometry.edit_poke_faces',
    );
    active.actions = active.actions.filter(
      (action) => action.name !== 'blender.mesh.edit_poke_faces',
    );
    expect(active).toEqual(frozen);
  });

  it('freezes ActionCatalog 1.16.0 and changes only Mirror modifier coverage in 1.17.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/action-catalog-1.16.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '59e6ff9c6df157fdef8a78f1655b309b87c70fe69751fff4d813ce37f8251a2b',
    );

    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderActionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/action-catalog-1.17.0.json'), 'utf8'),
    ) as typeof blenderActionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    active.planningNotes = frozen.planningNotes;
    active.planningPhases![0]!.actionNames = active.planningPhases![0]!.actionNames.filter(
      (actionName) => actionName !== 'blender.modifier.add_mirror',
    );
    active.semanticCapabilities = active.semanticCapabilities?.filter(
      (capability) => capability.id !== 'geometry.mirror_modifier',
    );
    active.actions = active.actions.filter(
      (action) => action.name !== 'blender.modifier.add_mirror',
    );
    expect(active).toEqual(frozen);
  });

  it('freezes ActionCatalog 1.17.0 and adds only the strong UV Sphere observation in 1.18.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/action-catalog-1.17.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '0c1da28ec0aff7a7cc5ffa5e43b096920c14652d86fde8984954b4be88e43ce6',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderActionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/action-catalog-1.18.0.json'), 'utf8'),
    ) as typeof blenderActionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    const uvSphere = active.actions.find(
      (action) => action.name === 'blender.mesh.create_uv_sphere',
    );
    if (uvSphere === undefined) throw new Error('Expected UV Sphere action');
    uvSphere.supportedObservationKinds = uvSphere.supportedObservationKinds.filter(
      (kind) => kind !== 'uv_sphere_ready',
    );
    expect(active).toEqual(frozen);
  });

  it('freezes ActionCatalog 1.18.0 and adds only the strong Icosphere observation in 1.19.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/action-catalog-1.18.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '9953fd031873716a098055edc958ffc3db593f1eb4f0bfc84309754a7f00443a',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderActionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/action-catalog-1.19.0.json'), 'utf8'),
    ) as typeof blenderActionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    const icosphere = active.actions.find(
      (action) => action.name === 'blender.mesh.create_icosphere',
    );
    if (icosphere === undefined) throw new Error('Expected Icosphere action');
    icosphere.supportedObservationKinds = icosphere.supportedObservationKinds.filter(
      (kind) => kind !== 'icosphere_ready',
    );
    expect(active).toEqual(frozen);
  });

  it('freezes ActionCatalog 1.19.0 and adds only strong Cube and Plane observations in 1.20.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/action-catalog-1.19.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      'fd9c8881a63d2df275712d23ba5d1b9c5fb20bd4873416bd4a933c0719805468',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderActionCatalog;
    const active = JSON.parse(
      readFileSync(resolve('adapters/blender/catalog/v1/action-catalog-1.20.0.json'), 'utf8'),
    ) as typeof blenderActionCatalog;
    active.catalogVersion = frozen.catalogVersion;
    for (const [actionName, observationKind] of [
      ['blender.mesh.create_cube', 'cube_ready'],
      ['blender.mesh.create_plane', 'plane_ready'],
    ] as const) {
      const action = active.actions.find((candidate) => candidate.name === actionName);
      if (action === undefined) throw new Error(`Expected ${actionName} action`);
      action.supportedObservationKinds = action.supportedObservationKinds.filter(
        (kind) => kind !== observationKind,
      );
    }
    expect(active).toEqual(frozen);
  });

  it('freezes ActionCatalog 1.20.0 and adds only the strong Torus observation in 1.21.0', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/action-catalog-1.20.0.json'),
    );
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '77f4520c3673f28325cd0f0581fca11e30bb1fd2a365713484bf8c9c6c7f781a',
    );
    const frozen = JSON.parse(frozenBytes.toString('utf8')) as typeof blenderActionCatalog;
    const active = structuredClone(blenderActionCatalog);
    active.catalogVersion = frozen.catalogVersion;
    const torus = active.actions.find((action) => action.name === 'blender.mesh.create_torus');
    if (torus === undefined) throw new Error('Expected Torus action');
    torus.supportedObservationKinds = torus.supportedObservationKinds.filter(
      (kind) => kind !== 'torus_ready',
    );
    expect(active).toEqual(frozen);
  });

  it('fails closed for duplicate, missing, and unavailable catalog versions', () => {
    expect(() => createActionCatalogRegistry([blenderActionCatalog, blenderActionCatalog])).toThrow(
      'Duplicate action catalog',
    );

    const registry = createActionCatalogRegistry([blenderActionCatalog]);
    expect(() => registry.get({ targetAdapterId: 'gimp' })).toThrow(
      'No action catalog is installed',
    );
    expect(() => registry.get({ targetAdapterId: 'blender', catalogVersion: '2.0.0' })).toThrow(
      'is not installed',
    );
  });
});
