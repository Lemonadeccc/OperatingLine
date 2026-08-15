import { describe, expect, it } from 'vitest';

import { blenderActionCatalog, blenderActionCatalogs } from '@operatingline/blender-action-catalog';
import { createActionCatalogRegistry } from '@operatingline/orchestrator';

describe('action catalog registry', () => {
  it('selects the latest semantic catalog version and supports exact lookup', () => {
    const registry = createActionCatalogRegistry(blenderActionCatalogs);

    expect(registry.get({ targetAdapterId: 'blender' }).catalogVersion).toBe('1.13.0');
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
    const active = structuredClone(blenderActionCatalog);
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
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
