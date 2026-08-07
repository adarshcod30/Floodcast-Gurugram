"""AWS Bedrock client — cost-tiered Claude access.

Uses the Anthropic SDK's Bedrock Mantle client (the Messages-API Bedrock
endpoint) rather than raw `bedrock-runtime` InvokeModel. That choice buys
three things: current model IDs instead of legacy ARN-versioned strings,
the same request shape as the first-party API, and no hand-rolled JSON
envelope to keep in sync.

Cost tiering, per the project brief: Haiku for routing, parsing and
place-name resolution; Sonnet only for the final verdict synthesis, where
reasoning quality actually changes the answer.

NO SAMPLING PARAMETERS
----------------------
Claude Sonnet 5 rejects `temperature`, `top_p` and `top_k` with a 400.
The previous implementation sent `temperature=0.3` on every call, which
would have failed every request against a current model — and because the
agent layer catches exceptions and falls through to its template path,
that failure would have been invisible: the app would appear to work
while silently never reaching the LLM. Steer behaviour through the system
prompt instead.

EVERY FAILURE IS A None
-----------------------
No exception escapes this module. Callers treat `None` as "LLM
unavailable" and run the deterministic rule-based path. A flood tool has
to keep answering when its dependencies are under strain, because that is
exactly when people need it.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from app.config import settings

logger = logging.getLogger("floodcast.bedrock")

_client = None
_client_attempted = False
_healthy: bool = False
_last_error: Optional[str] = None

#: Bedrock has no Task Budgets support, so cost is bounded by max_tokens.
_MAX_TOKENS = {"haiku": 1024, "sonnet": 1536}


def _credentials_present() -> bool:
    """Whether AWS credentials are configured at all."""
    return bool(settings.aws_access_key_id and settings.aws_secret_access_key)


def _get_client():
    """Lazily construct the Bedrock client. Returns None if unavailable.

    Construction is attempted once; a failure is remembered so a missing
    dependency or bad credentials don't cost a retry on every request.
    """
    global _client, _client_attempted, _healthy, _last_error

    if _client is not None or _client_attempted:
        return _client

    _client_attempted = True

    if not _credentials_present():
        _last_error = "AWS credentials not configured"
        logger.info("Bedrock disabled: no AWS credentials. Using rule-based pipeline.")
        return None

    try:
        # Imported lazily so the app starts without the optional extra.
        # The *async* client matters: FastAPI serves on one event loop, so
        # a synchronous SDK call would block every other in-flight request
        # for the duration of a model round-trip.
        from anthropic import AsyncAnthropicBedrockMantle

        kwargs: Dict[str, Any] = {
            "aws_region": settings.aws_region,
            "aws_access_key": settings.aws_access_key_id,
            "aws_secret_key": settings.aws_secret_access_key,
        }
        if settings.aws_session_token:
            kwargs["aws_session_token"] = settings.aws_session_token

        _client = AsyncAnthropicBedrockMantle(**kwargs)
        _healthy = True
        _last_error = None
        logger.info("Bedrock client ready (region=%s)", settings.aws_region)
        return _client

    except Exception as exc:  # noqa: BLE001 — never let this break startup
        _healthy = False
        _last_error = f"Bedrock client init failed: {exc}"
        logger.warning(_last_error)
        return None


def _model_id(tier: str) -> str:
    return (
        settings.bedrock_haiku_model_id
        if tier == "haiku"
        else settings.bedrock_sonnet_model_id
    )


async def invoke_model(
    prompt: str,
    model_tier: str = "haiku",
    max_tokens: Optional[int] = None,
    system_prompt: Optional[str] = None,
) -> Optional[str]:
    """Send one message to Claude on Bedrock and return the text.

    Args:
        prompt: The user message.
        model_tier: "haiku" for routing/parsing, "sonnet" for synthesis.
        max_tokens: Response cap. Defaults per tier.
        system_prompt: Optional system message.

    Returns:
        The response text, or None if the LLM is unavailable for any
        reason. Never raises.
    """
    global _healthy, _last_error

    client = _get_client()
    if client is None:
        return None

    model = _model_id(model_tier)
    request: Dict[str, Any] = {
        "model": model,
        "max_tokens": max_tokens or _MAX_TOKENS.get(model_tier, 1024),
        "messages": [{"role": "user", "content": prompt}],
        # Deliberately no temperature / top_p / top_k — rejected by
        # current models. Behaviour is steered by the system prompt.
    }
    if system_prompt:
        request["system"] = system_prompt

    try:
        response = await client.messages.create(**request)
    except Exception as exc:  # noqa: BLE001 — degrade, never propagate
        _healthy = False
        _last_error = f"{type(exc).__name__}: {exc}"
        logger.warning("Bedrock call failed (%s / %s): %s", model_tier, model, exc)
        return None

    # A safety classifier can decline with HTTP 200 and stop_reason
    # "refusal" — an empty content list, not an exception. Check before
    # indexing, or this raises IndexError on a successful response.
    if getattr(response, "stop_reason", None) == "refusal":
        _healthy = True
        logger.info("Bedrock declined the request (stop_reason=refusal)")
        return None

    text = "".join(
        block.text for block in response.content if getattr(block, "type", "") == "text"
    ).strip()

    _healthy = True
    _last_error = None
    return text or None


# ---------------------------------------------------------------------------
# Health introspection — cheap, never makes a model call
# ---------------------------------------------------------------------------

def is_bedrock_healthy() -> bool:
    """Whether the last Bedrock interaction succeeded."""
    return _healthy


def get_last_error() -> Optional[str]:
    """Most recent Bedrock error, if any."""
    return _last_error


def check_bedrock_connection() -> Dict[str, Any]:
    """Report Bedrock configuration state for /health.

    Deliberately does NOT invoke a model: /health is polled by an uptime
    monitor, and billing the LLM on every poll would make the check more
    expensive than the service. "Not configured" is reported as a healthy
    degraded mode, not an outage — the app is designed to run without it.
    """
    if not _credentials_present():
        return {
            "healthy": True,
            "configured": False,
            "mode": "rule_based",
            "detail": "No AWS credentials — chat runs the deterministic pipeline.",
        }

    client = _get_client()
    return {
        "healthy": _healthy and client is not None,
        "configured": True,
        "mode": "llm",
        "error": _last_error,
        "haiku_model": settings.bedrock_haiku_model_id,
        "sonnet_model": settings.bedrock_sonnet_model_id,
        "region": settings.aws_region,
    }
