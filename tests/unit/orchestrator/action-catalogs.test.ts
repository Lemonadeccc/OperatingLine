import { describe, expect, it } from 'vitest';

import { blenderActionCatalog, blenderActionCatalogs } from '@operatingline/blender-action-catalog';
import { createActionCatalogRegistry } from '@operatingline/orchestrator';

describe('action catalog registry', () => {
  it('selects the latest semantic catalog version and supports exact lookup', () => {
    const registry = createActionCatalogRegistry(blenderActionCatalogs);

    expect(registry.get({ targetAdapterId: 'blender' }).catalogVersion).toBe('1.11.0');
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
