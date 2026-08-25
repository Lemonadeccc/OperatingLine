"""Real-Blender proof for the 54-step no-bake Light Trails executor."""

from __future__ import annotations

import importlib.util
import math
from pathlib import Path
import struct
import sys
import traceback

import bpy


sys.dont_write_bytecode = True
REPO_ROOT = Path(__file__).resolve().parents[3]
ADAPTER_ROOT = REPO_ROOT / "adapters" / "blender" / "extension"

TARGET_ID = "guided.light_trails.target"
OBJECT_NAME = "OperatingLine.GuidedLightTrails.Target"
MODIFIER_ID = "guided.light_trails.modifier"
MODIFIER_NAME = "OperatingLine.GuidedLightTrails.Modifier"
NODE_GROUP_ID = "guided.light_trails.node_group"
NODE_GROUP_NAME = "OperatingLine.GuidedLightTrails.NodeGroup"
STEP_ID = "guided.light_trails.geometry"

ARGUMENTS = {
    "targetId": TARGET_ID,
    "modifierId": MODIFIER_ID,
    "modifierName": MODIFIER_NAME,
    "nodeGroupId": NODE_GROUP_ID,
    "nodeGroupName": NODE_GROUP_NAME,
    "trailCount": 12,
    "pointsPerTrail": 48,
    "tileLength": 20.0,
    "trailSpacing": 0.22,
    "noiseScale": 0.4,
    "noiseDetail": 3.0,
    "noiseRoughness": 0.55,
    "noiseSeed": 7.0,
    "height": 1.8,
    "profileSides": 4,
    "profileRadius": 0.025,
    "tileRepeatCount": 3,
}
EXPECTED_NODE_TYPES = (
    "NodeGroupInput",
    "NodeGroupOutput",
    "GeometryNodeCurvePrimitiveLine",
    "GeometryNodeResampleCurve",
    "GeometryNodeMeshLine",
    "GeometryNodeMeshLine",
    "GeometryNodeInstanceOnPoints",
    "GeometryNodeInstanceOnPoints",
    "GeometryNodeRealizeInstances",
    "GeometryNodeRealizeInstances",
    "GeometryNodeInputPosition",
    "ShaderNodeTexNoise",
    "ShaderNodeMath",
    "ShaderNodeMath",
    "ShaderNodeCombineXYZ",
    "GeometryNodeSetPosition",
    "GeometryNodeTransform",
    "GeometryNodeJoinGeometry",
    "GeometryNodeCurvePrimitiveCircle",
    "GeometryNodeCurveToMesh",
)
FORBIDDEN_NODE_TYPES = {
    "GeometryNodeBake",
    "GeometryNodeSimulationInput",
    "GeometryNodeSimulationOutput",
}


def _float32(value: float) -> float:
    return struct.unpack("f", struct.pack("f", float(value)))[0]


