"""Structured JSON logging. One line per event, machine-parseable, no secrets."""
from __future__ import annotations

import json
import logging
import re
import sys
from datetime import UTC, datetime

from app.config import settings

# Anything matching these is replaced before it reaches a log line. An API key
# in a log is an API key in a log aggregator, a backup, and a support ticket.
_REDACT = re.compile(
    r"(api[_-]?key|password|secret|token|authorization|bearer)"
    r"([\"'\s:=]+)([^\s\"',}]{4,})", re.I)


def redact(message: str) -> str:
    return _REDACT.sub(lambda m: f"{m.group(1)}{m.group(2)}***", message)


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": redact(record.getMessage()),
        }
        if record.exc_info:
            payload["exception"] = redact(self.formatException(record.exc_info))
        for key, value in record.__dict__.items():
            if key in ("args", "msg", "exc_info", "exc_text", "stack_info", "created",
                       "msecs", "relativeCreated", "levelno", "levelname", "name",
                       "pathname", "filename", "module", "funcName", "lineno",
                       "processName", "process", "threadName", "thread", "taskName"):
                continue
            if isinstance(value, str | int | float | bool | type(None)):
                payload[key] = value
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if settings.environment != "dev"
                         else logging.Formatter(
                             "%(asctime)s %(levelname)-7s %(name)-28s %(message)s"))
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.DEBUG if settings.debug else logging.INFO)

    for noisy in ("httpx", "httpcore", "asyncio", "sqlalchemy.engine.Engine"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
