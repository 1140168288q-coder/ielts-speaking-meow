import sqlite3

import pytest

from app.database import Database
from app.migrations import upgrade_database


def sqlite_url(path) -> str:
    return f"sqlite+aiosqlite:///{path.as_posix()}"


def test_migration_upgrades_legacy_database_without_losing_users(tmp_path):
    database_path = tmp_path / "legacy.sqlite3"
    with sqlite3.connect(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE users (
                id VARCHAR(36) NOT NULL PRIMARY KEY,
                email VARCHAR(320) NOT NULL,
                password_hash TEXT NOT NULL,
                created_at DATETIME NOT NULL
            );
            CREATE UNIQUE INDEX ix_users_email ON users (email);
            INSERT INTO users (id, email, password_hash, created_at)
            VALUES ('legacy-user', 'legacy@example.com', 'hash', '2026-01-01 00:00:00');
            """
        )

    upgrade_database(sqlite_url(database_path))

    with sqlite3.connect(database_path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        user_columns = {
            row[1] for row in connection.execute("PRAGMA table_info(users)")
        }
        user = connection.execute(
            "SELECT id, email FROM users WHERE id = 'legacy-user'"
        ).fetchone()
        revision = connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone()

    assert {
        "users",
        "auth_sessions",
        "sync_entities",
        "sync_changes",
        "sync_operations",
        "account_tokens",
        "account_billing_states",
        "entitlement_overrides",
        "usage_events",
        "usage_counters",
        "webhook_events",
        "alembic_version",
    }.issubset(tables)
    assert {
        "email_verified_at",
        "display_name",
        "status",
        "updated_at",
        "deleted_at",
    }.issubset(user_columns)
    assert user == ("legacy-user", "legacy@example.com")
    assert revision == ("0004_usage_request_hash",)


@pytest.mark.asyncio
async def test_persistent_database_initialization_runs_migrations(tmp_path):
    database_path = tmp_path / "fresh.sqlite3"
    database = Database(sqlite_url(database_path))

    await database.initialize()
    await database.initialize()
    await database.close()

    with sqlite3.connect(database_path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            )
        }
        revision = connection.execute(
            "SELECT version_num FROM alembic_version"
        ).fetchone()

    assert {
        "account_tokens",
        "account_billing_states",
        "entitlement_overrides",
        "usage_events",
        "usage_counters",
        "webhook_events",
    }.issubset(tables)
    assert revision == ("0004_usage_request_hash",)