def _expected_rna_control_writes(
    ordinal: int, operation_ids: tuple[str, ...]
) -> list[dict]:
    def write(
        *,
        order: int,
        semantic_action: str,
        action_argument: str,
        node_name: str,
        node_type: str,
        socket_identifier: str,
        component_index: int | None,
        component_label: str | None,
        projection: str,
        before_value: float,
        accepted_value: int | float,
        projected_value: int | float,
    ) -> dict:
        return {
            "order": order,
            "executionMethod": "blender_rna_property_write",
            "mcpTool": (
                "operatingline.blender.geometry-nodes.light-trails.execute-next"
            ),
            "sourceOperationId": operation_ids[ordinal - 1],
            "semanticAction": semantic_action,
            "actionArgument": action_argument,
            "nodeGroupId": NODE_GROUP_ID,
            "nodeGroupName": NODE_GROUP_NAME,
            "nodeName": node_name,
            "nodeType": node_type,
            "socketIdentifier": socket_identifier,
            "propertyName": "default_value",
            "valueKind": (
                "scalar" if component_index is None else "vector_component"
            ),
            "componentIndex": component_index,
            "componentLabel": component_label,
            "projection": projection,
            "beforeValue": before_value,
            "acceptedValue": accepted_value,
            "projectedValue": projected_value,
            "observedValue": _float32(projected_value),
            "uiPath": [
                "Geometry Nodes",
                NODE_GROUP_NAME,
                node_name,
                socket_identifier,
                component_label or "Value",
            ],
        }

    if ordinal == 5:
        accepted = ARGUMENTS["tileLength"]
        return [
            write(
                order=1,
                semantic_action="node.light_trails.half_tile_line",
                action_argument="tileLength",
                node_name="OperatingLine Half Tile Line",
                node_type="GeometryNodeCurvePrimitiveLine",
                socket_identifier="Start",
                component_index=0,
                component_label="X",
                projection="negative_half_x",
                before_value=-0.5,
                accepted_value=accepted,
                projected_value=-accepted / 2.0,
            )
        ]
    if ordinal == 7:
        accepted = ARGUMENTS["pointsPerTrail"]
        return [
            write(
                order=1,
                semantic_action="node.light_trails.trail_resolution",
                action_argument="pointsPerTrail",
                node_name="OperatingLine Trail Resolution",
                node_type="GeometryNodeResampleCurve",
                socket_identifier="Count",
                component_index=None,
                component_label=None,
                projection="identity",
                before_value=10.0,
                accepted_value=accepted,
                projected_value=accepted,
            )
        ]
    if ordinal == 9:
        accepted = ARGUMENTS["trailCount"]
        return [
            write(
                order=1,
                semantic_action="node.light_trails.trail_rows",
                action_argument="trailCount",
                node_name="OperatingLine Trail Rows",
                node_type="GeometryNodeMeshLine",
                socket_identifier="Count",
                component_index=None,
                component_label=None,
                projection="identity",
                before_value=1.0,
                accepted_value=accepted,
                projected_value=accepted,
            ),
            write(
                order=2,
                semantic_action="node.light_trails.trail_rows",
                action_argument="trailCount",
                node_name="OperatingLine Trail Rows",
                node_type="GeometryNodeMeshLine",
                socket_identifier="Start Location",
                component_index=1,
                component_label="Y",
                projection="centered_rows_y_from_count",
                before_value=0.0,
                accepted_value=accepted,
                projected_value=-((accepted - 1) * 1.0) / 2.0,
            ),
        ]
    if ordinal == 10:
        accepted = ARGUMENTS["trailSpacing"]
        trail_count = ARGUMENTS["trailCount"]
        return [
            write(
                order=1,
                semantic_action="node.light_trails.trail_rows",
                action_argument="trailSpacing",
                node_name="OperatingLine Trail Rows",
                node_type="GeometryNodeMeshLine",
                socket_identifier="Start Location",
                component_index=1,
                component_label="Y",
                projection="centered_rows_y_from_spacing",
                before_value=_float32(-((trail_count - 1) * 1.0) / 2.0),
                accepted_value=accepted,
                projected_value=-((trail_count - 1) * accepted) / 2.0,
            ),
            write(
                order=2,
                semantic_action="node.light_trails.trail_rows",
                action_argument="trailSpacing",
                node_name="OperatingLine Trail Rows",
                node_type="GeometryNodeMeshLine",
                socket_identifier="Offset",
                component_index=1,
                component_label="Y",
                projection="identity",
                before_value=1.0,
                accepted_value=accepted,
                projected_value=accepted,
            ),
        ]
    if ordinal in {15, 16, 17, 18}:
        action_argument, socket_identifier, before_value = {
            15: ("noiseScale", "Scale", 1.0),
            16: ("noiseDetail", "Detail", 2.0),
            17: ("noiseRoughness", "Roughness", 0.5),
            18: ("noiseSeed", "W", 0.0),
        }[ordinal]
        accepted = ARGUMENTS[action_argument]
        return [
            write(
                order=1,
                semantic_action="node.light_trails.terrain_noise",
                action_argument=action_argument,
                node_name="OperatingLine Terrain Noise",
                node_type="ShaderNodeTexNoise",
                socket_identifier=socket_identifier,
                component_index=None,
                component_label=None,
                projection="identity",
                before_value=before_value,
                accepted_value=accepted,
                projected_value=accepted,
            )
        ]
    if ordinal == 21:
        accepted = ARGUMENTS["height"]
        return [
            write(
                order=1,
                semantic_action="node.light_trails.scale_height",
                action_argument="height",
                node_name="OperatingLine Scale Height",
                node_type="ShaderNodeMath",
                socket_identifier="Value_001",
                component_index=None,
                component_label=None,
                projection="identity",
                before_value=0.0,
                accepted_value=accepted,
                projected_value=accepted,
            )
        ]
    if ordinal == 27:
        accepted = ARGUMENTS["profileSides"]
        return [
            write(
                order=1,
                semantic_action="node.light_trails.trail_profile",
                action_argument="profileSides",
                node_name="OperatingLine Trail Profile",
                node_type="GeometryNodeCurvePrimitiveCircle",
                socket_identifier="Resolution",
                component_index=None,
                component_label=None,
                projection="identity",
                before_value=3.0,
                accepted_value=accepted,
                projected_value=accepted,
            )
        ]
    if ordinal == 28:
        accepted = ARGUMENTS["profileRadius"]
        return [
            write(
                order=1,
                semantic_action="node.light_trails.trail_profile",
                action_argument="profileRadius",
                node_name="OperatingLine Trail Profile",
                node_type="GeometryNodeCurvePrimitiveCircle",
                socket_identifier="Radius",
                component_index=None,
                component_label=None,
                projection="identity",
                before_value=_float32(0.1),
                accepted_value=accepted,
                projected_value=accepted,
            )
        ]
    if ordinal == 31:
        accepted = ARGUMENTS["tileRepeatCount"]
        tile_length = ARGUMENTS["tileLength"]
        return [
            write(
                order=1,
                semantic_action="node.light_trails.loop_tiles",
                action_argument="tileRepeatCount",
                node_name="OperatingLine Loop Tiles",
                node_type="GeometryNodeMeshLine",
                socket_identifier="Count",
                component_index=None,
                component_label=None,
                projection="identity",
                before_value=1.0,
                accepted_value=accepted,
                projected_value=accepted,
            ),
            write(
                order=2,
                semantic_action="node.light_trails.loop_tiles",
                action_argument="tileRepeatCount",
                node_name="OperatingLine Loop Tiles",
                node_type="GeometryNodeMeshLine",
                socket_identifier="Start Location",
                component_index=0,
                component_label="X",
                projection="centered_tiles_x_from_count",
                before_value=_float32(-((1 - 1) * tile_length) / 2.0),
                accepted_value=accepted,
                projected_value=-((accepted - 1) * tile_length) / 2.0,
            ),
        ]
    return []


