import io
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader

DATA_FILE = Path("data.js")
TIMEOUT = 30
MAX_LINKED_PDFS = 12
HEADERS = {
    "User-Agent": "Admission-Date-Tracker/1.0 (+https://admission-date-tracker.vercel.app/)"
}

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10,
    "nov": 11, "dec": 12,
}

BANGLA_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")
BANGLA_MONTHS = {
    "জানুয়ারি": 1, "জানুয়ারি": 1, "ফেব্রুয়ারি": 2, "ফেব্রুয়ারি": 2,
    "মার্চ": 3, "এপ্রিল": 4, "মে": 5, "জুন": 6, "জুলাই": 7,
    "আগস্ট": 8, "সেপ্টেম্বর": 9, "অক্টোবর": 10, "নভেম্বর": 11, "ডিসেম্বর": 12,
}

CONTEXT_RE = re.compile(
    r"admission|admissions|admission test|entrance|written test|exam|examination|"
    r"undergraduate|ভর্তি|ভর্তি পরীক্ষা|পরীক্ষা|প্রবেশিকা|application|deadline|"
    r"application deadline|আবেদন|শেষ তারিখ|unit|ইউনিট",
    re.I,
)

EXAM_RE = re.compile(
    r"admission\s*(test|exam|examination)|entrance\s*(test|exam)|"
    r"written\s*(test|exam|examination)|exam\s*(date|schedule)|"
    r"ভর্তি\s*পরীক্ষা|প্রবেশিকা\s*পরীক্ষা|পরীক্ষার\s*তারিখ",
    re.I,
)

DATE_PATTERNS = [
    re.compile(r"(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](2026|2027)(?!\d)"),
    re.compile(r"(?<!\d)(2026|2027)[./-](\d{1,2})[./-](\d{1,2})(?!\d)"),
    re.compile(
        r"\b(\d{1,2})\s+("
        + "|".join(MONTHS)
        + r")\s*,?\s*(2026|2027)\b", re.I
    ),
    re.compile(
        r"\b("
        + "|".join(MONTHS)
        + r")\s+(\d{1,2}),?\s+(2026|2027)\b", re.I
    ),
]

session = requests.Session()
session.headers.update(HEADERS)


def normalize(text):
    return text.translate(BANGLA_DIGITS).replace("\u200c", " ").replace("\u200d", " ")


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


def parse_pdf(content):
    reader = PdfReader(io.BytesIO(content))
    text = "\n".join((page.extract_text() or "") for page in reader.pages)
    return text


def fetch(url):
    r = session.get(url, timeout=TIMEOUT, allow_redirects=True)
    r.raise_for_status()
    ctype = r.headers.get("content-type", "").lower()
    final_url = r.url
    if "pdf" in ctype or final_url.lower().split("?")[0].endswith(".pdf"):
        text = parse_pdf(r.content)
        return normalize(text), final_url, []
    soup = BeautifulSoup(r.text, "html.parser")
    pdfs = []
    for a in soup.find_all("a", href=True):
        href = urljoin(final_url, a["href"])
        label = a.get_text(" ", strip=True)
        if ".pdf" in href.lower() or "pdf" in label.lower() or "notice" in label.lower():
            if urlparse(href).scheme in ("http", "https"):
                pdfs.append(href)
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return normalize(soup.get_text(" ", strip=True)), final_url, list(dict.fromkeys(pdfs))[:MAX_LINKED_PDFS]


