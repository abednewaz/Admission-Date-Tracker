import io
import json
import re
import hashlib
from datetime import datetime, date
from zoneinfo import ZoneInfo
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from pypdf import PdfReader
import fitz
import pytesseract

DATA_FILE = Path("data.js")
TIMEOUT = 30
MAX_LINKED_PDFS = 12
MAX_LINKED_REQUIREMENT_PAGES = 8
CYCLE_START = date(2026, 11, 1)
CYCLE_END = date(2027, 12, 31)
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
        + json.dumps(rows, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )


def parse_pdf(content):
    reader = PdfReader(io.BytesIO(content))
    text = "\n".join((page.extract_text() or "") for page in reader.pages)

    # Many university notices are scanned/image PDFs. Use OCR only when
    # normal PDF text extraction is clearly insufficient.
    if len(text.strip()) >= 180 and re.search(r"\d", text):
        return text

    try:
        doc = fitz.open(stream=content, filetype="pdf")
        pages = []
        for page in doc[:8]:
            pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            image = pix.tobytes("png")
            pages.append(pytesseract.image_to_string(image, lang="eng+ben"))
        ocr_text = "\n".join(pages)
        return (text + "\n" + ocr_text).strip()
    except Exception:
        return text


SOURCE_FALLBACKS = {
    "dgme.teletalk.com.bd": [
        "https://dgme.gov.bd/",
    ],
    "admission.mist.ac.bd": [
        "https://www.admission.mist.ac.bd/",
    ],
    "admissions.northsouth.edu": [
        "https://admissions.northsouth.edu/index.php/deadline",
    ],
    "www.iub.edu.bd": [
        "https://www.admission.iub.edu.bd/",
    ],
    "gstadmission.ac.bd": [
        "https://admission.just.edu.bd/Home/Index",
        "https://www.nstu.edu.bd/services/viewNotice",
    ],
}

def request_source(url):
    candidates = [url]
    host = urlparse(url).netloc.lower()
    candidates.extend(SOURCE_FALLBACKS.get(host, []))

    last_error = None
    browser_headers = {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,bn;q=0.8",
        "Referer": url,
        "Connection": "keep-alive",
    }

    for candidate in list(dict.fromkeys(candidates)):
        for verify in (True, False):
            try:
                headers = dict(browser_headers)
                headers["Referer"] = candidate
                r = session.get(
                    candidate,
                    timeout=TIMEOUT,
                    allow_redirects=True,
                    verify=verify,
                    headers=headers,
                )
                r.raise_for_status()
                return r
            except requests.exceptions.SSLError as exc:
                last_error = exc
                if verify:
                    continue
                break
            except requests.exceptions.RequestException as exc:
                last_error = exc
                break

    raise last_error or RuntimeError(f"Could not fetch source: {url}")


def fetch(url):
    r = request_source(url)
    ctype = r.headers.get("content-type", "").lower()
    final_url = r.url
    if "pdf" in ctype or final_url.lower().split("?")[0].endswith(".pdf"):
        text = parse_pdf(r.content)
        return normalize(text), final_url, [], []
    soup = BeautifulSoup(r.text, "html.parser")
    pdfs = []
    requirement_pages = []
    for a in soup.find_all("a", href=True):
        href = urljoin(final_url, a["href"])
        label = a.get_text(" ", strip=True)
        if urlparse(href).scheme not in ("http", "https"):
            continue
        low = f"{href} {label}".lower()
        if ".pdf" in href.lower() or "pdf" in label.lower() or "notice" in label.lower():
            pdfs.append(href)
        if re.search(r"requirement|eligibility|eligible|qualification|minimum requirement|ভর্তির যোগ্যতা|যোগ্যতা", low, re.I):
            requirement_pages.append(href)
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return (
        normalize(soup.get_text(" ", strip=True)),
        final_url,
        list(dict.fromkeys(pdfs))[:MAX_LINKED_PDFS],
        list(dict.fromkeys(requirement_pages))[:MAX_LINKED_REQUIREMENT_PAGES],
    )


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
    page_text, final_url, pdf_links, requirement_links = fetch(url)
    texts = [(page_text, final_url)]
    seen = {final_url}

    # Follow explicit official requirement/eligibility links. This is important
    # for sites such as NSU where dates and requirements live on separate pages.
    for req_url in requirement_links:
        if req_url in seen:
            continue
        seen.add(req_url)
        try:
            req_text, req_final, req_pdfs, _ = fetch(req_url)
            if req_text.strip():
                texts.append((req_text, req_final))
            for pdf_url in req_pdfs:
                if pdf_url in seen:
                    continue
                seen.add(pdf_url)
                try:
                    pdf_text, pdf_final, _, _ = fetch(pdf_url)
                    if pdf_text.strip():
                        texts.append((pdf_text, pdf_final))
                except Exception:
                    continue
        except Exception:
            continue

    for pdf_url in pdf_links:
        if pdf_url in seen:
            continue
        seen.add(pdf_url)
        try:
            pdf_text, pdf_final, _, _ = fetch(pdf_url)
            if pdf_text.strip():
                texts.append((pdf_text, pdf_final))
        except Exception:
            continue
    return texts


