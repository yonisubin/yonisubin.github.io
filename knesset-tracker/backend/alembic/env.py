from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

import app.entities  # noqa: F401 - registers the domain tables on the metadata
from app.config import get_settings
from app.models import metadata

if context.config.config_file_name:
    fileConfig(context.config.config_file_name)


def run_migrations_offline() -> None:
    context.configure(url=get_settings().database_url, target_metadata=metadata,
                      literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(get_settings().database_url)
    with engine.connect() as conn:
        context.configure(connection=conn, target_metadata=metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
