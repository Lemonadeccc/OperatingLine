"""Runtime-bound Blender project and render evidence for completed executions."""

from __future__ import annotations

import hashlib
import logging
from pathlib import Path
from typing import Any

import bpy

from ..application.session import ArtifactIdentity, DemoSession
from .snowman_actions.common import render_output_root

LOGGER = logging.getLogger(__name__)
_HASH_CHUNK_SIZE = 1024 * 1024


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as artifact:
        while chunk := artifact.read(_HASH_CHUNK_SIZE):
            digest.update(chunk)
    return digest.hexdigest()


def _unavailable(reason: str, *args: object) -> None:
    LOGGER.warning("Runtime artifact attestation unavailable: " + reason, *args)


def _render_artifacts(session: DemoSession) -> tuple[ArtifactIdentity, ...]:
    return tuple(
        artifact
        for receipt in session.receipts.values()
        for artifact in receipt.artifacts
        if artifact.media_type == "image/png"
        and artifact.frame is not None
        and artifact.render_engine is not None
        and artifact.color_management is not None
    )


def build_terminal_artifact_attestation(
    session: DemoSession,
    report_id: str,
) -> dict[str, Any] | None:
    """Save one project copy and bind it to the execution's unique PNG artifact."""

    if session.execution_id is None or session.plan_content_sha256 is None:
        return None
    render_artifacts = _render_artifacts(session)
    if len(render_artifacts) != 1:
        return None
    rendered = render_artifacts[0]
    rendered_path = Path(rendered.path)
    project_path: Path | None = None
    try:
        if not rendered_path.is_file():
            _unavailable("the qualified PNG is missing")
            return None
        if _sha256_file(rendered_path) != rendered.sha256:
            _unavailable("the qualified PNG hash changed after render")
            return None

        project_path = (
            render_output_root()
            / f"host-project-{session.execution_id}-{report_id}.blend"
        )
        if project_path.exists():
            _unavailable("the destination project copy already exists")
            return None
        result = bpy.ops.wm.save_as_mainfile(
            filepath=str(project_path),
            check_existing=False,
            copy=True,
        )
        if result != {"FINISHED"} or not project_path.is_file():
            _unavailable("Blender did not finish writing the project copy")
            if project_path.is_file():
                project_path.unlink()
            return None
        project_sha256 = _sha256_file(project_path)
    except (OSError, RuntimeError) as error:
        _unavailable("project copy failed: %s", error)
        if project_path is not None:
            try:
                if project_path.is_file():
                    project_path.unlink()
            except OSError as cleanup_error:
                _unavailable("partial project copy cleanup failed: %s", cleanup_error)
        return None

    return {
        "formatVersion": "1.0.0",
        "evidenceClass": "runtime_attested_host_artifacts",
        "planContentSha256": session.plan_content_sha256,
        "executionId": session.execution_id,
        "hostProject": {
            "artifactId": f"host.project.{session.execution_id}.{report_id}",
            "kind": "host_project",
            "mediaType": "application/x-blender",
            "contentSha256": project_sha256,
        },
        "renderedImage": {
            "artifactId": (
                f"render.{rendered.logical_id}.{session.execution_id}.{report_id}"
            ),
            "kind": "rendered_image",
            "mediaType": "image/png",
            "contentSha256": rendered.sha256,
            "width": rendered.width,
            "height": rendered.height,
            "frame": rendered.frame,
            "renderEngine": rendered.render_engine,
            "colorManagement": rendered.color_management,
            "hostProjectSha256": project_sha256,
        },
    }


__all__ = ("build_terminal_artifact_attestation",)
