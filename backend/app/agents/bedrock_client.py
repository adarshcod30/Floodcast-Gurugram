"""
FloodCast Gurugram — AWS Bedrock Client
=========================================
Wrapper around boto3 Bedrock runtime for Claude model calls.
Cost-tiered: Haiku for fast/cheap tasks, Sonnet for quality synthesis.

Model IDs are configurable via environment variables so they can be
updated without a code change as new versions become available.
"""

from __future__ import annotations

import json
import logging
from typing import Optional, Dict, Any

import boto3
from botocore.exceptions import ClientError, NoCredentialsError, EndpointConnectionError

from app.config import settings

logger = logging.getLogger("floodcast.bedrock")

# Module-level client (lazy init)
_bedrock_client = None
_bedrock_healthy: bool = False
_last_error: Optional[str] = None


def _get_client():
    """Lazily initialize the Bedrock runtime client."""
    global _bedrock_client, _bedrock_healthy, _last_error

    if _bedrock_client is not None:
        return _bedrock_client

    try:
        _bedrock_client = boto3.client(
            "bedrock-runtime",
            region_name=settings.aws_region,
            aws_access_key_id=settings.aws_access_key_id or None,
            aws_secret_access_key=settings.aws_secret_access_key or None,
        )
        _bedrock_healthy = True
        logger.info(f"Bedrock client initialized (region: {settings.aws_region})")
        return _bedrock_client

    except (NoCredentialsError, Exception) as e:
        _bedrock_healthy = False
        _last_error = str(e)
        logger.error(f"Failed to initialize Bedrock client: {e}")
        return None


async def invoke_model(
    prompt: str,
    model_tier: str = "haiku",
    max_tokens: int = 1024,
    temperature: float = 0.3,
    system_prompt: Optional[str] = None,
) -> Optional[str]:
    """
    Invoke a Claude model on Bedrock.

    Args:
        prompt: The user message
        model_tier: "haiku" (fast/cheap) or "sonnet" (quality)
        max_tokens: Maximum tokens in response
        temperature: Sampling temperature
        system_prompt: Optional system message

    Returns:
        The model's response text, or None on failure
    """
    global _bedrock_healthy, _last_error

    client = _get_client()
    if client is None:
        return None

    model_id = (
        settings.bedrock_haiku_model_id
        if model_tier == "haiku"
        else settings.bedrock_sonnet_model_id
    )

    messages = [{"role": "user", "content": prompt}]

    body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": max_tokens,
        "messages": messages,
        "temperature": temperature,
    }

    if system_prompt:
        body["system"] = system_prompt

    try:
        response = client.invoke_model(
            modelId=model_id,
            contentType="application/json",
            accept="application/json",
            body=json.dumps(body),
        )

        response_body = json.loads(response["body"].read())
        text = response_body.get("content", [{}])[0].get("text", "")

        _bedrock_healthy = True
        _last_error = None
        return text

    except ClientError as e:
        _bedrock_healthy = False
        _last_error = str(e)
        logger.error(f"Bedrock API error ({model_tier}/{model_id}): {e}")
        return None

    except EndpointConnectionError as e:
        _bedrock_healthy = False
        _last_error = str(e)
        logger.error(f"Bedrock connection error: {e}")
        return None

    except Exception as e:
        _bedrock_healthy = False
        _last_error = str(e)
        logger.error(f"Unexpected Bedrock error: {e}")
        return None


def is_bedrock_healthy() -> bool:
    """Check if Bedrock was reachable on the last attempt."""
    return _bedrock_healthy


def get_last_error() -> Optional[str]:
    """Get the last Bedrock error message, if any."""
    return _last_error


def check_bedrock_connection() -> Dict[str, Any]:
    """
    Check Bedrock connectivity without making a model call.
    Used by the /health endpoint.
    """
    global _bedrock_healthy, _last_error

    if not settings.aws_access_key_id or not settings.aws_secret_access_key:
        _bedrock_healthy = False
        _last_error = "AWS credentials not configured"
        return {
            "healthy": False,
            "error": "AWS credentials not configured",
        }

    client = _get_client()
    if client is None:
        return {
            "healthy": False,
            "error": _last_error or "Client initialization failed",
        }

    return {
        "healthy": _bedrock_healthy,
        "error": _last_error,
        "haiku_model": settings.bedrock_haiku_model_id,
        "sonnet_model": settings.bedrock_sonnet_model_id,
    }