def _expected_rna_initialization_writes(
    ordinal: int, operation_ids: tuple[str, ...]
) -> list[dict]:
    source_operation_id = operation_ids[ordinal - 1]

    def write(
        *,
        order: int,
        node_name: str,
        node_type: str,
        target_kind: str,
        socket_identifier: str | None,
        property_name: str,
        value_kind: str,
        component_index: int | None,
        component_label: str | None,
        value_source: str,
        action_argument: str | None,
        assigned_value: str | int | float,
        ui_target: str,
        ui_component: str,
    ) -> dict:
        return {
            "order": order,
            "executionMethod": "blender_rna_property_write",
            "mcpTool": (
                "operatingline.blender.geometry-nodes.light-trails.execute-next"
            ),
            "sourceOperationId": source_operation_id,
            "semanticAction": source_operation_id,
            "nodeGroupId": NODE_GROUP_ID,
            "nodeGroupName": NODE_GROUP_NAME,
            "nodeName": node_name,
            "nodeType": node_type,
            "targetKind": target_kind,
            "socketIdentifier": socket_identifier,
            "propertyName": property_name,
            "valueKind": value_kind,
            "componentIndex": component_index,
            "componentLabel": component_label,
            "valueSource": value_source,
            "actionArgument": action_argument,
            "assignedValue": assigned_value,
            "observedValue": (
                _float32(assigned_value)
                if isinstance(assigned_value, (int, float))
                else assigned_value
            ),
            "uiPath": [
                "Geometry Nodes",
                NODE_GROUP_NAME,
                node_name,
                ui_target,
                ui_component,
            ],
        }

    def node_property(
        order: int,
        node_name: str,
        node_type: str,
        property_name: str,
        assigned_value: str,
        ui_component: str,
    ) -> dict:
        return write(
            order=order,
            node_name=node_name,
            node_type=node_type,
            target_kind="node_property",
            socket_identifier=None,
            property_name=property_name,
            value_kind="enum",
            component_index=None,
            component_label=None,
            value_source="catalog_constant",
            action_argument=None,
            assigned_value=assigned_value,
            ui_target="Node",
            ui_component=ui_component,
        )

    def socket_value(
        order: int,
        node_name: str,
        node_type: str,
        socket_identifier: str,
        assigned_value: int | float,
        component_index: int | None = None,
        component_label: str | None = None,
        action_argument: str | None = None,
    ) -> dict:
        return write(
            order=order,
            node_name=node_name,
            node_type=node_type,
            target_kind="input_socket",
            socket_identifier=socket_identifier,
            property_name="default_value",
            value_kind=(
                "scalar" if component_index is None else "vector_component"
            ),
            component_index=component_index,
            component_label=component_label,
            value_source=(
                "catalog_constant"
                if action_argument is None
                else "accepted_action_argument"
            ),
            action_argument=action_argument,
            assigned_value=assigned_value,
            ui_target=socket_identifier,
            ui_component=component_label or "Value",
        )

    def vector_values(
        first_order: int,
        node_name: str,
        node_type: str,
        socket_identifier: str,
        values: tuple[float, float, float],
        accepted_argument_index: int | None = None,
    ) -> list[dict]:
        return [
            socket_value(
                first_order + component_index,
                node_name,
                node_type,
                socket_identifier,
                value,
                component_index,
                "XYZ"[component_index],
                (
                    "tileLength"
                    if component_index == accepted_argument_index
                    else None
                ),
            )
            for component_index, value in enumerate(values)
        ]

    if ordinal == 4:
        return [
            node_property(
                1,
                "OperatingLine Half Tile Line",
                "GeometryNodeCurvePrimitiveLine",
                "mode",
                "POINTS",
                "Mode",
            ),
            *vector_values(
                2,
                "OperatingLine Half Tile Line",
                "GeometryNodeCurvePrimitiveLine",
                "Start",
                (-0.5, 0.0, 0.0),
            ),
            *vector_values(
                5,
                "OperatingLine Half Tile Line",
                "GeometryNodeCurvePrimitiveLine",
                "End",
                (0.0, 0.0, 0.0),
            ),
        ]
    if ordinal == 6:
        return [
            socket_value(
                1,
                "OperatingLine Trail Resolution",
                "GeometryNodeResampleCurve",
                "Count",
                10,
            ),
        ]
    if ordinal == 8:
        return [
            node_property(
                1,
                "OperatingLine Trail Rows",
                "GeometryNodeMeshLine",
                "mode",
                "OFFSET",
                "Mode",
            ),
            socket_value(
                2,
                "OperatingLine Trail Rows",
                "GeometryNodeMeshLine",
                "Count",
                1,
            ),
            *vector_values(
                3,
                "OperatingLine Trail Rows",
                "GeometryNodeMeshLine",
                "Start Location",
                (0.0, 0.0, 0.0),
            ),
            *vector_values(
                6,
                "OperatingLine Trail Rows",
                "GeometryNodeMeshLine",
                "Offset",
                (0.0, 1.0, 0.0),
            ),
        ]
    if ordinal == 14:
        return [
            node_property(
                1,
                "OperatingLine Terrain Noise",
                "ShaderNodeTexNoise",
                "noise_dimensions",
                "4D",
                "Dimensions",
            ),
            *(
                socket_value(
                    order,
                    "OperatingLine Terrain Noise",
                    "ShaderNodeTexNoise",
                    socket_identifier,
                    value,
                )
                for order, (socket_identifier, value) in enumerate(
                    (
                        ("Scale", 1.0),
                        ("Detail", 2.0),
                        ("Roughness", 0.5),
                        ("W", 0.0),
                    ),
                    start=2,
                )
            ),
        ]
    if ordinal in {19, 20}:
        node_name, operation, value = {
            19: ("OperatingLine Center Noise", "SUBTRACT", 0.5),
            20: ("OperatingLine Scale Height", "MULTIPLY", 0.0),
        }[ordinal]
        return [
            node_property(
                1,
                node_name,
                "ShaderNodeMath",
                "operation",
                operation,
                "Operation",
            ),
            socket_value(
                2,
                node_name,
                "ShaderNodeMath",
                "Value_001",
                value,
            ),
        ]
    if ordinal == 24:
        return vector_values(
            1,
            "OperatingLine Mirror Half Tile",
            "GeometryNodeTransform",
            "Scale",
            (-1.0, 1.0, 1.0),
        )
    if ordinal == 26:
        return [
            node_property(
                1,
                "OperatingLine Trail Profile",
                "GeometryNodeCurvePrimitiveCircle",
                "mode",
                "RADIUS",
                "Mode",
            ),
            socket_value(
                2,
                "OperatingLine Trail Profile",
                "GeometryNodeCurvePrimitiveCircle",
                "Resolution",
                3,
            ),
            socket_value(
                3,
                "OperatingLine Trail Profile",
                "GeometryNodeCurvePrimitiveCircle",
                "Radius",
                0.1,
            ),
        ]
    if ordinal == 30:
        tile_length = ARGUMENTS["tileLength"]
        return [
            node_property(
                1,
                "OperatingLine Loop Tiles",
                "GeometryNodeMeshLine",
                "mode",
                "OFFSET",
                "Mode",
            ),
            socket_value(
                2,
                "OperatingLine Loop Tiles",
                "GeometryNodeMeshLine",
                "Count",
                1,
            ),
            *vector_values(
                3,
                "OperatingLine Loop Tiles",
                "GeometryNodeMeshLine",
                "Start Location",
                (-((1 - 1) * tile_length) / 2.0, 0.0, 0.0),
            ),
            *vector_values(
                6,
                "OperatingLine Loop Tiles",
                "GeometryNodeMeshLine",
                "Offset",
                (tile_length, 0.0, 0.0),
                accepted_argument_index=0,
            ),
        ]
    return []