def row_keywords(row):
    unit = normalize(str(row.get("unit", ""))).lower()
    words = re.findall(r"[a-z]{4,}", unit)
    stop = {"undergraduate", "admission", "spring", "trimester", "session", "batch", "except", "most", "programs"}
    return [w for w in words if w not in stop][:6]



REQUIREMENT_RE = re.compile(
    r"eligib|eligibility|eligible|admission requirements?|requirements?|"
    r"qualification|qualifications|minimum gpa|minimum grade|academic requirement|"
    r"ভর্তির যোগ্যতা|যোগ্যতা|ভর্তির শর্ত|শর্তাবলি|প্রয়োজনীয়তা|প্রয়োজনীয়তা|"
    r"এসএসসি|এইচএসসি|সমমান|জিপিএ",
    re.I,
)

REQUIREMENT_NEGATIVE_RE = re.compile(
    r"application deadline|last date to apply|application closes|"
    r"admission test date|exam date|exam schedule|"
    r"আবেদনের শেষ|আবেদন শেষ|পরীক্ষার তারিখ|পরীক্ষা অনুষ্ঠিত",
    re.I,
)

GROUP_TERMS = {
    "science": re.compile(r"\bscience\b|বিজ্ঞান", re.I),
    "business": re.compile(r"\bbusiness(?: studies)?\b|commerce|ব্যবসায়|ব্যবসায়", re.I),
    "humanities": re.compile(r"\bhumanities\b|arts|মানবিক", re.I),
    "madrasa": re.compile(r"\bmadrasa\b|alim|মাদ্রাসা|আলিম", re.I),
    "technical": re.compile(r"\btechnical\b|vocational|কারিগরি|ভোকেশনাল", re.I),
    "oLevelALevel": re.compile(r"o[- ]?level|a[- ]?level|igcse|ial|gce", re.I),
}

GENERIC_REQUIREMENT_TEXTS = {
    "Check universities' website for more information.",
    "Check the university's official website for information about other or special qualifications.",
    "O-Level/A-Level applicants must satisfy the university's published equivalent-qualification and equivalence requirements. Check the official admission guideline for the exact subject, grade and equivalence rules.",
}

def normalize_requirement_text(text):
    text = normalize(text)
    text = re.sub(r"\s+", " ", text).strip(" -–—:;,.")
    return text

def requirement_hash(text):
    return hashlib.sha256(normalize_requirement_text(text).lower().encode("utf-8")).hexdigest()

