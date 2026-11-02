"""Owner-confirmed native strategies, using the configured mySigen session.

Rename/delete are direct native operations. Rule creation and modification use
the native personalization conversation and its returned proposal buttons. No
endpoints, plant IDs, session IDs or action payloads are accepted from the UI.
"""

import json
import time
from copy import deepcopy
from hashlib import sha256
from uuid import uuid4

from .errors import SafetyError
from .plant_configuration import safe_document

PERSONAL = "aipv-biz/api/v1/sigenai/personalization/"
CHAT = "assistant-facade/qrqm/"
BUTTON_ACTIONS = {"btn_confirm_apply": "CONFIRM_APPLY_PROPOSAL", "btn_cancel": "CANCEL"}


def revision(value):
    return sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def text(value, limit):
    if not isinstance(value, str) or not 1 <= len(value.strip()) <= limit or any(ord(c) < 32 and c not in "\n\t" for c in value):
        raise SafetyError("Check the strategy text")
    return value.strip()


def validate_scope(value, station_id):
    """Reject an incorrectly scoped vendor proposal, including nested actions."""
    if isinstance(value, dict):
        for key, item in value.items():
            if key == "stationId" and str(item) != station_id:
                raise SafetyError("The strategy response belongs to a different plant")
            validate_scope(item, station_id)
    elif isinstance(value, list):
        for item in value:
            validate_scope(item, station_id)


def decode_answer(value, depth=0):
    """Decode the native history answer, never executable HTML or instructions."""
    if depth > 4:
        raise SafetyError("The strategy response format is unsupported")
    if isinstance(value, str):
        if len(value) > 64000:
            raise SafetyError("The strategy response exceeds the supported size")
        stripped = value.strip()
        if stripped.startswith(("{", "[", '"')):
            try:
                return decode_answer(json.loads(stripped), depth+1)
            except ValueError:
                pass
        return [{"type": "content", "message": value}]
    if isinstance(value, dict):
        if value.get("type") == "final_result" and "content" in value:
            return decode_answer(value["content"], depth+1)
        if isinstance(value.get("content"), dict):
            return decode_answer(value["content"], depth+1)
        if isinstance(value.get("content"), str) and value["content"].strip().startswith(("{", "[")):
            return decode_answer(value["content"], depth+1)
        return [value]
    if isinstance(value, list) and len(value) <= 100:
        return [item for part in value for item in decode_answer(part, depth+1)]
    raise SafetyError("The strategy response format is unsupported")


