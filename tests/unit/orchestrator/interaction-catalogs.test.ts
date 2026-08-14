import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  blenderActionCatalogs,
  blenderInteractionCatalog,
  blenderInteractionCatalogs,
} from '@operatingline/blender-action-catalog';

import { createActionCatalogRegistry } from '../../../services/orchestrator/src/action-catalogs.js';
import { createInteractionCatalogRegistry } from '../../../services/orchestrator/src/interaction-catalogs.js';

describe('interaction catalog registry', () => {
  it('selects the latest semantic interaction catalog version and supports exact lookup', () => {
    const actionCatalogRegistry = createActionCatalogRegistry(blenderActionCatalogs);
    const version100 = structuredClone(blenderInteractionCatalogs[0]!);
    const version110 = structuredClone(version100);
    version110.catalogVersion = '1.10.0';
    const registry = createInteractionCatalogRegistry(
      [version100, version110],
      actionCatalogRegistry,
    );

    expect(
      registry.get({
        targetAdapterId: 'blender',
        actionCatalogVersion: version100.actionCatalogVersion,
      }).catalogVersion,
    ).toBe('1.10.0');
    expect(
      registry.get({
        targetAdapterId: 'blender',
        actionCatalogVersion: version100.actionCatalogVersion,
        interactionCatalogVersion: '1.0.0',
      }).catalogVersion,
    ).toBe('1.0.0');
  });

  it('indexes bundled catalogs by their exact action catalog bindings', () => {
    const registry = createInteractionCatalogRegistry(
      blenderInteractionCatalogs,
      createActionCatalogRegistry(blenderActionCatalogs),
    );

    expect(registry.list()).toHaveLength(blenderInteractionCatalogs.length);
    expect(
      registry.get({
        targetAdapterId: 'blender',
        actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      }).catalogVersion,
    ).toBe(blenderInteractionCatalog.catalogVersion);
    const historical = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: '1.9.0',
    });
    expect(historical.catalogVersion).toBe('1.9.0');
    expect(
      historical.recipes.every((recipe) => recipe.procedureMaterialization === undefined),
    ).toBe(true);

    const frozenLegacy = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: '1.10.0',
    });
    expect(frozenLegacy.recipes[0]!.procedureMaterialization?.menu).toMatchObject({
      availability: 'available',
      parameterBinding: 'accepted_action_arguments',
    });
    const frozenOrderedMenu = registry.get({
      targetAdapterId: 'blender',
      actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
      interactionCatalogVersion: '1.11.0',
    });
    expect(frozenOrderedMenu.recipes[0]!.procedureMaterialization?.menu).toMatchObject({
      availability: 'available',
      parameterBinding: 'ordered_parameter_operations',
    });
    expect(blenderInteractionCatalog.catalogVersion).toBe('1.12.0');
    const latestShortcut = blenderInteractionCatalog.recipes[0]!.procedureMaterialization?.shortcut;
    expect(latestShortcut).toMatchObject({
      availability: 'available',
      source: 'catalog.ordered_shortcut_operations',
      semanticBinding: 'all_leaf_operations',
      parameterBinding: 'ordered_parameter_operations',
      projection: 'candidate_only',
    });
    if (latestShortcut?.availability !== 'available') {
      throw new Error('Expected the latest UV Sphere shortcut recipe to be available');
    }
    expect(latestShortcut.operations.map((operation) => operation.id)).toEqual([
      'shortcut.add_uv_sphere',
      'shortcut.move_x',
      'shortcut.move_y',
      'shortcut.move_z',
      'shortcut.scale',
      'shortcut.rename',
    ]);
    expect(latestShortcut.omittedActionArguments).toEqual([
      expect.objectContaining({ argumentName: 'resourceId' }),
    ]);
  });

  it('keeps the InteractionCatalog 1.10.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.10.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '7341b663fe5b6a6ce096a0aa370fb35b2345f3021a46e515d3e9476a5b630bf4',
    );
  });

  it('keeps the InteractionCatalog 1.11.0 compatibility snapshot byte-for-byte frozen', () => {
    const frozenBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog-1.11.0.json'),
    );

    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(
      '308cafdaa22bb64a66e98464e841c92916dcea5d4fead9be6689d1d931537880',
    );
  });

  it('keeps the latest TypeScript and Blender extension catalogs byte-identical', () => {
    const catalogBytes = readFileSync(
      resolve('adapters/blender/catalog/v1/interaction-catalog.json'),
    );
    const extensionBytes = readFileSync(
      resolve('adapters/blender/extension/operating_line/resources/interaction-catalog.json'),
    );

    expect(extensionBytes).toEqual(catalogBytes);
  });

  it('rejects duplicate catalogs and missing action catalog bindings', () => {
    const actionCatalogRegistry = createActionCatalogRegistry(blenderActionCatalogs);
    expect(() =>
      createInteractionCatalogRegistry(
        [blenderInteractionCatalog, blenderInteractionCatalog],
        actionCatalogRegistry,
      ),
    ).toThrow('Duplicate interaction catalog');

    const missingBinding = structuredClone(blenderInteractionCatalog);
    missingBinding.actionCatalogVersion = '2.0.0';
    expect(() => createInteractionCatalogRegistry([missingBinding], actionCatalogRegistry)).toThrow(
      'Action catalog blender@2.0.0 is not installed',
    );
  });

  it('rejects interaction catalogs that do not exactly cover the bound action catalog', () => {
    const mismatched = structuredClone(blenderInteractionCatalog);
    mismatched.recipes.pop();

    expect(() =>
      createInteractionCatalogRegistry(
        [mismatched],
        createActionCatalogRegistry(blenderActionCatalogs),
      ),
    ).toThrow('Interaction catalog action coverage mismatch');
  });

  it('rejects interaction catalog host and adapter ranges outside the ActionCatalog', () => {
    const actionCatalogRegistry = createActionCatalogRegistry(blenderActionCatalogs);
    const invalidHostRange = structuredClone(blenderInteractionCatalog);
    invalidHostRange.hostVersionRange = '>=9.0.0 <10.0.0';
    expect(() =>
      createInteractionCatalogRegistry([invalidHostRange], actionCatalogRegistry),
    ).toThrow('host range');

    const invalidAdapterRange = structuredClone(blenderInteractionCatalog);
    invalidAdapterRange.adapterVersionRange = '>=9.0.0 <10.0.0';
    expect(() =>
      createInteractionCatalogRegistry([invalidAdapterRange], actionCatalogRegistry),
    ).toThrow('adapter range');
  });

  it('fails closed for unavailable bindings and interaction catalog versions', () => {
    const registry = createInteractionCatalogRegistry(
      [blenderInteractionCatalog],
      createActionCatalogRegistry(blenderActionCatalogs),
    );

    expect(() => registry.get({ targetAdapterId: 'gimp', actionCatalogVersion: '1.0.0' })).toThrow(
      'No interaction catalog is installed',
    );
    expect(() =>
      registry.get({ targetAdapterId: 'blender', actionCatalogVersion: '1.0.0' }),
    ).toThrow('No interaction catalog is installed');
    expect(() =>
      registry.get({
        targetAdapterId: 'blender',
        actionCatalogVersion: blenderInteractionCatalog.actionCatalogVersion,
        interactionCatalogVersion: '2.0.0',
      }),
    ).toThrow('is not installed');
  });
});
