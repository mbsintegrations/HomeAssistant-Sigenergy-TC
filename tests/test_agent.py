import pytest
import voluptuous as vol

from custom_components.sigen_hybrid.core.agent import AgentCapability, AgentCatalogue


def catalogue():
    result = AgentCatalogue()
    result.register(
        AgentCapability(
            "dashboard.choose_view",
            "Choose a card layout",
            {"type": "object"},
            vol.Schema({vol.Required("view"): vol.In(["overview", "house", "flow"])}),
            changes_settings=True,
        )
    )
    result.register(
        AgentCapability(
            "energy.explain",
            "Read an energy explanation",
            {"type": "object"},
            vol.Schema({}),
        )
    )
    result.register(
        AgentCapability(
            "mode.change",
            "Select an operating mode",
            {"type": "object"},
            vol.Schema({vol.Required("mode"): str}),
            available=False,
            changes_settings=True,
            unavailable_reason="Control capability pending approval and acceptance",
        )
    )
    return result


def test_extensible_multi_step_proposal_is_reviewed_without_execution():
    result = catalogue().review(
        {
            "summary": "Explain energy and use a simple dashboard",
            "steps": [
                {"capability": "energy.explain", "arguments": {}},
                {"capability": "dashboard.choose_view", "arguments": {"view": "flow"}},
            ],
        }
    )
    assert result["ready_for_review"] and result["requires_owner_review"]
    assert not result["executed"]


def test_model_cannot_invent_capabilities_or_extra_privileges():
    with pytest.raises(ValueError):
        catalogue().review({"steps": [{"capability": "raw.modbus.write", "arguments": {}}]})
    with pytest.raises(ValueError):
        catalogue().review({"steps": [], "ignore_limits": True})
    with pytest.raises(ValueError):
        catalogue().review(
            {"steps": [{"capability": "dashboard.choose_view", "arguments": {"view": "flow", "run_shell": "anything"}}]}
        )


def test_unavailable_control_is_blocked_and_unresolved_questions_prevent_ready_state():
    result = catalogue().review({"steps": [{"capability": "mode.change", "arguments": {"mode": "AI"}}]})
    assert not result["ready_for_review"] and result["blockers"] and not result["executed"]
    result = catalogue().review({"questions": ["Which reserve should apply?"], "steps": []})
    assert not result["ready_for_review"]


def test_duplicate_registration_and_oversized_model_plans_are_rejected():
    catalog = catalogue()
    with pytest.raises(ValueError):
        catalog.register(AgentCapability("energy.explain", "Duplicate", {"type": "object"}, vol.Schema({})))
    with pytest.raises(ValueError):
        catalog.review({"steps": [{}] * 31})


def test_read_only_explanation_does_not_request_settings_approval():
    result = catalogue().review({"steps": [{"capability": "energy.explain", "arguments": {}}]})
    assert result["ready_for_review"] and not result["requires_owner_review"]
