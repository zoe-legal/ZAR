from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache
from typing import Iterator

from psycopg import Connection, InterfaceError, OperationalError
from psycopg_pool import ConnectionPool

from .config import get_settings


@lru_cache(maxsize=1)
def get_control_plane_pool() -> ConnectionPool:
    settings = get_settings()
    return ConnectionPool(conninfo=settings.control_plane_database_url, min_size=1, max_size=10, open=True)


@contextmanager
def control_plane_connection() -> Iterator[Connection]:
    pool = get_control_plane_pool()
    last_error: Exception | None = None

    for _ in range(2):
        with pool.connection() as conn:
            try:
                # Preflight the pooled connection so a dead socket is discarded
                # before the request logic starts using it.
                conn.execute("select 1")
                yield conn
                return
            except (OperationalError, InterfaceError) as exc:
                last_error = exc
                try:
                    conn.close()
                except Exception:
                    pass

    if last_error is not None:
        raise last_error
