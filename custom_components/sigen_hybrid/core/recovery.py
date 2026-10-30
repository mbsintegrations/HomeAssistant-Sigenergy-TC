"""Write-ahead plant changes and compare-before-restore recovery.

Providers supply a closed setting allowlist, fresh reads and single-attempt writes.
The journal contains settings, never provider credentials. A transport failure is
an uncertain outcome, not permission to resend a command.
"""

from __future__ import annotations

import asyncio
import copy
import hashlib
import json
from datetime import datetime

from .errors import ConfirmationError, SafetyError


def canonical(value):
    """Compare JSON types exactly; reject NaN, arbitrary objects and coercions."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


class RecoveryJournal:
    """One pending transaction per bound plant, persisted before every write.

    store: async_load()/async_save(document).
    provider: identity(), read(keys), write(key, value), validate(key, value),
    matches(key, requested, observed). identity/read/write are async.
    """

    def __init__(self, store, provider, *, plant_identity: str, clock):
        if not isinstance(plant_identity, str) or not plant_identity:
            raise ValueError("A bound plant identity is required")
        self.store, self.provider, self.plant_identity, self.clock = store, provider, plant_identity, clock
        self._lock = asyncio.Lock()
        self._document = None

    async def _load(self):
        if self._document is None:
            saved = await self.store.async_load()
            if saved is None:
                saved = {"version": 1, "plant_identity": self.plant_identity, "active": None, "history": []}
            if saved.get("version") != 1 or saved.get("plant_identity") != self.plant_identity:
                raise SafetyError("Recovery data belongs to another plant or an unsupported version")
            self._document = copy.deepcopy(saved)
        return self._document

    async def _save(self):
        # HA Store performs atomic replacement. Do not use a delayed save for this.
        await self.store.async_save(copy.deepcopy(self._document))

    async def _identity(self):
        if await self.provider.identity() != self.plant_identity:
            raise SafetyError("Plant identity changed; no command was sent")

    async def _read(self, keys):
        await self._identity()
        result = await self.provider.read(tuple(keys))
        if not isinstance(result, dict) or any(key not in result for key in keys):
            raise SafetyError("Fresh recovery settings are incomplete")
        canonical(result)
        return result

    def _matches(self, step, actual):
        matcher = getattr(self.provider, "matches_attempt", None)
        if matcher is not None:
            return matcher(step["key"], step["requested"], actual, step.get("attempted_at"))
        return self.provider.matches(step["key"], step["requested"], actual)

    async def _uncertain(self, record):
        if self._document["active"] is None:
            self._document["active"] = record
        self._document["active"]["phase"] = "uncertain"
        # Preserve write-ahead evidence even when the caller is being cancelled.
        await asyncio.shield(self._save())

    def _finish(self, record, status):
        record["phase"] = status
        record["completed_at"] = self.clock().isoformat()
        self._document["history"].append(copy.deepcopy(record))
        self._document["history"] = self._document["history"][-25:]
        self._document["active"] = None
        if status == "superseded" or status == "committed" and record.get("context", {}).get("pause_automation") is True:
            self._document["automation_pause"] = {"paused": True, "reason": "Owner changed plant settings",
                                                   "at": self.clock().isoformat()}

    def _restored(self, key, original, observed):
        matcher = getattr(self.provider, "matches_restored", None)
        return matcher(key, original, observed) if matcher else canonical(original) == canonical(observed)

    async def _preserve_foreign(self, record):
        """Release a still-owned manual command without undoing owner changes."""
        release_keys = getattr(self.provider, "release_on_conflict", ())
        try:
            for step in record["steps"]:
                key = step["key"]
                if key not in release_keys:
                    continue
                actual = (await self._read([key]))[key]
                if self._restored(key, step["before"], actual):
                    continue
                ours = (
                    canonical(actual) == canonical(step["after"])
                    if "after" in step
                    else step["attempted"] and self._matches(step, actual)
                )
                if not ours:
                    continue  # An unrelated native override belongs to its owner.
                record["phase"], step["restore_attempted"] = "restoring", True
                await self._save()
                await self._identity()
                checked = getattr(self.provider, "restore_checked", None)
                if checked is not None:
                    await checked(key, copy.deepcopy(step["before"]), copy.deepcopy(actual))
                else:
                    await self.provider.restore(key, copy.deepcopy(step["before"]))
                observed = (await self._read([key]))[key]
                if not self._restored(key, step["before"], observed):
                    raise ConfirmationError("Owned manual control release is not confirmed")
                record.setdefault("released_on_conflict", []).append(key)
                await self._save()
            self._finish(record, "superseded")
            await self._save()
            return copy.deepcopy(self._document["history"][-1])
        except BaseException:
            await self._uncertain(record)
            raise

    async def apply(self, request_id, changes, *, expires_at: datetime | None = None, context=None):
        """Apply ordered settings once; journal original and observed values."""
        if not isinstance(request_id, str) or not 1 <= len(request_id) <= 128:
            raise SafetyError("A valid command request ID is required")
        if not changes or len({key for key, _ in changes}) != len(changes):
            raise SafetyError("A command needs distinct allowlisted settings")
        for key, value in changes:
            self.provider.validate(key, value)
            canonical(value)
        now = self.clock()
        if now.tzinfo is None:
            raise SafetyError("Recovery clock must be timezone-aware")
        fingerprint = hashlib.sha256(
            canonical([changes, expires_at.isoformat() if expires_at else None]).encode()
        ).hexdigest()
        async with self._lock:
            document = await self._load()
            previous = next(
                (
                    r
                    for r in [document["active"], *reversed(document["history"])]
                    if r is not None and r["request_id"] == request_id
                ),
                None,
            )
            if previous is not None:
                if previous["fingerprint"] != fingerprint:
                    raise SafetyError("Request ID was reused with different parameters")
                if previous["phase"] not in ("confirmed", "committed", "restored", "superseded"):
                    raise ConfirmationError("Command outcome is uncertain; reconcile before another command")
                return copy.deepcopy(previous)
            if document["active"] is not None:
                raise SafetyError("Another plant command owns control; cancel or recover it first")
            if expires_at is not None:
                if expires_at.tzinfo is None or not 0 < (expires_at - now).total_seconds() <= 86400:
                    raise SafetyError("Command expiry must be within the next 24 hours")
            baseline = await self._read([key for key, _ in changes])
            restore_validator = getattr(self.provider, "validate_restore", self.provider.validate)
            for key, _ in changes:
                restore_validator(key, baseline[key])
            preflight = getattr(self.provider, "preflight", None)
            if preflight is not None:
                preflight(changes, baseline)
            record = {
                "request_id": request_id,
                "fingerprint": fingerprint,
                "phase": "prepared",
                "created_at": now.isoformat(),
                "expires_at": expires_at.isoformat() if expires_at else None,
                "steps": [
                    {
                        "key": key,
                        "before": copy.deepcopy(baseline[key]),
                        "requested": copy.deepcopy(value),
                        "attempted": False,
                    }
                    for key, value in changes
                ],
            }
            if context is not None:
                canonical(context)
                record["context"] = copy.deepcopy(context)
            metadata = getattr(self.provider, "recovery_metadata", None)
            if metadata is not None:
                record["provider_metadata"] = copy.deepcopy(metadata())
                canonical(record["provider_metadata"])
            document["active"] = record
            await self._save()  # If persistence fails, no plant mutation is allowed.
            try:
                for step in record["steps"]:
                    key, value = step["key"], step["requested"]
                    actual = (await self._read([key]))[key]
                    if canonical(actual) != canonical(step["before"]):
                        raise SafetyError("Plant setting changed after the recovery snapshot")
                    if canonical(actual) == canonical(value):
                        step["after"] = copy.deepcopy(actual)
                        continue
                    record["phase"], step["attempted"] = "sending", True
                    step["attempted_at"] = self.clock().isoformat()
                    await self._save()
                    await self._identity()
                    checked_write = getattr(self.provider, "write_checked", None)
                    if checked_write is None:
                        await self.provider.write(key, copy.deepcopy(value))
                    else:
                        import inspect

                        async def before_send(effective):
                            step["requested"] = copy.deepcopy(effective)
                            step["attempted_at"] = self.clock().isoformat()
                            await self._save()

                        arguments = {"context": record.get("context")}
                        if "before_send" in inspect.signature(checked_write).parameters:
                            arguments["before_send"] = before_send
                        await checked_write(key, copy.deepcopy(value), copy.deepcopy(actual), **arguments)
                    observed = (await self._read([key]))[key]
                    if not self._matches(step, observed):
                        raise ConfirmationError("Command was sent but fresh setting readback did not match")
                    step["after"] = copy.deepcopy(observed)
                    await self._save()
                record["phase"] = "confirmed"
                expiry = getattr(self.provider, "command_expiry", None)
                if expires_at is not None and expiry is not None:
                    actual_expiry = expiry(record)
                    if actual_expiry is not None:
                        if (
                            actual_expiry.tzinfo is None
                            or not 0 < (actual_expiry - self.clock()).total_seconds() <= 86490
                        ):
                            raise ConfirmationError("Provider returned an invalid command expiry")
                        record["expires_at"] = actual_expiry.isoformat()
                result = copy.deepcopy(record)
                if expires_at is None:
                    self._finish(record, "committed")
                    result = copy.deepcopy(document["history"][-1])
                await self._save()
                return result
            except BaseException:
                await self._uncertain(record)
                raise

    async def restore(self, request_id=None):
        """Restore in reverse order, preserving settings changed by the owner.

        A persistent setting can be rolled back by its request ID. Unknown write
        outcomes are read first; a matching value is never blindly resent.
        """
        async with self._lock:
            document = await self._load()
            record = document["active"]
            from_history = False
            if record is None and request_id is not None:
                record = next((r for r in reversed(document["history"]) if r["request_id"] == request_id), None)
                from_history = record is not None
            if record is None:
                return {"phase": "idle"}
            if request_id is not None and record["request_id"] != request_id:
                raise SafetyError("Another command owns the recovery journal")
            if from_history:
                if record["phase"] in ("restored", "superseded"):
                    return copy.deepcopy(record)
                record = copy.deepcopy(record)
                document["active"] = record
            prepare = getattr(self.provider, "prepare_recovery", None)
            if prepare is not None:
                await self._identity()
                await prepare(copy.deepcopy(record))
            current = await self._read([step["key"] for step in record["steps"]])
            for step in record["steps"]:
                value = current[step["key"]]
                if self._restored(step["key"], step["before"], value):
                    continue
                expected = step.get("after")
                ours = (
                    canonical(value) == canonical(expected)
                    if "after" in step
                    else (step["attempted"] and self._matches(step, value))
                )
                if not ours:
                    return await self._preserve_foreign(record)
            record["phase"] = "restoring"
            await self._save()
            try:
                for step in reversed(record["steps"]):
                    key = step["key"]
                    actual = (await self._read([key]))[key]
                    if self._restored(key, step["before"], actual):
                        continue
                    expected = step.get("after")
                    ours = (
                        canonical(actual) == canonical(expected)
                        if "after" in step
                        else (step["attempted"] and self._matches(step, actual))
                    )
                    if not ours:
                        return await self._preserve_foreign(record)
                    step["restore_attempted"] = True
                    await self._save()
                    await self._identity()
                    checked_restore = getattr(self.provider, "restore_checked", None)
                    if checked_restore is None:
                        restore_write = getattr(self.provider, "restore", self.provider.write)
                        await restore_write(key, copy.deepcopy(step["before"]))
                    else:
                        await checked_restore(key, copy.deepcopy(step["before"]), copy.deepcopy(actual))
                    observed = (await self._read([key]))[key]
                    if not self._restored(key, step["before"], observed):
                        raise ConfirmationError("Recovery write was sent but readback did not match")
                    await self._save()
                self._finish(record, "restored")
                await self._save()
                return copy.deepcopy(document["history"][-1])
            except BaseException:
                await self._uncertain(record)
                raise

    async def pending(self):
        async with self._lock:
            document = await self._load()
            return copy.deepcopy(document["active"])

    async def automation_pause(self, *, clear=False, if_not_after=None):
        async with self._lock:
            document = await self._load()
            previous = document.get("automation_pause", {})
            if clear and if_not_after is not None and previous.get("paused") is True and datetime.fromisoformat(previous["at"]) > if_not_after:
                return copy.deepcopy(previous)
            if clear:
                document["automation_pause"] = {"paused": False, "at": self.clock().isoformat()}
                await self._save()
            return copy.deepcopy(document.get("automation_pause", {}))

    async def receipt(self, request_id):
        async with self._lock:
            document = await self._load()
            return copy.deepcopy(
                next(
                    (
                        r
                        for r in [document["active"], *reversed(document["history"])]
                        if r is not None and r["request_id"] == request_id
                    ),
                    None,
                )
            )

    async def export(self):
        async with self._lock:
            return copy.deepcopy(await self._load())

    async def recover_expired(self):
        """Reconcile interrupted work; never replay the original command."""
        record = await self.pending()
        if record is None:
            return {"phase": "idle"}
        if record["phase"] != "confirmed" or (
            record["expires_at"] is not None and datetime.fromisoformat(record["expires_at"]) <= self.clock()
        ):
            return await self.restore(record["request_id"])
        return record
