from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache
from typing import Iterator

from psycopg import Connection
from psycopg_pool import ConnectionPool

from .config import get_settings


@lru_cache(maxsize=1)
def get_onboarding_pool() -> ConnectionPool:
    settings = get_settings()
    return ConnectionPool(conninfo=settings.onboarding_database_url, min_size=1, max_size=10, open=True)


@lru_cache(maxsize=1)
def get_control_plane_pool() -> ConnectionPool:
    settings = get_settings()
    return ConnectionPool(conninfo=settings.control_plane_database_url, min_size=1, max_size=10, open=True)


@contextmanager
def onboarding_connection() -> Iterator[Connection]:
    with get_onboarding_pool().connection() as conn:
        yield conn


@contextmanager
def control_plane_connection() -> Iterator[Connection]:
    with get_control_plane_pool().connection() as conn:
        yield conn