def requirement_candidates(text):
    text = normalize(text)
    # HTML pages become mostly one long line after BeautifulSoup extraction,
    # while PDFs normally retain line breaks. Sentence splitting works for both.
    sentences = re.split(r"(?<=[.!?।])\s+|\n+", text)
    sentences = [s.strip() for s in sentences if s.strip()]
    candidates = []

    for i, sentence in enumerate(sentences):
        if not REQUIREMENT_RE.search(sentence):
            continue
        if REQUIREMENT_NEGATIVE_RE.search(sentence) and not re.search(
            r"eligib|qualification|requirement|minimum gpa|minimum grade|যোগ্যতা|সমমান",
            sentence,
            re.I,
        ):
            continue

        start = max(0, i - 1)
        end = min(len(sentences), i + 4)
        block = " ".join(sentences[start:end])
        block = normalize_requirement_text(block)

        if len(block) < 70 or len(block) > 3000:
            continue

        score = 100
        if re.search(r"eligib|eligibility|eligible", block, re.I):
            score += 35
        if re.search(r"requirement|qualification", block, re.I):
            score += 30
        if re.search(r"minimum gpa|minimum grade|gpa|grade|ssc|hsc|equivalent", block, re.I):
            score += 30
        if re.search(r"ভর্তির যোগ্যতা|যোগ্যতা|সমমান|জিপিএ|এসএসসি|এইচএসসি", block, re.I):
            score += 30
        if len(block) > 500:
            score += 10

        candidates.append((score, block))

    # De-duplicate overlapping sentence windows.
    unique = {}
    for score, block in candidates:
        key = re.sub(r"\W+", " ", block.lower()).strip()
        if key not in unique or score > unique[key][0]:
            unique[key] = (score, block)

    return list(unique.values())

def choose_requirement(row, texts):
    current = normalize_requirement_text(row.get("requirements", ""))
    keywords = row_keywords(row)
    candidates = []

    for text, source_url in texts:
        source_domain = urlparse(source_url).netloc.lower().removeprefix("www.")
        official_domain = urlparse(row.get("officialUrl", "")).netloc.lower().removeprefix("www.")
        allowed_domains = {official_domain}
        if official_domain == "dgme.teletalk.com.bd":
            allowed_domains.add("dgme.gov.bd")
        if official_domain.endswith(".mist.ac.bd"):
            allowed_domains.add("mist.ac.bd")
        if official_domain == "www.iub.edu.bd":
            allowed_domains.add("admission.iub.edu.bd")
        if official_domain == "gstadmission.ac.bd":
            allowed_domains.update({"admission.just.edu.bd", "www.nstu.edu.bd"})
        if official_domain and source_domain and source_domain not in allowed_domains:
            continue

        for score, block in requirement_candidates(text):
            low = block.lower()
            if keywords:
                matched = sum(1 for word in keywords if word in low)
                score += min(60, matched * 15)

            # Prefer an explicit requirements/eligibility section over a
            # random sentence that merely mentions "eligible".
            if re.search(r"eligibility criteria|admission requirements|minimum qualifications", low, re.I):
                score += 45

            candidates.append((score, block, source_url))

    if not candidates:
        return None

    # Compare candidates after whitespace/punctuation normalization.
    candidates.sort(key=lambda x: (-x[0], -len(x[1])))
    best = candidates[0]

    # Never replace an existing detailed requirement with a much shorter
    # fragment produced by a weak extraction.
    if current and len(best[1]) < max(80, int(len(current) * 0.45)):
        return None

    # If two different high-scoring requirement blocks conflict, leave the
    # record unchanged rather than guessing which unit/program they describe.
    if len(candidates) > 1:
        second = candidates[1]
        n1 = normalize_requirement_text(best[1]).lower()
        n2 = normalize_requirement_text(second[1]).lower()
        if n1 != n2 and best[0] - second[0] < 25:
            return None

    if current and requirement_hash(current) == requirement_hash(best[1]):
        return None

    return best[1], best[2]

def extract_group_requirement_candidates(text):
    out = {}
    for score, block in requirement_candidates(text):
        for group, rx in GROUP_TERMS.items():
            if rx.search(block):
                out.setdefault(group, []).append((score, block))
    return out

