"""
Alembic environment — reads DATABASE_URL from the app's config module,
so migrations always target the same DB the app uses.

Autogenerate is wired via target_metadata = Base.metadata.

`import models` is load-bearing: without it Base.metadata is empty and
`alembic revision --autogenerate` produces an empty revision with no
CREATE TABLE or CREATE TYPE statements.
[CITED: https://alembic.sqlalchemy.org/en/latest/autogenerate.html]
"""
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

# Make app modules importable when alembic runs from the repo root or app/.
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__) + "/.."))

import config as app_config  # noqa: E402
from db import Base           # noqa: E402
import models                 # noqa: E402, F401 — import models so metadata is populated

alembic_config = context.config

# Interpret the config file for Python logging.
if alembic_config.config_file_name is not None:
    fileConfig(alembic_config.config_file_name)

# Override sqlalchemy.url with the app's config so the same DSN is used
# whether alembic runs from the CLI or from a Python entrypoint.
alembic_config.set_main_option("sqlalchemy.url", app_config.DATABASE_URL)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL and not an Engine,
    though an Engine is acceptable here as well.  By skipping the Engine
    creation we don't even need a DBAPI to be available.
    """
    url = alembic_config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode.

    In this scenario we need to create an Engine and associate a connection
    with the context.
    """
    connectable = engine_from_config(
        alembic_config.get_section(alembic_config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