_EXPECTED_STRUCTURE_TARGETS = {
    3: ("OperatingLine Input", "NodeGroupInput", "INPUT"),
    4: ("OperatingLine Half Tile Line", "GeometryNodeCurvePrimitiveLine", None),
    6: ("OperatingLine Trail Resolution", "GeometryNodeResampleCurve", None),
    8: ("OperatingLine Trail Rows", "GeometryNodeMeshLine", None),
    11: ("OperatingLine Trail Instances", "GeometryNodeInstanceOnPoints", None),
    12: ("OperatingLine Realize Trails", "GeometryNodeRealizeInstances", None),
    13: ("OperatingLine Trail Position", "GeometryNodeInputPosition", None),
    14: ("OperatingLine Terrain Noise", "ShaderNodeTexNoise", None),
    19: ("OperatingLine Center Noise", "ShaderNodeMath", None),
    20: ("OperatingLine Scale Height", "ShaderNodeMath", None),
    22: ("OperatingLine Z Offset", "ShaderNodeCombineXYZ", None),
    23: ("OperatingLine Displace Trails", "GeometryNodeSetPosition", None),
    24: ("OperatingLine Mirror Half Tile", "GeometryNodeTransform", None),
    25: ("OperatingLine Mirrored Tile", "GeometryNodeJoinGeometry", None),
    26: ("OperatingLine Trail Profile", "GeometryNodeCurvePrimitiveCircle", None),
    29: ("OperatingLine Curve To Mesh", "GeometryNodeCurveToMesh", None),
    30: ("OperatingLine Loop Tiles", "GeometryNodeMeshLine", None),
    32: ("OperatingLine Tile Instances", "GeometryNodeInstanceOnPoints", None),
    33: ("OperatingLine Realize Tiles", "GeometryNodeRealizeInstances", None),
    34: ("OperatingLine Output", "NodeGroupOutput", "OUTPUT"),
}


def _expected_rna_structure_creations(
    ordinal: int, operation_ids: tuple[str, ...]
) -> list[dict]:
    target = _EXPECTED_STRUCTURE_TARGETS.get(ordinal)
    if target is None:
        return []
    node_name, node_type, interface_direction = target
    source_operation_id = operation_ids[ordinal - 1]

    def common(order: int, execution_method: str, structure_kind: str) -> dict:
        return {
            "order": order,
            "executionMethod": execution_method,
            "mcpTool": (
                "operatingline.blender.geometry-nodes.light-trails.execute-next"
            ),
            "sourceOperationId": source_operation_id,
            "semanticAction": source_operation_id,
            "nodeGroupId": NODE_GROUP_ID,
            "nodeGroupName": NODE_GROUP_NAME,
            "structureKind": structure_kind,
        }

    node_order = 1 if interface_direction is None else 2
    node_creation = {
        **common(node_order, "blender_rna_node_create", "node"),
        "nodeName": node_name,
        "nodeType": node_type,
        "observedNode": True,
        "uiPath": ["Geometry Nodes", NODE_GROUP_NAME, "Nodes", node_name],
    }
    if interface_direction is None:
        return [node_creation]
    return [
        {
            **common(
                1,
                "blender_rna_node_group_interface_socket_create",
                "interface_socket",
            ),
            "interfaceSocketName": "Geometry",
            "interfaceDirection": interface_direction,
            "interfaceSocketType": "NodeSocketGeometry",
            "observedInterfaceSocket": True,
            "uiPath": [
                "Geometry Nodes",
                NODE_GROUP_NAME,
                "Interface",
                interface_direction,
                "Geometry",
            ],
        },
        node_creation,
    ]