def choose_group_requirements(row, texts):
    groups = row.get("requirementsByGroup")
    if not isinstance(groups, dict):
        return {}

    found = {}
    for text, source_url in texts:
        source_domain = urlparse(source_url).netloc.lower().removeprefix("www.")
        official_domain = urlparse(row.get("officialUrl", "")).netloc.lower().removeprefix("www.")
        allowed_domains = {official_domain}
        if official_domain == "dgme.teletalk.com.bd":
            allowed_domains.add("dgme.gov.bd")
        if official_domain.endswith(".mist.ac.bd"):
            allowed_domains.add("mist.ac.bd")
        if official_domain == "www.iub.edu.bd":
            allowed_domains.add("admission.iub.edu.bd")
        if official_domain == "gstadmission.ac.bd":
            allowed_domains.update({"admission.just.edu.bd", "www.nstu.edu.bd"})
        if official_domain and source_domain and source_domain not in allowed_domains:
            continue

        for group, items in extract_group_requirement_candidates(text).items():
            for score, block in items:
                score += 30
                if group in ("science", "business", "humanities"):
                    score += 10
                found.setdefault(group, []).append((score, block, source_url))

    updates = {}
    for group, old in groups.items():
        if group not in found:
            continue
        candidates = sorted(found[group], key=lambda x: (-x[0], -len(x[1])))
        best = candidates[0]

        # Only auto-update a group when the official source clearly contains
        # that group's eligibility language. Avoid replacing a verified group
        # rule with a generic "eligible" sentence.
        if not re.search(
            r"eligib|eligibility|minimum gpa|minimum grade|qualification|"
            r"যোগ্যতা|জিপিএ|সমমান|এসএসসি|এইচএসসি",
            best[1],
            re.I,
        ):
            continue

        if len(best[1]) < 60:
            continue

        old_text = normalize_requirement_text((old or {}).get("text", ""))
        if old_text in GENERIC_REQUIREMENT_TEXTS:
            changed = True
        else:
            changed = requirement_hash(old_text) != requirement_hash(best[1])

        if changed:
            updates[group] = {
                "eligible": old.get("eligible") if isinstance(old, dict) else None,
                "text": best[1],
            }

    return updates

def choose_exam_date(row, texts):
    today = datetime.now(ZoneInfo("Asia/Dhaka")).date()
    candidates = []
    current = row.get("examDate")
    keywords = row_keywords(row)

    for text, source_url in texts:
        source_domain = urlparse(source_url).netloc.lower().removeprefix("www.")
        official_domain = urlparse(row.get("officialUrl", "")).netloc.lower().removeprefix("www.")
        allowed_domains = {official_domain}
        if official_domain == "dgme.teletalk.com.bd":
            allowed_domains.add("dgme.gov.bd")
        if official_domain.endswith(".mist.ac.bd"):
            allowed_domains.add("mist.ac.bd")
        if official_domain == "www.iub.edu.bd":
            allowed_domains.add("admission.iub.edu.bd")
        if official_domain == "gstadmission.ac.bd":
            allowed_domains.update({"admission.just.edu.bd", "www.nstu.edu.bd"})
        if official_domain and source_domain and source_domain not in allowed_domains:
            continue

        for date_value, strength, ctx in extract_dates(text):
            try:
                candidate_date = datetime.strptime(date_value, "%Y-%m-%d").date()
            except ValueError:
                continue

            # Never auto-publish a date outside the current admission cycle
            # or a date that has already passed when the checker is running.
            if candidate_date < today or candidate_date < CYCLE_START or candidate_date > CYCLE_END:
                continue

            # Automatic replacement requires explicit admission-test context.
            if strength < 3:
                continue

            ctx_low = ctx.lower()
            score = 300
            if current and date_value == current:
                score += 40
            if keywords:
                matched = sum(1 for word in keywords if word in ctx_low)
                score += min(60, matched * 15)

            # Deadline/application dates are common false positives. Penalize
            # heavily unless the same context explicitly names an exam/test.
            if ("application deadline" in ctx_low or "application closes" in ctx_low
                    or "last date to apply" in ctx_low) and not EXAM_RE.search(ctx):
                score -= 250

            # Prefer dates near the existing cycle year, but do not let the
            # old value override a clearly published changed date.
            if current and re.match(r"^\d{4}-", str(current)):
                if date_value[:4] == str(current)[:4]:
                    score += 10

            candidates.append((score, date_value, source_url, ctx))

    if not candidates:
        return None

    candidates.sort(key=lambda x: (-x[0], x[1]))
    best = candidates[0]

    # Require a strong margin when several different exam dates are found.
    if len(candidates) > 1 and candidates[0][0] == candidates[1][0] and candidates[0][1] != candidates[1][1]:
        return None

    return best[1], best[2], best[3]