def extract_dates(text):
    text = normalize(text)
    found = []
    for rx in DATE_PATTERNS:
        for m in rx.finditer(text):
            try:
                groups = m.groups()
                if len(groups) == 3 and groups[0].isdigit() and len(groups[0]) == 4:
                    y, mo, d = int(groups[0]), int(groups[1]), int(groups[2])
                elif len(groups) == 3 and groups[2].isdigit() and len(groups[2]) == 4:
                    d_or_month, second, y = groups
                    if d_or_month.isdigit():
                        d, mo = int(d_or_month), int(second)
                    else:
                        d, mo = int(second), MONTHS[d_or_month.lower()]
                    y = int(y)
                else:
                    continue
                dt = datetime(y, mo, d)
            except (ValueError, KeyError):
                continue

            left = max(0, m.start() - 260)
            right = min(len(text), m.end() + 260)
            ctx = text[left:right]
            if CONTEXT_RE.search(ctx):
                strength = 1
                if EXAM_RE.search(ctx):
                    strength = 3
                found.append((dt.date().isoformat(), strength, ctx))

    # Bangla month + year dates, including Bengali month names.
    month_union = {**MONTHS, **BANGLA_MONTHS}
    month_rx = re.compile(
        r"(\d{1,2})\s+(" + "|".join(map(re.escape, month_union)) + r")\s+(2026|2027)",
        re.I,
    )
    for m in month_rx.finditer(text):
        try:
            d, month, y = int(m.group(1)), m.group(2), int(m.group(3))
            dt = datetime(y, month_union[month.lower()], d)
        except (ValueError, KeyError):
            continue
        ctx = text[max(0, m.start()-260):min(len(text), m.end()+260)]
        if CONTEXT_RE.search(ctx):
            found.append((dt.date().isoformat(), 3 if EXAM_RE.search(ctx) else 1, ctx))

    unique = {}
    for date, strength, ctx in found:
        if date not in unique or strength > unique[date][0]:
            unique[date] = (strength, ctx)
    return [(d, s, c) for d, (s, c) in unique.items()]


def source_text(url):
    page_text, final_url, pdf_links = fetch(url)
    texts = [(page_text, final_url)]
    for pdf_url in pdf_links:
        try:
            pdf_text, pdf_final, _ = fetch(pdf_url)
            if pdf_text.strip():
                texts.append((pdf_text, pdf_final))
        except Exception:
            continue
    return texts


def choose_exam_date(row, texts):
    candidates = []
    current = row.get("examDate")
    for text, source_url in texts:
        for date, strength, ctx in extract_dates(text):
            score = strength * 100
            if current and date == current:
                score += 40
            if current and re.match(r"^\d{4}-", current) and date[:4] == current[:4]:
                score += 10
            if "application deadline" in ctx.lower() or "application closes" in ctx.lower():
                score -= 60
            candidates.append((score, date, source_url, ctx))

    if not candidates:
        return None

    # Prefer strong admission-test context and a date matching the existing cycle.
    # Do not replace a known date with a weak, unrelated date.
    candidates.sort(key=lambda x: (-x[0], x[1]))
    best = candidates[0]
    if best[0] < 100:
        return None
    return best[1], best[2], best[3]


def main():
    rows = load_data()
    changed = []
    failures = []
    source_cache = {}

    for row in rows:
        url = row.get("officialUrl")
        if not url:
            continue
        try:
            if url not in source_cache:
                source_cache[url] = source_text(url)
            texts = source_cache[url]
            result = choose_exam_date(row, texts)
            if not result:
                continue

            new_date, source_url, ctx = result
            old_date = row.get("examDate")
            if new_date == old_date:
                continue

            row["previousExamDate"] = old_date
            row["examDate"] = new_date
            row["dateChanged"] = True
            row["status"] = "Automatically updated from official source"
            row["notes"] = (
                f"Auto-detected admission-test date from official source: {source_url}"
            )
            changed.append((row["universityShortName"], old_date, new_date, source_url))
        except Exception as exc:
            failures.append((row.get("universityShortName"), url, str(exc)))

    if changed:
        save_data(rows)

    print(f"Checked {len(rows)} admission records from {len(source_cache)} unique official sources.")
    print(f"Changed: {len(changed)}")
    for item in changed:
        print("UPDATE:", item)

    if failures:
        print(f"Source failures: {len(failures)}")
        for item in failures:
            print("FAIL:", item)


if __name__ == "__main__":
    main()