def _expected_rna_resource_mutations(ordinal: int) -> list[dict]:
    if ordinal != 2:
        return []
    common = {
        "mcpTool": (
            "operatingline.blender.geometry-nodes.light-trails.execute-next"
        ),
        "sourceOperationId": "semantic.new_geometry_modifier",
        "semanticAction": "semantic.new_geometry_modifier",
        "targetId": TARGET_ID,
    }
    return [
        {
            **common,
            "order": 1,
            "executionMethod": "blender_rna_node_group_create",
            "mutationKind": "node_group_create",
            "nodeGroupId": NODE_GROUP_ID,
            "nodeGroupName": NODE_GROUP_NAME,
            "nodeTreeType": "GeometryNodeTree",
            "observedResource": True,
            "uiPath": ["Geometry Nodes", NODE_GROUP_NAME],
        },
        {
            **common,
            "order": 2,
            "executionMethod": "blender_rna_modifier_create",
            "mutationKind": "modifier_create",
            "modifierId": MODIFIER_ID,
            "modifierName": MODIFIER_NAME,
            "modifierType": "NODES",
            "observedResource": True,
            "uiPath": ["Properties", "Modifiers", MODIFIER_NAME],
        },
        {
            **common,
            "order": 3,
            "executionMethod": "blender_rna_modifier_node_group_bind",
            "mutationKind": "modifier_node_group_bind",
            "modifierId": MODIFIER_ID,
            "modifierName": MODIFIER_NAME,
            "nodeGroupId": NODE_GROUP_ID,
            "nodeGroupName": NODE_GROUP_NAME,
            "observedBinding": True,
            "uiPath": [
                "Properties",
                "Modifiers",
                MODIFIER_NAME,
                "Node Group",
                NODE_GROUP_NAME,
            ],
        },
    ]


_EXPECTED_LINK_TARGETS = {
    35: ("OperatingLine Half Tile Line", "GeometryNodeCurvePrimitiveLine", "Curve", "OperatingLine Trail Resolution", "GeometryNodeResampleCurve", "Curve"),
    36: ("OperatingLine Trail Rows", "GeometryNodeMeshLine", "Mesh", "OperatingLine Trail Instances", "GeometryNodeInstanceOnPoints", "Points"),
    37: ("OperatingLine Trail Resolution", "GeometryNodeResampleCurve", "Curve", "OperatingLine Trail Instances", "GeometryNodeInstanceOnPoints", "Instance"),
    38: ("OperatingLine Trail Instances", "GeometryNodeInstanceOnPoints", "Instances", "OperatingLine Realize Trails", "GeometryNodeRealizeInstances", "Geometry"),
    39: ("OperatingLine Trail Position", "GeometryNodeInputPosition", "Position", "OperatingLine Terrain Noise", "ShaderNodeTexNoise", "Vector"),
    40: ("OperatingLine Terrain Noise", "ShaderNodeTexNoise", "Fac", "OperatingLine Center Noise", "ShaderNodeMath", "Value"),
    41: ("OperatingLine Center Noise", "ShaderNodeMath", "Value", "OperatingLine Scale Height", "ShaderNodeMath", "Value"),
    42: ("OperatingLine Scale Height", "ShaderNodeMath", "Value", "OperatingLine Z Offset", "ShaderNodeCombineXYZ", "Z"),
    43: ("OperatingLine Realize Trails", "GeometryNodeRealizeInstances", "Geometry", "OperatingLine Displace Trails", "GeometryNodeSetPosition", "Geometry"),
    44: ("OperatingLine Z Offset", "ShaderNodeCombineXYZ", "Vector", "OperatingLine Displace Trails", "GeometryNodeSetPosition", "Offset"),
    45: ("OperatingLine Displace Trails", "GeometryNodeSetPosition", "Geometry", "OperatingLine Mirror Half Tile", "GeometryNodeTransform", "Geometry"),
    46: ("OperatingLine Displace Trails", "GeometryNodeSetPosition", "Geometry", "OperatingLine Mirrored Tile", "GeometryNodeJoinGeometry", "Geometry"),
    47: ("OperatingLine Mirror Half Tile", "GeometryNodeTransform", "Geometry", "OperatingLine Mirrored Tile", "GeometryNodeJoinGeometry", "Geometry"),
    48: ("OperatingLine Mirrored Tile", "GeometryNodeJoinGeometry", "Geometry", "OperatingLine Curve To Mesh", "GeometryNodeCurveToMesh", "Curve"),
    49: ("OperatingLine Trail Profile", "GeometryNodeCurvePrimitiveCircle", "Curve", "OperatingLine Curve To Mesh", "GeometryNodeCurveToMesh", "Profile Curve"),
    50: ("OperatingLine Loop Tiles", "GeometryNodeMeshLine", "Mesh", "OperatingLine Tile Instances", "GeometryNodeInstanceOnPoints", "Points"),
    51: ("OperatingLine Curve To Mesh", "GeometryNodeCurveToMesh", "Mesh", "OperatingLine Tile Instances", "GeometryNodeInstanceOnPoints", "Instance"),
    52: ("OperatingLine Tile Instances", "GeometryNodeInstanceOnPoints", "Instances", "OperatingLine Realize Tiles", "GeometryNodeRealizeInstances", "Geometry"),
    53: ("OperatingLine Realize Tiles", "GeometryNodeRealizeInstances", "Geometry", "OperatingLine Output", "NodeGroupOutput", "Geometry"),
}


