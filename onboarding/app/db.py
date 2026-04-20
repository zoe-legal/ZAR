from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from psycopg import Connection

from .config import get_settings


@contextmanager
def onboarding_connection() -> Iterator[Connection]:
    settings = get_settings()
    with Connection.connect(settings.onboarding_database_url) as conn:
        yield conn


@contextmanager
def control_plane_connection() -> Iterator[Connection]:
    settings = get_settings()
    with Connection.connect(settings.control_plane_database_url) as conn:
        yield conn

