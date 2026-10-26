# -*- coding: utf-8 -*-
"""把 arkcli 拉取的席位 JSON 导出为带格式的 Excel (.xlsx)。

输入：%TEMP%\\seats_coding.json、%TEMP%\\seats_agent.json（trade.list_seat_infos 的原始返回）
用法：python scripts/export-seats-xlsx.py [输出路径]
"""
import json
import os
import sys
from datetime import datetime, timezone

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

SCENES = [
    ("coding_plan_enterprise", "seats_coding.json", "Coding Plan"),
    ("agent_plan_enterprise", "seats_agent.json", "Agent Plan"),
]

COLUMNS = [
    ("序号", 6),
    ("套餐类型", 13),
    ("SeatID", 28),
    ("绑定用户名", 16),
    ("API Key", 54),
    ("ApiKeySID", 30),
    ("Tier", 8),
    ("SeatStatus", 11),
    ("BillingStatus", 13),
    ("状态", 12),
    ("过期时间", 12),
    ("IdentityId", 12),
    ("InstanceID", 30),
]

HEADER_FILL = PatternFill("solid", fgColor="1F4E79")
HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)
OK_FILL = PatternFill("solid", fgColor="E2EFDA")
EXPIRED_FILL = PatternFill("solid", fgColor="FCE4E4")
UNBOUND_FILL = PatternFill("solid", fgColor="F2F2F2")
THIN = Side(style="thin", color="BFBFBF")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def load_json(path):
    """读取 JSON，兼容 PowerShell 重定向产生的 UTF-16 / BOM。"""
    with open(path, "rb") as fh:
        raw = fh.read()
    for enc in ("utf-8-sig", "utf-16", "utf-16-le", "utf-8"):
        try:
            return json.loads(raw.decode(enc))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
    # 兜底：剥掉 arkcli 版本提示等非 JSON 前缀
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
    """返回 (状态文案, 填充)。"""
    if str(seat.get("SeatStatus")) != "2":
        return "已解绑", UNBOUND_FILL
    if str(seat.get("BillingStatus")) == "2":
        return "有效", OK_FILL
    return "已过期", EXPIRED_FILL


def build_rows():
    temp = os.environ.get("TEMP") or os.environ.get("TMP") or "."
    rows = []
    for scene, filename, label in SCENES:
        path = os.path.join(temp, filename)
        if not os.path.exists(path):
            print(f"[warn] 找不到 {path}，跳过 {label}")
            continue
        payload = load_json(path)
        for seat in (payload.get("Result") or {}).get("Data") or []:
            status, fill = classify(seat)
            rows.append(
                {
                    "套餐类型": label,
                    "SeatID": seat.get("SeatID", ""),
                    "绑定用户名": seat.get("IdentityDetail") or "",
                    "API Key": seat.get("ApiKey") or "",
                    "ApiKeySID": seat.get("ApiKeySID") or "",
                    "Tier": seat.get("BizInfo") or "",
                    "SeatStatus": seat.get("SeatStatus"),
                    "BillingStatus": seat.get("BillingStatus"),
                    "状态": status,
                    "过期时间": ts_to_date(seat.get("ExpiredTime")),
                    "IdentityId": seat.get("IdentityId") or "",
                    "InstanceID": seat.get("InstanceID") or "",
                    "_fill": fill,
                    "_scene": scene,
                }
            )
    return rows


def write_workbook(rows, out_path):
    wb = Workbook()

    # --- Sheet 1: 全部席位 ---
    ws = wb.active
    ws.title = "全部席位"
    ws.append([name for name, _ in COLUMNS])
    for cell in ws[1]:
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = BORDER
    ws.row_dimensions[1].height = 22

    for idx, row in enumerate(rows, start=1):
        ws.append(
            [idx]
            + [row.get(name, "") for name, _ in COLUMNS[1:]]
        )
        r = ws.max_row
        fill = row["_fill"]
        for c in range(1, len(COLUMNS) + 1):
            cell = ws.cell(row=r, column=c)
            cell.border = BORDER
            cell.fill = fill
            cell.alignment = Alignment(
                vertical="center",
                horizontal="left" if c in (3, 5, 6) else "center",
            )
        ws.cell(row=r, column=1).font = Font(bold=True)

    for i, (_, width) in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = width
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNS))}{ws.max_row}"

    # --- Sheet 2: 有效席位 ---
    active = [r for r in rows if r["状态"] == "有效"]
    ws2 = wb.create_sheet("有效席位")
    ws2.append([name for name, _ in COLUMNS])
    for cell in ws2[1]:
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = BORDER
    ws2.row_dimensions[1].height = 22
    for idx, row in enumerate(active, start=1):
        ws2.append([idx] + [row.get(name, "") for name, _ in COLUMNS[1:]])
        r = ws2.max_row
        for c in range(1, len(COLUMNS) + 1):
            cell = ws2.cell(row=r, column=c)
            cell.border = BORDER
            cell.fill = OK_FILL
            cell.alignment = Alignment(
                vertical="center",
                horizontal="left" if c in (3, 5, 6) else "center",
            )
        ws2.cell(row=r, column=1).font = Font(bold=True)
    for i, (_, width) in enumerate(COLUMNS, start=1):
        ws2.column_dimensions[get_column_letter(i)].width = width
    ws2.freeze_panes = "A2"
    ws2.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNS))}{ws2.max_row}"

    # --- Sheet 3: 统计 ---
    ws3 = wb.create_sheet("统计")
    coding = [r for r in rows if r["套餐类型"] == "Coding Plan"]
    agent = [r for r in rows if r["套餐类型"] == "Agent Plan"]
    stats = [
        ("指标", "Coding Plan", "Agent Plan", "合计"),
        ("总席位", len(coding), len(agent), len(rows)),
        ("有效", sum(1 for r in coding if r["状态"] == "有效"),
         sum(1 for r in agent if r["状态"] == "有效"), len(active)),
        ("已过期", sum(1 for r in coding if r["状态"] == "已过期"),
         sum(1 for r in agent if r["状态"] == "已过期"),
         sum(1 for r in rows if r["状态"] == "已过期")),
        ("已解绑", sum(1 for r in coding if r["状态"] == "已解绑"),
         sum(1 for r in agent if r["状态"] == "已解绑"),
         sum(1 for r in rows if r["状态"] == "已解绑")),
        ("导出时间", "", "", datetime.now().strftime("%Y-%m-%d %H:%M")),
    ]
    for r_i, line in enumerate(stats, start=1):
        ws3.append(list(line))
        for c in range(1, 5):
            cell = ws3.cell(row=r_i, column=c)
            cell.border = BORDER
            cell.alignment = Alignment(horizontal="center", vertical="center")
            if r_i == 1:
                cell.fill = HEADER_FILL
                cell.font = HEADER_FONT
            elif c == 1:
                cell.font = Font(bold=True)
    for col, width in zip("ABCD", (16, 14, 14, 14)):
        ws3.column_dimensions[col].width = width

    wb.save(out_path)
    return len(rows), len(active)


def main():
    default_out = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        f"seats-{datetime.now().strftime('%Y%m%d')}.xlsx",
    )
    out_path = sys.argv[1] if len(sys.argv) > 1 else default_out
    rows = build_rows()
    if not rows:
        print("没有可导出的数据，请先运行 arkcli api trade.list_seat_infos 拉取 JSON。")
        return 1
    total, active = write_workbook(rows, out_path)
    print(f"已导出 {total} 条席位（有效 {active} 条）-> {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