def _expected_rna_link_creations(
    ordinal: int, operation_ids: tuple[str, ...]
) -> list[dict]:
    target = _EXPECTED_LINK_TARGETS.get(ordinal)
    if target is None:
        return []
    (
        from_node_name,
        from_node_type,
        from_socket_identifier,
        to_node_name,
        to_node_type,
        to_socket_identifier,
    ) = target
    source_operation_id = operation_ids[ordinal - 1]
    return [
        {
            "order": 1,
            "executionMethod": "blender_rna_node_link_create",
            "mcpTool": (
                "operatingline.blender.geometry-nodes.light-trails.execute-next"
            ),
            "sourceOperationId": source_operation_id,
            "semanticAction": source_operation_id,
            "nodeGroupId": NODE_GROUP_ID,
            "nodeGroupName": NODE_GROUP_NAME,
            "fromNodeName": from_node_name,
            "fromNodeType": from_node_type,
            "fromSocketIdentifier": from_socket_identifier,
            "fromSocketDirection": "OUTPUT",
            "toNodeName": to_node_name,
            "toNodeType": to_node_type,
            "toSocketIdentifier": to_socket_identifier,
            "toSocketDirection": "INPUT",
            "observedLink": True,
            "uiPath": [
                "Geometry Nodes",
                NODE_GROUP_NAME,
                from_node_name,
                from_socket_identifier,
                to_node_name,
                to_socket_identifier,
            ],
        }
    ]


def _step(
    step_id: str,
    order: int,
    action: dict | None,
    *,
    depends_on: list[str] | None = None,
    expected_observations: list[dict] | None = None,
) -> dict:
    result = {
        "id": step_id,
        "parentId": None if step_id == "root" else "root",
        "order": order,
        "dependsOn": depends_on or [],
        "title": step_id,
        "action": action,
    }
    if expected_observations is not None:
        result["expectedObservations"] = expected_observations
        result["observationPolicy"] = {
            "mode": "success_gate",
            "failureStrategy": "retain_for_repair",
        }
    return result


PLAN = {
    "protocolVersion": "1.6.0",
    "rootStepId": "root",
    "steps": [
        _step("root", 0, None),
        _step(
            "guided.light_trails.target",
            1,
            {
                "adapterId": "blender",
                "name": "blender.mesh.create_cube",
                "arguments": {
                    "resourceId": TARGET_ID,
                    "objectName": OBJECT_NAME,
                    "size": 2.0,
                    "location": [0.0, 0.0, 0.0],
                },
            },
        ),
        _step(
            STEP_ID,
            2,
            {
                "adapterId": "blender",
                "name": "blender.geometry_nodes.create_light_trails",
                "arguments": ARGUMENTS,
            },
            depends_on=["guided.light_trails.target"],
            expected_observations=[
                {
                    "kind": "light_trails_ready",
                    "parameters": {
                        **ARGUMENTS,
                        "nodeTypes": list(EXPECTED_NODE_TYPES),
                    },
                }
            ],
        ),
    ],
}


def _load_extension():
    spec = importlib.util.spec_from_file_location(
        "operating_line_guided_light_trails_integration",
        ADAPTER_ROOT / "__init__.py",
        submodule_search_locations=[str(ADAPTER_ROOT)],
    )
    assert spec is not None and spec.loader is not None
    extension = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = extension
    spec.loader.exec_module(extension)
    return extension


def _assert_final_graph(target) -> None:
    modifier = target.modifiers.get(MODIFIER_NAME)
    assert modifier is not None and modifier.type == "NODES"
    node_group = modifier.node_group
    assert node_group is bpy.data.node_groups.get(NODE_GROUP_NAME)
    assert len(node_group.nodes) == 20
    assert len(node_group.links) == 19
    assert sorted(node.bl_idname for node in node_group.nodes) == sorted(
        EXPECTED_NODE_TYPES
    )
    assert not FORBIDDEN_NODE_TYPES.intersection(
        node.bl_idname for node in node_group.nodes
    )
    assert len(modifier.bakes) == 0
    assert modifier.bake_directory == ""

    evaluated = target.evaluated_get(bpy.context.evaluated_depsgraph_get())
    expected_vertex_count = (
        ARGUMENTS["trailCount"]
        * ARGUMENTS["pointsPerTrail"]
        * ARGUMENTS["profileSides"]
        * ARGUMENTS["tileRepeatCount"]
        * 2
    )
    assert len(evaluated.data.vertices) == expected_vertex_count
    assert len(evaluated.data.edges) > 0
    assert len(evaluated.data.polygons) > 0
    assert all(
        math.isfinite(component)
        for vertex in evaluated.data.vertices
        for component in vertex.co
    )


