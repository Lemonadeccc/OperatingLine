"""Synchronize Blender native Undo/Redo with the in-memory guide session."""

from collections.abc import Callable, Mapping
from dataclasses import dataclass, replace
import hashlib
import os
from pathlib import Path
import tempfile
from typing import Any
import uuid

import bpy
from bpy.app.handlers import persistent

from ..application import DemoSession, SessionSnapshot
from ..application.session import ArtifactIdentity
from .snowman_actions.common import (
    ensure_receipts_intact,
    rebind_receipts_after_native_restore,
)


NATIVE_HISTORY_MARKER_KEY = "_operating_line_native_history_v1"
MAX_ARTIFACT_BYTES = 64 * 1024 * 1024
MAX_ARTIFACT_CACHE_BYTES = 256 * 1024 * 1024


@dataclass(frozen=True, slots=True)
class NativeHistoryCheckpoint:
    """One session snapshot paired with Blender's matching Scene marker."""

    checkpoint_id: str | None
    previous_id: str | None
    operation: str
    snapshot: SessionSnapshot
    artifacts: tuple[ArtifactIdentity, ...]


@dataclass(frozen=True, slots=True)
class NativeHistoryRestore:
    """A completed host-history transition for UI and companion reporting."""

    direction: str
    source_operation: str
    target_operation: str
    before: SessionSnapshot
    after: SessionSnapshot


SessionProvider = Callable[[], DemoSession]
RestoreCallback = Callable[[NativeHistoryRestore], None]
ResetCallback = Callable[[], None]


def _sha256(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _read_bounded(path: Path) -> bytes:
    try:
        size = path.stat().st_size
    except OSError as error:
        raise RuntimeError(f"Cannot inspect native Undo artifact: {path}") from error
    if size > MAX_ARTIFACT_BYTES:
        raise RuntimeError(f"Native Undo artifact is too large: {path.name}")
    try:
        content = path.read_bytes()
    except OSError as error:
        raise RuntimeError(f"Cannot read native Undo artifact: {path}") from error
    if len(content) > MAX_ARTIFACT_BYTES:
        raise RuntimeError(f"Native Undo artifact is too large: {path.name}")
    return content


def _write_atomic(path: Path, content: bytes) -> None:
    if not path.parent.is_dir():
        raise RuntimeError(
            f"Native Undo artifact directory is unavailable: {path.parent}"
        )
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent,
        prefix=f".{path.name}.operating-line-",
    )
    temporary_path = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary_path, path)
    except Exception:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


