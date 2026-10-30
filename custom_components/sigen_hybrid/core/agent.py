"""Provider-neutral AI proposal contracts; no network, execution or credentials.

The application owns the capability catalogue. Model output is untrusted input.
Individual adapters must register validated schemas and real availability.
"""

from dataclasses import dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class AgentCapability:
    name: str
    description: str
    input_schema: dict
    validate_arguments: Callable[[dict], dict]
    available: bool = True
    changes_settings: bool = False
    unavailable_reason: str = ""


class AgentCatalogue:
    def __init__(self):
        self._capabilities: dict[str, AgentCapability] = {}

    def register(self, capability: AgentCapability):
        if capability.name in self._capabilities:
            raise ValueError("Capability already registered")
        if not capability.name or capability.input_schema.get("type") != "object":
            raise ValueError("Capabilities need an object argument schema")
        self._capabilities[capability.name] = capability

    def describe(self) -> list[dict]:
        return [
            {
                "name": c.name,
                "description": c.description,
                "input_schema": c.input_schema,
                "available": c.available,
                "changes_settings": c.changes_settings,
                "unavailable_reason": c.unavailable_reason,
            }
            for c in self._capabilities.values()
        ]

    def review(self, model_output: Any) -> dict:
        if not isinstance(model_output, dict) or set(model_output) - {"summary", "steps", "questions"}:
            raise ValueError("Expected a structured proposal without extra fields")
        summary = model_output.get("summary", "")
        steps = model_output.get("steps", [])
        questions = model_output.get("questions", [])
        if not isinstance(summary, str) or len(summary) > 4000:
            raise ValueError("Invalid proposal summary")
        if not isinstance(steps, list) or len(steps) > 30:
            raise ValueError("A proposal may contain at most thirty steps")
        if not isinstance(questions, list) or len(questions) > 10:
            raise ValueError("Invalid clarification questions")
        if any(not isinstance(q, str) or len(q) > 1000 for q in questions):
            raise ValueError("Invalid clarification question")
        validated, blockers, changes = [], [], False
        for step in steps:
            if not isinstance(step, dict) or set(step) != {"capability", "arguments"}:
                raise ValueError("Every step needs only a capability name and arguments")
            name, arguments = step["capability"], step["arguments"]
            if not isinstance(name, str) or name not in self._capabilities:
                raise ValueError("Model requested an unknown capability")
            if not isinstance(arguments, dict):
                raise ValueError("Capability arguments must be an object")
            capability = self._capabilities[name]
            try:
                normalized = capability.validate_arguments(arguments)
            except Exception:
                raise ValueError("Capability arguments failed validation") from None
            if not capability.available:
                blockers.append({"capability": name, "reason": capability.unavailable_reason or "Unavailable"})
            changes |= capability.changes_settings
            validated.append({"capability": name, "arguments": normalized})
        return {
            "summary": summary,
            "steps": validated,
            "questions": questions,
            "blockers": blockers,
            "requires_owner_review": changes,
            "ready_for_review": not blockers and not questions,
            "executed": False,
        }