def _record_result(session, step, run, operation_ids, ordinal, result):
    run = session.record_leaf_operation(
        step,
        run_id=run.run_id,
        operation_id=operation_ids[ordinal - 1],
        ordinal=ordinal,
        before_sha256=result.before_fingerprint,
        after_sha256=result.after_fingerprint,
        observation=result.observation,
        partial_action_receipt=None if ordinal == 1 else result.receipt,
    )
    assert run.next_ordinal == ordinal + 1
    assert len(run.operation_receipts) == ordinal
    recorded = run.operation_receipts[-1]
    assert recorded.operation_id == operation_ids[ordinal - 1]
    assert recorded.observation["details"]["runId"] == run.run_id
    assert recorded.observation["details"]["recipeId"] == run.recipe_id
    assert recorded.observation["details"]["catalogVersion"] == run.catalog_version
    return run


def _execute_pass(
    session,
    step,
    snapshot,
    definition,
    operation_module,
    *,
    inject_failure: bool,
    limit: int = 54,
):
    operation_ids = tuple(operation.operation_id for operation in snapshot.operations)
    run = session.begin_leaf_operation_run(
        step,
        recipe_id=snapshot.recipe_id,
        catalog_version=snapshot.catalog_version,
        operation_ids=operation_ids,
    )
    transaction = None
    failure_injected = False
    for ordinal in range(1, limit + 1):
        if inject_failure and ordinal == 15:
            original_validate = operation_module._validate_stage
            raised = False

            def validate_then_fail(node_group, stage, accepted):
                nonlocal raised
                original_validate(node_group, stage, accepted)
                if stage == 15 and not raised:
                    raised = True
                    raise RuntimeError("injected post-mutation stage-15 failure")

            operation_module._validate_stage = validate_then_fail
            before_transaction = transaction
            try:
                operation_module.execute_light_trails_operation(
                    operation_ordinal=ordinal,
                    receipt_id=run.leaf_receipt_id,
                    step_id=step.id,
                    action_name=step.action.name,
                    receipts=session.receipts,
                    definition=definition,
                    transaction=transaction,
                )
            except RuntimeError as error:
                assert "injected post-mutation" in str(error)
                failure_injected = True
            else:
                raise AssertionError("The injected stage-15 failure did not fire")
            finally:
                operation_module._validate_stage = original_validate
            assert transaction is before_transaction
            node_group = bpy.data.node_groups[NODE_GROUP_NAME]
            original_validate(node_group, 14, definition)
            noise = node_group.nodes["OperatingLine Terrain Noise"]
            assert math.isclose(float(noise.inputs["Scale"].default_value), 1.0)

        result = operation_module.execute_light_trails_operation(
            operation_ordinal=ordinal,
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            transaction=transaction,
        )
        transaction = result.transaction
        assert result.observation["details"]["evidence"][
            "rnaControlWrites"
        ] == _expected_rna_control_writes(ordinal, operation_ids)
        assert result.observation["details"]["evidence"][
            "rnaInitializationWrites"
        ] == _expected_rna_initialization_writes(ordinal, operation_ids)
        assert result.observation["details"]["evidence"][
            "rnaLinkCreations"
        ] == _expected_rna_link_creations(ordinal, operation_ids)
        assert result.observation["details"]["evidence"][
            "rnaStructureCreations"
        ] == _expected_rna_structure_creations(ordinal, operation_ids)
        assert result.observation["details"]["evidence"][
            "rnaResourceMutations"
        ] == _expected_rna_resource_mutations(ordinal)
        run = _record_result(session, step, run, operation_ids, ordinal, result)
        assert result.observation["details"]["mutating"] is (1 < ordinal < 54)
        if ordinal in {1, 15, 31, 53, 54}:
            assert operation_module.verify_light_trails_stage(
                receipt_id=run.leaf_receipt_id,
                step_id=step.id,
                action_name=step.action.name,
                receipts=session.receipts,
                definition=definition,
                completed_operations=tuple(range(1, ordinal + 1)),
                expected_fingerprint=result.after_fingerprint,
                partial_receipt=run.partial_action_receipt,
            )

        if inject_failure and ordinal in {31, 53, 54}:
            inverse = operation_module.inverse_light_trails_operation(
                operation_ordinal=ordinal,
                receipt_id=run.leaf_receipt_id,
                step_id=step.id,
                action_name=step.action.name,
                receipts=session.receipts,
                definition=definition,
                transaction=transaction,
            )
            transaction = inverse.transaction
            run = session.rewind_leaf_operation(
                step,
                run_id=run.run_id,
                operation_id=operation_ids[ordinal - 1],
                ordinal=ordinal,
                partial_action_receipt=inverse.receipt,
            )
            assert run.next_ordinal == ordinal
            replay = operation_module.execute_light_trails_operation(
                operation_ordinal=ordinal,
                receipt_id=run.leaf_receipt_id,
                step_id=step.id,
                action_name=step.action.name,
                receipts=session.receipts,
                definition=definition,
                transaction=transaction,
            )
            transaction = replay.transaction
            run = _record_result(
                session, step, run, operation_ids, ordinal, replay
            )

    if inject_failure:
        assert failure_injected
    return run, transaction, operation_ids