NOTICE_FEED_URL = "https://students.bd/en/notice"
NOTICE_TARGETS = {
    # Dhaka universities in the tracker.
    "dhaka university": "Dhaka University",
    "university of dhaka": "Dhaka University",
    "jagannath university": "Jagannath University",
    "jnu": "Jagannath University",
    "jahangirnagar university": "Jahangirnagar University",
    "bup": "Bangladesh University of Professionals",
    "bangladesh university of professionals": "Bangladesh University of Professionals",
    "aiub": "AIUB",
    "american international university": "AIUB",
    "brac university": "BRAC University",
    "north south university": "North South University",
    "nsu": "North South University",
    "east west university": "East West University",
    "united international university": "United International University",
    "ulab": "ULAB",
    "green university": "Green University of Bangladesh",
    "iub": "Independent University, Bangladesh",

    # Engineering / technology universities in the tracker.
    "buet": "BUET",
    "ruet": "RUET",
    "cuet": "CUET",
    "kuet": "KUET",
    "mist": "MIST",
    "iut": "IUT",
    "duet": "DUET",
    "butex": "BUTEX",

    # Medical admission sources in the tracker.
    "dgme": "Medical Admission",
    "medical admission": "Medical Admission",
    "mbbs": "Medical Admission",
    "bds": "Medical Admission",
    "bangladesh medical university": "Bangladesh Medical University",
    "bmu": "Bangladesh Medical University",

    # Divisional / regional public universities in the tracker.
    "rajshahi university": "Rajshahi University",
    "university of rajshahi": "Rajshahi University",
    "chittagong university": "Chittagong University",
    "university of chittagong": "Chittagong University",
    "khulna university": "Khulna University",
    "barishal university": "University of Barishal",
    "barisal university": "University of Barishal",
    "begum rokeya university": "Begum Rokeya University",
    "comilla university": "Comilla University",
    "cumilla university": "Comilla University",
    "shahjalal university": "SUST",
    "sust": "SUST",
    "jkkniu": "Jatiya Kabi Kazi Nazrul Islam University",
    "hajee mohammad danesh": "HSTU",
    "hstu": "HSTU",
    "patuakhali science": "Patuakhali Science and Technology University",
    "pstu": "PSTU",
    "mawlana bhashani": "MBSTU",
    "mbstu": "MBSTU",
}

def notice_university(title):
    low = normalize(title).lower()
    for key, label in sorted(NOTICE_TARGETS.items(), key=lambda x: -len(x[0])):
        if key in low:
            return label
    return None

