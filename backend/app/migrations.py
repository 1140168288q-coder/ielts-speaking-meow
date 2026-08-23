"""数据库迁移入口；部署和应用启动共用同一条升级路径。"""
from pathlib import Path

from alembic import command
from alembic.config import Config


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def build_alembic_config(database_url: str) -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    # ConfigParser 会把 % 当作插值语法；数据库密码里允许出现该字符。
    config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return config


def upgrade_database(database_url: str) -> None:
    """将目标数据库升级到最新 revision，不输出数据库 URL 或凭证。"""
    command.upgrade(build_alembic_config(database_url), "head")
