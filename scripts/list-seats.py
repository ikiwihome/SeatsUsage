# -*- coding: utf-8 -*-
"""快速打印席位清单（管道分隔），供终端/表格使用。"""
import json
import os
from datetime import datetime, timezone


def load_json(path):
    with open(path, "rb") as fh:
        raw = fh.read()
    for enc in ("utf-8-sig", "utf-16", "utf-16-le", "utf-8"):
        try:
            return json.loads(raw.decode(enc))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
    text = raw.decode("utf-8", errors="ignore")
    start = text.find("{")
    if start >= 0:
        return json.loads(text[start:])
    raise ValueError(f"无法解析 JSON: {path}")


def ts_to_date(value):
    try:
        ts = int(value)
    except (TypeError, ValueError):
        return ""
    if ts <= 0:
        return ""
    return datetime.fromtimestamp(ts, tz=timezone.utc).astimezone().strftime("%Y-%m-%d")


def classify(seat):
    if str(seat.get("SeatStatus")) != "2":
        return "已解绑"
    if str(seat.get("BillingStatus")) == "2":
        return "有效"
    return "已过期"


def main():
    temp = os.environ.get("TEMP") or os.environ.get("TMP") or "."
    rows = []
    for filename, label in (
        ("seats_coding.json", "Coding Plan"),
        ("seats_agent.json", "Agent Plan"),
    ):
        path = os.path.join(temp, filename)
        if not os.path.exists(path):
            continue
        data = (load_json(path).get("Result") or {}).get("Data") or []
        for s in data:
            rows.append(
                (
                    label,
                    s.get("SeatID", ""),
                    s.get("IdentityDetail") or "",
                    s.get("ApiKey") or "",
                    s.get("BizInfo") or "",
                    s.get("SeatStatus"),
                    s.get("BillingStatus"),
                    classify(s),
                    ts_to_date(s.get("ExpiredTime")),
                )
            )
    print(f"COUNT={len(rows)}")
    for r in rows:
        print("|".join(str(c) for c in r))


if __name__ == "__main__":
    main()
