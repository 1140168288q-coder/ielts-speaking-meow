"""SQLAlchemy 2 异步数据库基础设施。"""
import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import StaticPool


class Base(DeclarativeBase):
    pass


class Database:
    """持有 Engine，并在首次使用时幂等升级到当前数据库版本。"""

    def __init__(self, database_url: str) -> None:
        self.database_url = database_url
        engine_options: dict = {"pool_pre_ping": True}
        if database_url.startswith("sqlite+") and ":memory:" in database_url:
            engine_options["poolclass"] = StaticPool

        self.engine: AsyncEngine = create_async_engine(database_url, **engine_options)
        self.session_factory = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
        self._initialized = False
        self._initialize_lock = asyncio.Lock()

    def _ensure_sqlite_parent(self) -> None:
        url = make_url(self.database_url)
        if not url.drivername.startswith("sqlite") or not url.database:
            return
        if url.database == ":memory:":
            return
        Path(url.database).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)

    async def initialize(self) -> None:
        if self._initialized:
            return
        async with self._initialize_lock:
            if self._initialized:
                return
            self._ensure_sqlite_parent()
            if self.database_url.startswith("sqlite+") and ":memory:" in self.database_url:
                # 测试用内存数据库不跨连接持久化；直接按当前 metadata 建表。
                from . import models  # noqa: F401

                async with self.engine.begin() as connection:
                    await connection.run_sync(Base.metadata.create_all)
            else:
                # Alembic 的命令入口内部管理事件循环，因此放在线程中执行。
                from .migrations import upgrade_database

                await asyncio.to_thread(upgrade_database, self.database_url)
            self._initialized = True

    async def session(self) -> AsyncIterator[AsyncSession]:
        await self.initialize()
        async with self.session_factory() as session:
            yield session

    async def close(self) -> None:
        await self.engine.dispose()
        self._initialized = False
