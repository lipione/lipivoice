import pytest

from lipivoice_client import normalize_event, parse_dispatch_metadata


def test_normalize_event_defaults_timestamp_and_severity():
    event = normalize_event(
        {
            "type": "transcript",
            "actor": "assistant",
            "payload": {"text": "नमस्ते"},
        },
        timestamp="2026-06-02T00:00:00.000Z",
    )

    assert event == {
        "timestamp": "2026-06-02T00:00:00.000Z",
        "type": "transcript",
        "actor": "assistant",
        "payload": {"text": "नमस्ते"},
        "severity": "info",
    }


def test_normalize_event_falls_back_to_runtime_event_for_unknown_type():
    event = normalize_event(
        {
            "type": "unknown",
            "actor": "agent",
            "payload": {"stage": "llm"},
            "severity": "bad",
        },
        timestamp="2026-06-02T00:00:00.000Z",
    )

    assert event == {
        "timestamp": "2026-06-02T00:00:00.000Z",
        "type": "runtime",
        "actor": "system",
        "payload": {"stage": "llm"},
        "severity": "info",
    }


def test_parse_dispatch_metadata_requires_call_id_and_agent_id():
    assert parse_dispatch_metadata('{"callId":"call_1","agentId":"agent_reception"}') == {
        "call_id": "call_1",
        "agent_id": "agent_reception",
    }


def test_parse_dispatch_metadata_rejects_bad_json():
    with pytest.raises(ValueError, match="invalid_dispatch_metadata"):
        parse_dispatch_metadata("not-json")