class PlantStrategies:
    """Short-lived previews and owner-scoped conversations; no automatic replay."""

    def __init__(self, reader, save, *, clock=time.monotonic):
        self.reader, self.save, self.clock = reader, save, clock
        self.previews, self.conversations = {}, {}

    async def rules(self):
        self.reader.cache.pop(("strategies", None, None, 1), None)
        result = await self.reader.read("strategies")
        return result["value"]

    async def request(self, method, path, **kwargs):
        self.reader.identity()
        result = await self.reader.client._data(method, path, **kwargs)
        self.reader.identity()
        return result

    def prune(self):
        now = self.clock()
        self.previews = {key: value for key, value in self.previews.items() if now-value["created"] < 600}
        self.conversations = {key: value for key, value in self.conversations.items() if now-value["created"] < 1200}

    async def preview(self, owner, action, *, rule_id=None, name=None, instruction=None):
        if action not in ("rename", "delete", "create", "edit"):
            raise SafetyError("Choose a supported strategy action")
        self.prune()
        if len(self.previews) >= 32 or action in ("create", "edit") and len(self.conversations) >= 8:
            raise SafetyError("Close older strategy requests before starting another")
        document = await self.rules()
        rules = document["rules"]
        existing = [row for row in rules if type(rule_id) is int and row.get("personalizationRuleId") == rule_id]
        if action != "create" and len(existing) != 1 or action == "create" and rule_id is not None:
            raise SafetyError("This strategy is no longer in the selected plant")
        if action == "rename":
            name = text(name, 60)
        if action in ("create", "edit"):
            instruction = text(instruction, 2000)
        token = str(uuid4())
        record = {"owner": owner, "action": action, "rule_id": rule_id, "name": name,
                  "instruction": instruction, "before": document, "revision": revision(document), "created": self.clock()}
        self.previews[token] = record
        return {"preview": token, "action": action, "rule": deepcopy(existing[0]) if existing else None,
                "name": name, "instruction": instruction, "expires_in": 600}

    async def apply(self, owner, token):
        self.prune()
        pending = self.previews.get(token)
        if pending is None or pending["owner"] != owner:
            raise SafetyError("Reopen the strategy action and review it again")
        # Consume before any I/O. An uncertain POST must never be repeated by
        # clicking Apply again, reconnecting, or restarting Home Assistant.
        del self.previews[token]
        current = await self.rules()
        if revision(current) != pending["revision"]:
            raise SafetyError("The plant strategies changed; reopen and review them")
        action, rule_id = pending["action"], pending["rule_id"]
        if action in ("create", "edit") and len(self.conversations) >= 8:
            raise SafetyError("Close older strategy requests before starting another")
        record = {"request_id": token, "action": action, "rule_id": rule_id,
                  "phase": "sending", "before": current}
        await self.save(record)  # Durable snapshot before every mutation.
        try:
            if action in ("create", "edit"):
                payload = {"question": pending["instruction"], "stationId": self.reader.station_id, "newSession": True}
                if action == "edit":
                    payload["optionalContext"] = {"selectedStrategyId": rule_id}
                response = await self.request("POST", CHAT+"message/send", json=payload)
                return await self._start_conversation(owner, record, response, rule_id)
            payload = {"stationId": int(self.reader.station_id), "personalizationRuleId": rule_id}
            if action == "rename":
                payload["customDisplayName"] = pending["name"]
            response = await self.request("POST", PERSONAL+"rule/"+("delete" if action == "delete" else "custom-display-name"), json=payload)
            if not isinstance(response, dict) or response.get("success") is not True:
                raise SafetyError("Sigenergy did not accept the strategy action")
            after = await self.rules()
            rows = [row for row in after["rules"] if row.get("personalizationRuleId") == rule_id]
            matched = not rows if action == "delete" else len(rows) == 1 and rows[0].get("customDisplayName") == pending["name"]
            confirmed = matched and after["current"] == current["current"]
            phase = "confirmed" if confirmed else "unconfirmed"
            await self.save({**record, "phase": phase, "after": after})
            return {"phase": phase, "action": action, "rules": after,
                    "message": ("Strategy deleted" if action == "delete" else "Strategy renamed") if confirmed else "The plant has not confirmed the change. Refresh before trying again."}
        except BaseException:
            # The snapshot remains available after a timeout/cancellation. No
            # retry, rollback guess, or replacement HA automation is dispatched.
            self.reader.cache.pop(("strategies", None, None, 1), None)
            raise

    async def _start_conversation(self, owner, record, response, rule_id):
        if not isinstance(response, dict):
            raise SafetyError("Sigenergy did not return a strategy conversation")
        session, conversation = response.get("sessionId"), response.get("conversationId")
        if any(not isinstance(value, str) or not value or len(value) > 160 for value in (session, conversation)):
            raise SafetyError("Sigenergy did not return a strategy conversation")
        handle = str(uuid4())
        self.conversations[handle] = {"owner": owner, "created": self.clock(), "session": session,
            "conversation": conversation, "rule_id": rule_id, "before": record["before"],
            "record": record, "buttons": [], "turn": 0, "last_read": float("-inf"), "view": None}
        await self.save({**record, "phase": "awaiting_response", "session_id": session, "conversation_id": conversation})
        return {"phase": "awaiting_response", "conversation": handle, "message": "Waiting for Sigenergy’s strategy response"}

    def conversation(self, owner, handle):
        self.prune()
        state = self.conversations.get(handle)
        if state is None or state["owner"] != owner:
            raise SafetyError("This strategy conversation has expired; refresh the plant strategies")
        self.reader.identity()
        return state

    async def read_conversation(self, owner, handle):
        state = self.conversation(owner, handle)
        if state.get("uncertain"):
            return {"phase": "unconfirmed", "conversation": handle, "blocks": [], "buttons": [],
                    "rules": await self.rules(), "message": "The response was not confirmed. Refresh the plant strategies before starting another request."}
        # History polling avoids another SSE transport/session and shares the
        # established account gate. At most one request per ten seconds, only
        # while the owner has this conversation open; no idle polling.
        if self.clock()-state["last_read"] < 10 and state["view"] is not None:
            return deepcopy(state["view"])
        state["last_read"] = self.clock()
        response = await self.request("GET", CHAT+"thread/detail", params={"stationId": int(self.reader.station_id), "pageNum": 1, "pageSize": 5, "sessionId": state["session"]})
        rows = response.get("records") if isinstance(response, dict) else None
        if not isinstance(rows, list):
            raise SafetyError("Sigenergy did not return the strategy response")
        selected = [row for row in rows if isinstance(row, dict) and row.get("sessionId") == state["session"] and row.get("conversationId") == state["conversation"]]
        if len(selected) != 1:
            state["view"] = {"phase": "awaiting_response", "conversation": handle, "blocks": []}
            return deepcopy(state["view"])
        row = selected[0]
        finished = row.get("streaming") is False and row.get("interrupted") is not True
        blocks = decode_answer(row.get("answer") or "")
        blocks = safe_document(blocks)
        validate_scope(blocks, self.reader.station_id)
        state["buttons"] = []
        if finished:
            for block in blocks:
                candidates = block.get("buttons", []) if isinstance(block, dict) else []
                for button in candidates:
                    if not isinstance(button, dict) or BUTTON_ACTIONS.get(button.get("id")) != button.get("action") or button.get("type") != "button":
                        continue
                    if not all(isinstance(button.get(key), str) and button[key] for key in ("type", "action", "text")) or not isinstance(button.get("payload"), dict):
                        continue
                    # Bind the exact native button, without exposing an API
                    # escape hatch or trusting a caller-supplied action body.
                    state["buttons"].append(deepcopy(button))
        view = {"phase": "response" if finished else "awaiting_response", "conversation": handle,
                "blocks": blocks, "buttons": [{"index": index, "text": button["text"]} for index, button in enumerate(state["buttons"])]}
        if finished:
            after = await self.rules()
            view["rules"] = after
            view["plant_changed"] = revision(after) != revision(state["before"])
            # AI text or a success toast is never proof that a rule was saved.
            await self.save({**state["record"], "phase": "response", "after": after,
                             "session_id": state["session"], "conversation_id": state["conversation"]})
        state["view"] = deepcopy(view)
        return view

    async def answer(self, owner, handle, *, instruction=None, button=None):
        state = self.conversation(owner, handle)
        if state["view"] is None or state["view"]["phase"] != "response":
            raise SafetyError("Wait for the current strategy response")
        if (instruction is None) == (button is None):
            raise SafetyError("Choose one strategy response")
        payload = {"stationId": self.reader.station_id, "sessionId": state["session"]}
        if button is not None:
            if type(button) is not int or not 0 <= button < len(state["buttons"]):
                raise SafetyError("Reopen the current strategy proposal")
            selected = state["buttons"][button]
            payload["question"] = selected["text"]
            payload["uiEvent"] = {key: deepcopy(selected[key]) for key in ("type", "action", "payload")}
        else:
            payload["question"] = text(instruction, 2000)
        if state["rule_id"] is not None:
            payload["optionalContext"] = {"selectedStrategyId": state["rule_id"]}
        before = await self.rules()
        if state["view"].get("rules") is None or revision(before) != revision(state["view"]["rules"]):
            raise SafetyError("The plant strategies changed; reopen them before applying this proposal")
        state["buttons"] = []
        state["view"] = None  # Consume before dispatch; never repeat a confirmation.
        await self.save({**state["record"], "phase": "sending_response", "before": before})
        state["uncertain"] = True
        response = await self.request("POST", CHAT+"message/send", json=payload)
        if not isinstance(response, dict) or response.get("sessionId") != state["session"] or not isinstance(response.get("conversationId"), str) or not response["conversationId"]:
            raise SafetyError("Sigenergy has not confirmed this strategy response; refresh the plant")
        state["conversation"] = response["conversationId"]
        state["uncertain"] = False
        state["last_read"] = float("-inf")
        state["before"] = before
        return {"phase": "awaiting_response", "conversation": handle, "message": "Waiting for Sigenergy’s strategy response"}
