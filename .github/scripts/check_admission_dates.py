import re
import json
from pathlib import Path
from datetime import datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

DATA_FILE = Path("data.js")
TIMEOUT = 25
HEADERS = {
    "User-Agent": "Admission-Date-Tracker/1.0 (+https://admission-date-tracker.vercel.app/)"
}

# Conservative automatic checker.
# It checks every record on every scheduled run. It only writes a value when
# a date is found on the university's official source in a clearly admission/
# exam-related context. Otherwise the existing value is preserved.
DATE_RE = re.compile(
    r"(?<!\d)(?:(\d{1,2})[./-](\d{1,2})[./-](2026|2027)"
    r"|(\d{4})[./-](\d{1,2})[./-](\d{1,2}))(?<!\d)"
)
MONTH_RE = re.compile(
    r"\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(2026|2027)\b",
    re.I,
)
MONTH_RE2 = re.compile(
    r"\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(2026|2027)\b",
    re.I,
)

KEYWORDS = re.compile(
    r"admission|admissions|admission test|entrance|written test|exam|examination|"
    r"undergraduate|application deadline|application closes|deadline|unit",
    re.I,
)

session = requests.Session()
session.headers.update(HEADERS)


def load_data():
    text = DATA_FILE.read_text(encoding="utf-8")
    m = re.search(r"window\.ADMISSION_EXAMS\s*=\s*(\[.*\]);?\s*$", text, re.S)
    if not m:
        raise RuntimeError("Could not parse data.js")
    return json.loads(m.group(1))


def save_data(rows):
    DATA_FILE.write_text(
        "window.ADMISSION_EXAMS = "
        + json.dumps(rows, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )


def fetch_source(url):
    r = session.get(url, timeout=TIMEOUT, allow_redirects=True)
    r.raise_for_status()
    ctype = r.headers.get("content-type", "").lower()
    if "pdf" in ctype or r.url.lower().split("?")[0].endswith(".pdf"):
        reader = PdfReader(r.content if False else __import__("io").BytesIO(r.content))
        text = "\n".join((p.extract_text() or "") for p in reader.pages)
        return text, r.url
    soup = BeautifulSoup(r.text, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return soup.get_text(" ", strip=True), r.url


def candidates(text):
    out = []
    for m in DATE_RE.finditer(text):
        if m.group(1):
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        else:
            y, mo, d = int(m.group(4)), int(m.group(5)), int(m.group(6))
        try:
            dt = datetime(y, mo, d)
        except ValueError:
            continue
        a, b = max(0, m.start() - 180), min(len(text), m.end() + 180)
        ctx = text[a:b]
        if KEYWORDS.search(ctx):
            out.append((dt.date().isoformat(), ctx))
    for rx in (MONTH_RE, MONTH_RE2):
        for m in rx.finditer(text):
            try:
                if m.re is MONTH_RE:
                    d, month, y = int(m.group(1)), m.group(2), int(m.group(3))
                else:
                    month, d, y = m.group(1), int(m.group(2)), int(m.group(3))
                dt = datetime.strptime(f"{d} {month} {y}", "%d %B %Y")
            except ValueError:
                continue
            a, b = max(0, m.start() - 180), min(len(text), m.end() + 180)
            ctx = text[a:b]
            if KEYWORDS.search(ctx):
                out.append((dt.date().isoformat(), ctx))
    # Keep unique dates with context.
    seen = {}
    for date, ctx in out:
        seen.setdefault(date, ctx)
    return list(seen.items())


def choose_exam_date(row, found):
    if not found:
        return None
    current = row.get("examDate")
    current_year = int(current[:4]) if current and re.match(r"^\d{4}-", current) else None
    # Prefer a date close to the current value, then future 2026/27 dates.
    if current:
        for date, ctx in found:
            if date == current:
                return current
    ranked = []
    now = datetime.now().date()
    for date, ctx in found:
        dt = datetime.fromisoformat(date).date()
        if dt < now and dt.year >= 2026:
            continue
        score = 0
        if current_year and dt.year == current_year:
            score += 10
        if re.search(r"admission\s+(test|exam)|entrance|written\s+(test|exam)|examination", ctx, re.I):
            score += 20
        ranked.append((score, dt, date, ctx))
    if not ranked:
        return None
    ranked.sort(key=lambda x: (-x[0], x[1]))
    return ranked[0][2]


def main():
    rows = load_data()
    changed = []
    failures = []

    # Every record is checked every run; duplicate university URLs are fetched
    # once per run, but every record is evaluated against that source.
    cache = {}
    for row in rows:
        url = row.get("officialUrl")
        if not url:
            continue
        try:
            if url not in cache:
                cache[url] = fetch_source(url)
            text, final_url = cache[url]
            found = candidates(text)
            new_date = choose_exam_date(row, found)
            if new_date and new_date != row.get("examDate"):
                old = row.get("examDate")
                row["previousExamDate"] = old
                row["examDate"] = new_date
                row["dateChanged"] = True
                row["status"] = "Automatically updated from official source"
                row["notes"] = f"Auto-detected from official source: {final_url}"
                changed.append((row["universityShortName"], old, new_date, final_url))
        except Exception as exc:
            failures.append((row.get("universityShortName"), url, str(exc)))

    if changed:
        save_data(rows)

    print(f"Checked {len(rows)} admission records.")
    print(f"Changed: {len(changed)}")
    for item in changed:
        print("UPDATE:", item)
    if failures:
        print(f"Source failures: {len(failures)}")
        for item in failures:
            print("FAIL:", item)


if __name__ == "__main__":
    main()
