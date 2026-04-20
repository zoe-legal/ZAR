from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

import boto3
from dotenv import load_dotenv


BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _first_string(payload: dict[str, Any], keys: tuple[str, ...], label: str) -> str:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    raise RuntimeError(f"{label} is required in secret payload; checked keys: {', '.join(keys)}")


@dataclass(frozen=True)
class Settings:
    aws_region: str
    control_plane_secret_id: str
    control_plane_database_url: str
    port: int = 8791


def _read_secret(secret_id: str, region: str) -> dict[str, Any]:
    client = boto3.client("secretsmanager", region_name=region)
    response = client.get_secret_value(SecretId=secret_id)
    secret_string = response.get("SecretString")
    if not isinstance(secret_string, str) or not secret_string.strip():
        raise RuntimeError(f"Secrets Manager secret {secret_id} has no SecretString")

    payload = json.loads(secret_string)
    if not isinstance(payload, dict):
        raise RuntimeError(f"Secrets Manager secret {secret_id} must decode to a JSON object")
    return payload


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    aws_region = _required_env("AWS_REGION")
    control_plane_secret_id = _required_env("CONTROL_PLANE_SECRET_ID")
    control_plane_secret = _read_secret(control_plane_secret_id, aws_region)

    return Settings(
      aws_region=aws_region,
      control_plane_secret_id=control_plane_secret_id,
      control_plane_database_url=_first_string(
        control_plane_secret,
        ("zoe_control_plane_database_url", "control_plane_database_url", "database_url"),
        "control plane database url",
      ),
      port=int(os.getenv("PORT", "8791")),
    )