class NativeHistoryController:
    """Own the checkpoint journal used by Blender history handlers."""

    def __init__(self) -> None:
        self._session_provider: SessionProvider | None = None
        self._restore_callback: RestoreCallback | None = None
        self._reset_callback: ResetCallback | None = None
        self._checkpoints: dict[str | None, NativeHistoryCheckpoint] = {}
        self._artifact_blobs: dict[str, bytes] = {}
        self._owner_scene_uid: int | None = None
        self._current_id: str | None = None
        self._prepared_from: str | None = None
        self._prepared_operation: str | None = None
        self._registered = False
        self._handling = False
        self.error = ""

    @property
    def registered(self) -> bool:
        return self._registered

    @property
    def checkpoint_count(self) -> int:
        return len(self._checkpoints)

    def _owner_scene(self) -> bpy.types.Scene | None:
        if self._owner_scene_uid is None:
            return None
        return next(
            (
                scene
                for scene in bpy.data.scenes
                if scene.session_uid == self._owner_scene_uid
            ),
            None,
        )

    @staticmethod
    def _marker(scene: bpy.types.Scene) -> str | None:
        value = scene.get(NATIVE_HISTORY_MARKER_KEY)
        if value is None:
            return None
        if not isinstance(value, str) or not value:
            raise RuntimeError("Blender native Undo marker is invalid")
        return value

    @staticmethod
    def _remove_markers() -> None:
        for scene in bpy.data.scenes:
            if NATIVE_HISTORY_MARKER_KEY in scene:
                del scene[NATIVE_HISTORY_MARKER_KEY]

    def _clear_journal(self) -> None:
        self._checkpoints.clear()
        self._artifact_blobs.clear()
        self._owner_scene_uid = None
        self._current_id = None
        self._prepared_from = None
        self._prepared_operation = None
        self._handling = False
        self.error = ""

    def register(
        self,
        session_provider: SessionProvider,
        restore_callback: RestoreCallback,
        reset_callback: ResetCallback,
    ) -> None:
        self._session_provider = session_provider
        self._restore_callback = restore_callback
        self._reset_callback = reset_callback
        if self._registered:
            return
        self._remove_markers()
        self._clear_journal()
        for handlers, callback in (
            (bpy.app.handlers.undo_post, _undo_post),
            (bpy.app.handlers.redo_post, _redo_post),
            (bpy.app.handlers.load_post, _load_post),
        ):
            if callback not in handlers:
                handlers.append(callback)
        self._registered = True

    def unregister(self) -> None:
        if self._registered:
            for handlers, callback in (
                (bpy.app.handlers.undo_post, _undo_post),
                (bpy.app.handlers.redo_post, _redo_post),
                (bpy.app.handlers.load_post, _load_post),
            ):
                if callback in handlers:
                    handlers.remove(callback)
        self._remove_markers()
        self._clear_journal()
        self._session_provider = None
        self._restore_callback = None
        self._reset_callback = None
        self._registered = False

    def discard(self) -> None:
        """End the current session's history without rolling Blender data back."""
        self._remove_markers()
        self._clear_journal()

    def _capture_artifacts(
        self,
        snapshot: SessionSnapshot,
    ) -> tuple[ArtifactIdentity, ...]:
        artifacts = tuple(
            artifact
            for _step_id, receipt in snapshot.receipts
            for artifact in receipt.artifacts
        )
        seen_paths: dict[str, str] = {}
        for artifact in artifacts:
            path = Path(artifact.path)
            if not path.is_absolute():
                raise RuntimeError(
                    f"Native Undo artifact path is not absolute: {artifact.logical_id}"
                )
            prior_sha256 = seen_paths.get(artifact.path)
            if prior_sha256 is not None and prior_sha256 != artifact.sha256:
                raise RuntimeError(
                    f"Native Undo artifact path is ambiguous: {artifact.path}"
                )
            seen_paths[artifact.path] = artifact.sha256
            if not path.is_file():
                raise RuntimeError(
                    f"Native Undo artifact is unavailable: {artifact.logical_id}"
                )
            content = _read_bounded(path)
            if _sha256(content) != artifact.sha256:
                raise RuntimeError(
                    f"Native Undo artifact was modified: {artifact.logical_id}"
                )
            if artifact.sha256 not in self._artifact_blobs:
                cached_bytes = sum(len(item) for item in self._artifact_blobs.values())
                if cached_bytes + len(content) > MAX_ARTIFACT_CACHE_BYTES:
                    raise RuntimeError("Native Undo artifact cache limit was reached")
                self._artifact_blobs[artifact.sha256] = content
        return artifacts

    def _checkpoint(
        self,
        checkpoint_id: str | None,
        previous_id: str | None,
        operation: str,
        session: DemoSession,
    ) -> NativeHistoryCheckpoint:
        snapshot = session.snapshot_state()
        return NativeHistoryCheckpoint(
            checkpoint_id=checkpoint_id,
            previous_id=previous_id,
            operation=operation,
            snapshot=snapshot,
            artifacts=self._capture_artifacts(snapshot),
        )

    def _prune_redo_branches(self) -> None:
        retained: set[str | None] = set()
        checkpoint_id = self._current_id
        while checkpoint_id not in retained:
            retained.add(checkpoint_id)
            checkpoint = self._checkpoints.get(checkpoint_id)
            if checkpoint is None or checkpoint_id is None:
                break
            checkpoint_id = checkpoint.previous_id
        self._checkpoints = {
            key: checkpoint
            for key, checkpoint in self._checkpoints.items()
            if key in retained
        }
        retained_hashes = {
            artifact.sha256
            for checkpoint in self._checkpoints.values()
            for artifact in checkpoint.artifacts
        }
        self._artifact_blobs = {
            digest: content
            for digest, content in self._artifact_blobs.items()
            if digest in retained_hashes
        }

    def prepare(
        self,
        session: DemoSession,
        scene: bpy.types.Scene,
        operation: str,
    ) -> None:
        if not self._registered:
            raise RuntimeError("Blender native Undo integration is not registered")
        if self.error:
            raise RuntimeError(self.error)
        if self._prepared_operation is not None:
            raise RuntimeError("A Blender native Undo checkpoint is already pending")
        if self._owner_scene_uid is None:
            self._owner_scene_uid = scene.session_uid
            try:
                marker = self._marker(scene)
            except RuntimeError as error:
                self._set_error(error)
                raise RuntimeError(self.error) from error
            if marker is not None:
                error = RuntimeError("Blender native Undo marker is already in use")
                self._set_error(error)
                raise RuntimeError(self.error) from error
            self._checkpoints[None] = self._checkpoint(
                None,
                None,
                "root",
                session,
            )
            self._current_id = None
        owner = self._owner_scene()
        if owner is None:
            error = RuntimeError("Blender native Undo owner Scene is unavailable")
            self._set_error(error)
            raise RuntimeError(self.error) from error
        try:
            marker = self._marker(owner)
        except RuntimeError as error:
            self._set_error(error)
            raise RuntimeError(self.error) from error
        if marker != self._current_id:
            error = RuntimeError("Blender native Undo marker is out of sync")
            self._set_error(error)
            raise RuntimeError(self.error) from error
        current = self._checkpoints.get(self._current_id)
        if current is None:
            error = RuntimeError("Blender native Undo checkpoint is unavailable")
            self._set_error(error)
            raise RuntimeError(self.error) from error
        self._checkpoints[self._current_id] = self._checkpoint(
            current.checkpoint_id,
            current.previous_id,
            current.operation,
            session,
        )
        self._prepared_from = self._current_id
        self._prepared_operation = operation

    def cancel(self) -> None:
        self._prepared_from = None
        self._prepared_operation = None

    def prepared_state_changed(self, session: DemoSession) -> bool:
        if self._prepared_operation is None:
            return False
        checkpoint = self._checkpoints.get(self._prepared_from)
        return checkpoint is not None and session.snapshot_state() != checkpoint.snapshot

    def commit(self, session: DemoSession) -> str:
        operation = self._prepared_operation
        if operation is None:
            raise RuntimeError("No Blender native Undo checkpoint was prepared")
        try:
            owner = self._owner_scene()
            if owner is None:
                raise RuntimeError("Blender native Undo owner Scene is unavailable")
            previous_id = self._prepared_from
            self._prune_redo_branches()
            checkpoint_id = str(uuid.uuid4())
            checkpoint = self._checkpoint(
                checkpoint_id,
                previous_id,
                operation,
                session,
            )
            owner[NATIVE_HISTORY_MARKER_KEY] = checkpoint_id
            if self._marker(owner) != checkpoint_id:
                raise RuntimeError("Blender rejected the native Undo marker")
        except Exception as error:
            self._set_error(error)
            raise RuntimeError(self.error) from error
        self._checkpoints[checkpoint_id] = checkpoint
        self._current_id = checkpoint_id
        self.cancel()
        return checkpoint_id

    @staticmethod
    def _artifact_map(
        checkpoint: NativeHistoryCheckpoint,
    ) -> dict[Path, ArtifactIdentity]:
        return {Path(artifact.path): artifact for artifact in checkpoint.artifacts}

    def _apply_artifact_transition(
        self,
        source: NativeHistoryCheckpoint,
        target: NativeHistoryCheckpoint,
    ) -> Callable[[], None]:
        source_artifacts = self._artifact_map(source)
        target_artifacts = self._artifact_map(target)
        paths = tuple(sorted(source_artifacts.keys() | target_artifacts.keys()))
        before: dict[Path, bytes | None] = {}
        target_content: dict[Path, bytes | None] = {}
        applied: dict[Path, bytes | None] = {}

        for path in paths:
            actual = _read_bounded(path) if path.is_file() else None
            before[path] = actual
            actual_sha256 = _sha256(actual) if actual is not None else None
            source_artifact = source_artifacts.get(path)
            target_artifact = target_artifacts.get(path)
            if target_artifact is None:
                if actual is not None and (
                    source_artifact is None
                    or actual_sha256 != source_artifact.sha256
                ):
                    raise RuntimeError(
                        f"Cannot remove modified native Undo artifact: {path.name}"
                    )
                target_content[path] = None
                continue
            blob = self._artifact_blobs.get(target_artifact.sha256)
            if blob is None or _sha256(blob) != target_artifact.sha256:
                raise RuntimeError(
                    f"Native Undo artifact backup is unavailable: {path.name}"
                )
            if actual is not None and actual_sha256 not in {
                target_artifact.sha256,
                source_artifact.sha256 if source_artifact is not None else None,
            }:
                raise RuntimeError(
                    f"Cannot replace modified native Undo artifact: {path.name}"
                )
            target_content[path] = blob

        def restore_before() -> None:
            for path, expected in applied.items():
                current = _read_bounded(path) if path.is_file() else None
                if current != expected:
                    raise RuntimeError(
                        f"Native Undo artifact changed during recovery: {path.name}"
                    )
            for path, content in before.items():
                if path not in applied:
                    continue
                if content is None:
                    path.unlink(missing_ok=True)
                else:
                    _write_atomic(path, content)

        try:
            for path, content in target_content.items():
                current = _read_bounded(path) if path.is_file() else None
                if current != before[path]:
                    raise RuntimeError(
                        f"Native Undo artifact changed during transition: {path.name}"
                    )
                if content is None:
                    if current is not None:
                        path.unlink()
                        applied[path] = None
                elif before[path] != content:
                    _write_atomic(path, content)
                    applied[path] = content
        except Exception:
            try:
                restore_before()
            except Exception as restore_error:
                raise RuntimeError(
                    "Native Undo artifact transaction and recovery both failed"
                ) from restore_error
            raise
        return restore_before

    def _set_error(self, error: Exception) -> None:
        self.cancel()
        self.error = f"Native Undo synchronization failed: {error}"
        print(f"OperatingLine {self.error}")

    def sync(self, direction: str) -> None:
        if not self._registered or self._handling or not self._checkpoints:
            return
        self._handling = True
        try:
            owner = self._owner_scene()
            if owner is None:
                raise RuntimeError("owner Scene is unavailable")
            target_id = self._marker(owner)
            marker_changed = target_id != self._current_id
            target = self._checkpoints.get(target_id)
            source = self._checkpoints.get(self._current_id)
            if target is None or source is None:
                raise RuntimeError("checkpoint marker is unknown")
            provider = self._session_provider
            if provider is None:
                raise RuntimeError("session provider is unavailable")
            session = provider()
            before_snapshot = session.snapshot_state()
            rebound_receipts = rebind_receipts_after_native_restore(
                dict(target.snapshot.receipts)
            )
            restore_artifacts = self._apply_artifact_transition(source, target)
            try:
                ensure_receipts_intact(rebound_receipts)
                session.restore_state(target.snapshot, receipts=rebound_receipts)
            except Exception:
                restore_artifacts()
                raise
            rebound_snapshot = session.snapshot_state()
            self._checkpoints[target_id] = replace(
                target,
                snapshot=rebound_snapshot,
            )
            self._current_id = target_id
            self.error = ""
            callback = self._restore_callback
            if callback is not None and marker_changed:
                try:
                    callback(
                        NativeHistoryRestore(
                            direction=direction,
                            source_operation=source.operation,
                            target_operation=target.operation,
                            before=before_snapshot,
                            after=rebound_snapshot,
                        )
                    )
                except Exception as callback_error:
                    print(
                        "OperatingLine native Undo reporting failed: "
                        f"{callback_error}"
                    )
        except Exception as error:
            self._set_error(error)
        finally:
            self._handling = False

    def loaded_file(self) -> None:
        if not self._registered:
            return
        provider = self._session_provider
        if provider is not None:
            provider().abandon_state()
        self._remove_markers()
        self._clear_journal()
        callback = self._reset_callback
        if callback is not None:
            try:
                callback()
            except Exception as error:
                print(f"OperatingLine file-load reset reporting failed: {error}")