def update_notice_feed():
    try:
        r = request_source(NOTICE_FEED_URL)
        soup = BeautifulSoup(r.text, "html.parser")
        items = []
        seen = set()

        for a in soup.find_all("a", href=True):
            href = urljoin(r.url, a["href"])
            if "/notice/" not in href:
                continue
            title = a.get_text(" ", strip=True)
            if not title or len(title) < 8:
                continue

            university = notice_university(title)
            if not university:
                continue

            # Ignore navigation/category links and duplicate detail links.
            key = (href, title)
            if key in seen:
                continue
            seen.add(key)

            parent_text = a.parent.get_text(" ", strip=True) if a.parent else title
            date_match = re.search(r"20(?:26|27)[-/](?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])", parent_text)
            date_value = date_match.group(0) if date_match else ""
            if not date_value:
                date_match = re.search(r"20(?:26|27)[-/](?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12]\d|3[01])", soup.get_text(" ", strip=True))
                date_value = date_match.group(0) if date_match else ""

            items.append({
                "university": university,
                "title": title,
                "date": date_value,
                "url": href,
                "source": "students.bd",
            })

            if len(items) >= 20:
                break

        # Newest first where a date was captured; preserve source order otherwise.
        items.sort(key=lambda x: x.get("date", ""), reverse=True)
        Path("notices.js").write_text(
            "window.ADMISSION_NOTICES = "
            + json.dumps(items[:12], ensure_ascii=False, indent=2)
            + ";\n",
            encoding="utf-8",
        )
        print(f"Notice feed: {len(items[:12])} matching notices saved.")
        return len(items[:12])
    except Exception as exc:
        print(f"Notice feed failed: {exc}")
        return 0


def main():
    rows = load_data()
    changed = []
    requirement_changed = []
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

            # -------------------------
            # Admission-test date check
            # -------------------------
            result = choose_exam_date(row, texts)
            if result:
                new_date, source_url, ctx = result
                old_date = row.get("examDate")
                if new_date != old_date:
                    row["previousExamDate"] = old_date
                    row["examDate"] = new_date
                    row["dateChanged"] = True
                    row["status"] = "Automatically updated from official source"
                    row["notes"] = (
                        f"Auto-detected admission-test date from official source: {source_url}"
                    )
                    changed.append((row["universityShortName"], old_date, new_date, source_url))

            # -------------------------
            # Requirements check
            # -------------------------
            req_result = choose_requirement(row, texts)
            if req_result:
                new_req, req_source = req_result
                old_req = row.get("requirements")
                row["previousRequirements"] = old_req
                row["requirements"] = new_req
                row["requirementsChanged"] = True
                row["requirementsLastChecked"] = datetime.now(
                    ZoneInfo("Asia/Dhaka")
                ).isoformat(timespec="seconds")
                row["requirementsSource"] = req_source
                requirement_changed.append(
                    (row["universityShortName"], "general", req_source)
                )

            # Group-wise eligibility is updated only when the source explicitly
            # names the applicant group and gives requirement/eligibility text.
            group_updates = choose_group_requirements(row, texts)
            if group_updates:
                for group, value in group_updates.items():
                    old = row["requirementsByGroup"].get(group, {})
                    value["previousText"] = old.get("text") if isinstance(old, dict) else None
                    row["requirementsByGroup"][group] = value
                    row["requirementsChanged"] = True
                    row["requirementsLastChecked"] = datetime.now(
                        ZoneInfo("Asia/Dhaka")
                    ).isoformat(timespec="seconds")
                    row["requirementsSource"] = req_result[1] if req_result else url
                    requirement_changed.append(
                        (row["universityShortName"], group, row["requirementsSource"])
                    )

        except Exception as exc:
            failures.append((row.get("universityShortName"), url, str(exc)))

    if changed or requirement_changed:
        save_data(rows)

    # Notice Board is a separate generated feed. A failure here never blocks
    # admission-date/requirement checking or modifies data.js.
    update_notice_feed()

    print(f"Checked {len(rows)} admission records from {len(source_cache)} unique official sources.")
    print(
        "Safety mode: only future 2026-27-cycle dates with explicit admission-test "
        "context are eligible for automatic date updates."
    )
    print(
        "Requirement mode: only explicit official eligibility/qualification text "
        "is eligible for automatic requirement updates; ambiguous or weak matches are skipped."
    )
    print(f"Date changes: {len(changed)}")
    for item in changed:
        print("DATE UPDATE:", item)

    print(f"Requirement changes: {len(requirement_changed)}")
    for item in requirement_changed:
        print("REQUIREMENT UPDATE:", item)

    if failures:
        print(f"Source failures: {len(failures)}")
        for item in failures:
            print("FAIL:", item)


if __name__ == "__main__":
    main()
