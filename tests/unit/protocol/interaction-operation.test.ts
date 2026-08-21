import { describe, expect, it } from 'vitest';

import {
  assertInteractionOperationCatalogAuthorized,
  interactionOperationKindValues,
  interactionOperationSchema,
} from '@operatingline/protocol';

describe('interaction operation protocol', () => {
  it('accepts exactly the seven catalog-driven operation variants', () => {
    const operations = [
      { kind: 'invoke_menu', menuHostId: 'VIEW3D_MT_edit_mesh_faces' },
      {
        kind: 'select_menu_item',
        menuHostId: 'VIEW3D_MT_edit_mesh_faces',
        itemOperatorId: 'mesh.inset',
      },
      { kind: 'send_shortcut', shortcutId: 'blender.edit.subdivide.search_f3' },
      { kind: 'open_adjust_last_operation', expectedOperatorId: 'mesh.subdivide' },
      {
        kind: 'set_f9_control',
        expectedOperatorId: 'mesh.subdivide',
        controlHostId: 'mesh.subdivide.number_cuts',
        typedValue: 4,
      },
      { kind: 'confirm_f9', expectedOperatorId: 'mesh.subdivide' },
      {
        kind: 'assert_interaction_state',
        workspace: 'Layout',
        editor: 'VIEW_3D',
        mode: 'EDIT_MESH',
        selection: 'all_mesh_elements',
        modalState: 'idle',
      },
    ];

    expect(operations.map((operation) => interactionOperationSchema.parse(operation).kind)).toEqual(
      interactionOperationKindValues,
    );
  });

  it('keeps typed F9 values finite and closed to scalar or short numeric vectors', () => {
    const base = {
      kind: 'set_f9_control',
      expectedOperatorId: 'transform.translate',
      controlHostId: 'transform.translate.value',
    } as const;

    expect(interactionOperationSchema.parse({ ...base, typedValue: [1, 2, 3] })).toMatchObject(
      base,
    );
    expect(() => interactionOperationSchema.parse({ ...base, typedValue: Number.NaN })).toThrow();
    expect(() =>
      interactionOperationSchema.parse({ ...base, typedValue: [1, 2, 3, 4, 5] }),
    ).toThrow();
    expect(() =>
      interactionOperationSchema.parse({ ...base, typedValue: { expression: '1+1' } }),
    ).toThrow();
  });

  it.each([
    { kind: 'invoke_menu', menuHostId: 'VIEW3D_MT_mesh_add', x: 40, y: 80 },
    { kind: 'send_shortcut', shortcutId: 'blender.edit.subdivide', keys: ['F3', 'ENTER'] },
    {
      kind: 'select_menu_item',
      menuHostId: 'VIEW3D_MT_mesh_add',
      itemOperatorId: 'python.exec',
      python: 'pass',
    },
    { kind: 'invoke_operator', operatorId: 'mesh.inset' },
    { kind: 'send_shortcut', shortcutId: 'Ctrl B' },
  ])('rejects escape-hatch or non-catalog input %#', (operation) => {
    expect(() => interactionOperationSchema.parse(operation)).toThrow();
  });

  it('rejects a syntactically valid id absent from the bound catalog', () => {
    const knownIds = new Set(['blender.edit.inset']);
    const resolver = {
      isAuthorizedInteractionId: (_field: string, id: string) => knownIds.has(id),
    };
    expect(
      assertInteractionOperationCatalogAuthorized(
        { kind: 'send_shortcut', shortcutId: 'blender.edit.inset' },
        resolver,
      ),
    ).toMatchObject({ shortcutId: 'blender.edit.inset' });
    expect(() =>
      assertInteractionOperationCatalogAuthorized(
        { kind: 'send_shortcut', shortcutId: 'blender.edit.dangerous_but_valid' },
        resolver,
      ),
    ).toThrow(/not authorized/u);
  });
});