_CONTROLLER = NativeHistoryController()


@persistent
def _undo_post(_unused: Any) -> None:
    _CONTROLLER.sync("undo")


@persistent
def _redo_post(_unused: Any) -> None:
    _CONTROLLER.sync("redo")


@persistent
def _load_post(_unused: Any) -> None:
    _CONTROLLER.loaded_file()


def register_native_history(
    session_provider: SessionProvider,
    restore_callback: RestoreCallback,
    reset_callback: ResetCallback,
) -> None:
    _CONTROLLER.register(session_provider, restore_callback, reset_callback)


def unregister_native_history() -> None:
    _CONTROLLER.unregister()


def discard_native_history() -> None:
    _CONTROLLER.discard()


def prepare_native_history(
    session: DemoSession,
    scene: bpy.types.Scene,
    operation: str,
) -> None:
    _CONTROLLER.prepare(session, scene, operation)


def cancel_native_history() -> None:
    _CONTROLLER.cancel()


def commit_native_history(session: DemoSession) -> str:
    return _CONTROLLER.commit(session)


def prepared_native_history_changed(session: DemoSession) -> bool:
    return _CONTROLLER.prepared_state_changed(session)


def native_history_error() -> str:
    return _CONTROLLER.error


def native_history_checkpoint_count() -> int:
    return _CONTROLLER.checkpoint_count


__all__ = (
    "NATIVE_HISTORY_MARKER_KEY",
    "NativeHistoryCheckpoint",
    "NativeHistoryController",
    "NativeHistoryRestore",
    "cancel_native_history",
    "commit_native_history",
    "discard_native_history",
    "native_history_checkpoint_count",
    "native_history_error",
    "prepare_native_history",
    "prepared_native_history_changed",
    "register_native_history",
    "unregister_native_history",
)
