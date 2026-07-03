"""File parsing for bank exports: CSV/TSV, Excel, QIF and (basic) OFX/QFX.

Produces normalized rows: {date: date, description: str, amount: float}.
Amounts are signed: negative = expense, positive = income.
"""

import csv
import hashlib
import io
import re
from datetime import date, datetime

import pandas as pd
from dateutil import parser as dateparser

DATE_HEADERS = ("date", "data", "transaction date", "posted", "booking date", "value date")
DESC_HEADERS = ("description", "descricao", "descrição", "memo", "payee", "details", "narrative", "merchant")
AMOUNT_HEADERS = ("amount", "montante", "valor", "value")
DEBIT_HEADERS = ("debit", "débito", "debito", "withdrawal", "money out", "out")
CREDIT_HEADERS = ("credit", "crédito", "credito", "deposit", "money in", "in")


class ImportError_(Exception):
    pass


def tx_hash(d: date, amount: float, description: str) -> str:
    norm = re.sub(r"\s+", " ", description.strip().lower())
    raw = f"{d.isoformat()}|{amount:.2f}|{norm}"
    return hashlib.sha256(raw.encode()).hexdigest()


def _find_column(columns: list[str], candidates: tuple[str, ...]) -> str | None:
    lowered = {c.lower().strip(): c for c in columns}
    for cand in candidates:
        if cand in lowered:
            return lowered[cand]
    for low, orig in lowered.items():
        if any(cand in low for cand in candidates):
            return orig
    return None


def _parse_amount(value) -> float:
    if pd.isna(value):
        raise ImportError_("empty amount")
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace(" ", "").replace(" ", "")
    negative = s.startswith("(") and s.endswith(")")
    s = s.strip("()").lstrip("+")
    s = re.sub(r"[^\d,.\-]", "", s)
    # decide decimal separator: last of . or ,
    if "," in s and "." in s:
        if s.rfind(",") > s.rfind("."):
            s = s.replace(".", "").replace(",", ".")
        else:
            s = s.replace(",", "")
    elif "," in s:
        # single comma with 1-2 decimals -> decimal separator, else thousands
        if re.search(r",\d{1,2}$", s):
            s = s.replace(",", ".")
        else:
            s = s.replace(",", "")
    if not s or s == "-":
        raise ImportError_(f"cannot parse amount: {value!r}")
    result = float(s)
    return -result if negative else result


def _detect_dayfirst(values: list[str]) -> bool:
    """If any value has first component > 12, dates are day-first."""
    for v in values:
        m = re.match(r"\s*(\d{1,2})[/.\-]", str(v))
        if m and int(m.group(1)) > 12:
            return True
    return False


def _parse_date(value, dayfirst: bool) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    if not s:
        raise ImportError_("empty date")
    return dateparser.parse(s, dayfirst=dayfirst).date()


def _rows_from_dataframe(df: pd.DataFrame) -> list[dict]:
    cols = [str(c) for c in df.columns]
    date_col = _find_column(cols, DATE_HEADERS)
    desc_col = _find_column(cols, DESC_HEADERS)
    amount_col = _find_column(cols, AMOUNT_HEADERS)
    debit_col = _find_column(cols, DEBIT_HEADERS)
    credit_col = _find_column(cols, CREDIT_HEADERS)

    if not date_col:
        raise ImportError_(f"could not find a date column among: {cols}")
    if not desc_col:
        raise ImportError_(f"could not find a description column among: {cols}")
    if not amount_col and not (debit_col or credit_col):
        raise ImportError_(f"could not find amount/debit/credit columns among: {cols}")

    dayfirst = _detect_dayfirst(df[date_col].dropna().astype(str).head(50).tolist())

    rows, errors = [], []
    for idx, rec in df.iterrows():
        try:
            d = _parse_date(rec[date_col], dayfirst)
            desc = str(rec[desc_col]).strip()
            if amount_col and not pd.isna(rec[amount_col]) and str(rec[amount_col]).strip():
                amount = _parse_amount(rec[amount_col])
            else:
                amount = 0.0
                if debit_col and not pd.isna(rec.get(debit_col)) and str(rec.get(debit_col)).strip():
                    amount -= abs(_parse_amount(rec[debit_col]))
                if credit_col and not pd.isna(rec.get(credit_col)) and str(rec.get(credit_col)).strip():
                    amount += abs(_parse_amount(rec[credit_col]))
                if amount == 0.0:
                    raise ImportError_("no amount in row")
            rows.append({"date": d, "description": desc, "amount": round(amount, 2)})
        except Exception as e:
            errors.append(f"row {idx + 2}: {e}")
    if not rows and errors:
        raise ImportError_("; ".join(errors[:5]))
    return rows


def _parse_csv(content: bytes) -> list[dict]:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            text = content.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ImportError_("could not decode file")
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=",;\t|")
        sep = dialect.delimiter
    except csv.Error:
        sep = ","
    df = pd.read_csv(io.StringIO(text), sep=sep, dtype=str, skip_blank_lines=True)
    return _rows_from_dataframe(df)


def _parse_excel(content: bytes) -> list[dict]:
    df = pd.read_excel(io.BytesIO(content))
    return _rows_from_dataframe(df)


def _parse_qif(content: bytes) -> list[dict]:
    text = content.decode("utf-8", errors="replace")
    rows, current, dayfirst_probe = [], {}, []
    for line in text.splitlines():
        if line.startswith("D"):
            dayfirst_probe.append(line[1:])
    dayfirst = _detect_dayfirst(dayfirst_probe)
    for line in text.splitlines():
        line = line.rstrip()
        if not line:
            continue
        code, value = line[0], line[1:].strip()
        if code == "D":
            current["date"] = dateparser.parse(value.replace("'", "/"), dayfirst=dayfirst).date()
        elif code == "T":
            current["amount"] = _parse_amount(value)
        elif code in ("P", "M") and "description" not in current:
            current["description"] = value
        elif code == "^":
            if "date" in current and "amount" in current:
                current.setdefault("description", "")
                rows.append(current)
            current = {}
    return rows


def _parse_ofx(content: bytes) -> list[dict]:
    text = content.decode("utf-8", errors="replace")
    rows = []
    for block in re.findall(r"<STMTTRN>(.*?)(?:</STMTTRN>|(?=<STMTTRN>))", text, re.S | re.I):
        def tag(name):
            m = re.search(rf"<{name}>([^<\r\n]+)", block, re.I)
            return m.group(1).strip() if m else None

        dt, amt = tag("DTPOSTED"), tag("TRNAMT")
        if not dt or not amt:
            continue
        d = datetime.strptime(dt[:8], "%Y%m%d").date()
        desc = tag("NAME") or tag("MEMO") or ""
        rows.append({"date": d, "description": desc, "amount": _parse_amount(amt)})
    if not rows:
        raise ImportError_("no transactions found in OFX file")
    return rows


def parse_file(filename: str, content: bytes) -> list[dict]:
    ext = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
    if ext in ("xlsx", "xls"):
        return _parse_excel(content)
    if ext == "qif":
        return _parse_qif(content)
    if ext in ("ofx", "qfx"):
        return _parse_ofx(content)
    return _parse_csv(content)