def main() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    _load_extension()

    from operating_line_guided_light_trails_integration.operating_line.application import (
        DemoSession,
        MenuGuidanceTracker,
    )
    from operating_line_guided_light_trails_integration.operating_line.domain import (
        load_task_tree_data,
    )
    from operating_line_guided_light_trails_integration.operating_line.infrastructure import (
        action_registry,
    )
    from operating_line_guided_light_trails_integration.operating_line.infrastructure import (
        guided_light_trails_operations as operation_module,
    )
    from operating_line_guided_light_trails_integration.operating_line.infrastructure.observations import (
        evaluate_observations,
    )
    from operating_line_guided_light_trails_integration.operating_line.infrastructure.snowman_actions.editing import (
        validate_geometry_nodes_light_trails,
    )

    root = load_task_tree_data(PLAN)
    session = DemoSession(
        root,
        action_registry(root),
        plan_id="guided-light-trails-operations-integration",
        revision=1,
        observation_evaluator=evaluate_observations,
    )
    session.start()
    assert session.next().id == "guided.light_trails.target"
    assert session.active_index == 0
    step = session.guidance_step
    assert step is not None and step.id == STEP_ID
    snapshot = MenuGuidanceTracker().snapshot(step)
    assert snapshot is not None
    assert snapshot.recipe_id == "blender.geometry_nodes.create_light_trails.semantic"
    assert snapshot.catalog_version == "1.69.0"
    operation_ids = tuple(operation.operation_id for operation in snapshot.operations)
    assert operation_ids == operation_module.LIGHT_TRAILS_OPERATION_IDS
    definition = validate_geometry_nodes_light_trails(step.action.arguments)

    run, transaction, operation_ids = _execute_pass(
        session,
        step,
        snapshot,
        definition,
        operation_module,
        inject_failure=True,
    )
    try:
        operation_module.inverse_light_trails_operation(
            operation_ordinal=53,
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            transaction=transaction,
        )
    except RuntimeError as error:
        assert "latest operation" in str(error)
    else:
        raise AssertionError("A non-LIFO Light Trails inverse was accepted")

    for ordinal in range(54, 0, -1):
        inverse = operation_module.inverse_light_trails_operation(
            operation_ordinal=ordinal,
            receipt_id=run.leaf_receipt_id,
            step_id=step.id,
            action_name=step.action.name,
            receipts=session.receipts,
            definition=definition,
            transaction=transaction,
        )
        transaction = inverse.transaction
        run = session.rewind_leaf_operation(
            step,
            run_id=run.run_id,
            operation_id=operation_ids[ordinal - 1],
            ordinal=ordinal,
            partial_action_receipt=(
                None if ordinal in {1, 2} else inverse.receipt
            ),
        )
        if ordinal > 1:
            assert run is not None and run.next_ordinal == ordinal
        else:
            assert run is None
    assert transaction.completed_operations == ()
    target = bpy.data.objects[OBJECT_NAME]
    assert target.modifiers.get(MODIFIER_NAME) is None
    assert bpy.data.node_groups.get(NODE_GROUP_NAME) is None
    assert session.pending_leaf_operation_run is None

    run, _transaction, _operation_ids = _execute_pass(
        session,
        step,
        snapshot,
        definition,
        operation_module,
        inject_failure=False,
        limit=31,
    )
    assert run.next_ordinal == 32
    assert session.abort_leaf_operation_run() is step
    assert session.pending_leaf_operation_run is None
    target = bpy.data.objects[OBJECT_NAME]
    assert target.modifiers.get(MODIFIER_NAME) is None
    assert bpy.data.node_groups.get(NODE_GROUP_NAME) is None

    run, transaction, operation_ids = _execute_pass(
        session,
        step,
        snapshot,
        definition,
        operation_module,
        inject_failure=False,
    )
    assert transaction.completed_operations == tuple(range(1, 55))
    partial_receipt = run.partial_action_receipt
    completed = session.complete_leaf_operation_run(step, run_id=run.run_id)
    assert completed.status == "completed"
    assert len(completed.operation_receipts) == 54
    assert session.receipts[step.id] == partial_receipt
    assert session.pending_leaf_operation_run is None
    assert session.active_index == 1

    target = bpy.data.objects[OBJECT_NAME]
    _assert_final_graph(target)
    observations = session.success_gate_observation_copy(step.id)
    assert observations is not None and len(observations) == 1
    assert observations[0]["kind"] == "light_trails_ready"
    assert observations[0]["satisfied"] is True
    assert observations[0]["details"]["semanticSignatureMatches"] is True
    assert observations[0]["details"]["linkTopologyMatches"] is True
    assert observations[0]["details"]["evaluatedVertexCountMatches"] is True
    assert observations[0]["details"]["bakeCount"] == 0

    assert session.back() is step
    assert target.modifiers.get(MODIFIER_NAME) is None
    assert bpy.data.node_groups.get(NODE_GROUP_NAME) is None
    assert session.back() is not None
    assert bpy.data.objects.get(OBJECT_NAME) is None

    print(
        "OperatingLine guided Light Trails proof passed: "
        "54 forward + 54 inverse + compensation + abort + completion",
        bpy.app.version_string,
        flush=True,
    )


try:
    main()
except BaseException:
    traceback.print_exc()
    sys.stdout.flush()
    sys.stderr.flush()
    raise
