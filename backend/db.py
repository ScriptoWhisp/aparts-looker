"""
SQLAlchemy engine + session factory + declarative base for the app.

One engine per process (module-level). `SessionLocal()` opens a new short-lived
session that the caller owns and must close. `get_db()` is the FastAPI
dependency-injection wrapper for new routes.

Design notes:
  - `pool_pre_ping=True`: issues a cheap SELECT 1 before each connection checkout;
    recovers cleanly after a Postgres container restart (happens on every deploy).
  - `expire_on_commit=False`: prevents attribute access after commit from re-hitting
    the DB, which would violate the never-raise contract when the session is closed.
  - Daemon threads (APScheduler, background handlers) MUST call `SessionLocal()`
    themselves — they cannot inherit a `Session` from `Depends(get_db)`.
    [CITED: SQLAlchemy docs — Session is not thread-safe for sharing]
  - NEVER log `config.DATABASE_URL` — it contains the Postgres password.
    Log `config.POSTGRES_HOST` / `config.POSTGRES_DB` / `config.POSTGRES_USER` only.
"""
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, MappedAsDataclass, Session, sessionmaker

import config


class Base(MappedAsDataclass, DeclarativeBase):
    """Shared declarative base for all ORM models (Listing, ...)."""

    pass


engine = create_engine(
    config.DATABASE_URL,
    pool_pre_ping=True,  # cheap SELECT 1 before each checkout; survives pg restart
    future=True,         # 2.x behaviour flag (default in 2.x; explicit for clarity)
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
    expire_on_commit=False,
)


def get_db() -> Generator[Session, None, None]:
    """FastAPI dependency — opens a session, yields it, closes on request end.

    Usage in a route:
        from db import get_db
        from sqlalchemy.orm import Session
        from fastapi import Depends

        @app.get("/api/example")
        def example(db: Session = Depends(get_db)):
            ...

    Not consumed in Phase 7 (existing routes call data_store.* which manage
    sessions internally), but shipped here for future route authors.
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
