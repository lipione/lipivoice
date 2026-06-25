from __future__ import annotations

import datetime as dt
import json
from typing import Any

import aiohttp

VALID_TYPES = {"status", "transcript", "tool_call", "audio", "runtime", "error"}
VALID_ACTORS = {"system", "user", "assistant", "tool"}
VALID_SEVERITIES = {"info", "warning", "error"}


def iso_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def normalize_event(raw: dict[str, Any], *, timestamp: str | None = None) -> dict[str, Any]:
    event_type = raw.get("type")
    actor = raw.get("actor")
    severity = raw.get("severity")
    payload = raw.get("payload")

    return {
        "timestamp": timestamp or iso_now(),
        "type": event_type if event_type in VALID_TYPES else "runtime",
        "actor": actor if actor in VALID_ACTORS else "system",
        "payload": payload if isinstance(payload, dict) else {},
        "severity": severity if severity in VALID_SEVERITIES else "info",
    }


def parse_dispatch_metadata(metadata: str) -> dict[str, str]:
    try:
        parsed = json.loads(metadata or "{}")
    except json.JSONDecodeError as error:
        raise ValueError("invalid_dispatch_metadata") from error

    call_id = parsed.get("callId")
    agent_id = parsed.get("agentId")

    if not isinstance(call_id, str) or not call_id:
        raise ValueError("invalid_dispatch_metadata")
    if not isinstance(agent_id, str) or not agent_id:
        raise ValueError("invalid_dispatch_metadata")

    return {"call_id": call_id, "agent_id": agent_id}


class LipiVoiceClient:
    def __init__(self, *, base_url: str, worker_api_key: str = "") -> None:
        self.base_url = base_url.rstrip("/")
        self.worker_api_key = worker_api_key

    def headers(self) -> dict[str, str]:
        if not self.worker_api_key:
            return {}
        return {"x-lipivoice-worker-key": self.worker_api_key}

    async def get_session_config(self, call_id: str) -> dict[str, Any]:
        async with aiohttp.ClientSession(headers=self.headers()) as session:
            async with session.get(f"{self.base_url}/api/worker/session-config", params={"callId": call_id}) as response:
                response.raise_for_status()
                return await response.json()

    async def post_events(self, call_id: str, events: list[dict[str, Any]]) -> None:
        normalized = [normalize_event(event) for event in events]
        async with aiohttp.ClientSession(headers=self.headers()) as session:
            async with session.post(
                f"{self.base_url}/api/worker/calls/{call_id}/events",
                json={"events": normalized},
            ) as response:
                response.raise_for_status()

    async def call_business_tool(self, call_id: str, tool_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        async with aiohttp.ClientSession(headers=self.headers()) as session:
            async with session.post(
                f"{self.base_url}/api/worker/calls/{call_id}/tools/{tool_name}",
                json=payload,
            ) as response:
                response.raise_for_status()
                return await response.json()
