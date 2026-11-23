import io
import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse, urlunparse

import requests
from bs4 import BeautifulSoup

DATA_FILE = Path("data.js")
STATE_FILE = Path("notice-state.json")
NOTICES_FILE = Path("notices.js")
TIMEOUT = 25
MAX_DISCOVERY_PAGES = 10
MAX_ITEMS_PER_SOURCE = 12
HEADERS = {
    "User-Agent": "Admission-Tracker-Public-Notice-Monitor/2.0 (+https://www.admissiontracker.site/)",
    "Accept-Language": "en-US,en;q=0.9,bn;q=0.8",
}
NOTICE_WORDS = re.compile(
    r"notice|notices|circular|admission|undergraduate|prospectus|guideline|"
    r"advertisement|announcement|important|ভর্তি|বিজ্ঞপ্তি|নোটিশ|নির্দেশিকা|"
    r"প্রজ্ঞাপন|সার্কুলার|ভর্তি পরীক্ষা|প্রবেশপত্র|পরীক্ষার তারিখ",
    re.I,
)
DATE_RE = re.compile(
    r"(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](2026|2027)(?!\d)|"
    r"(?<!\d)(2026|2027)[./-](\d{1,2})[./-](\d{1,2})(?!\d)|"
    r"\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December|"
    r"জানুয়ারি|জানুয়ারি|ফেব্রুয়ারি|ফেব্রুয়ারি|মার্চ|এপ্রিল|মে|জুন|জুলাই|আগস্ট|সেপ্টেম্বর|অক্টোবর|নভেম্বর|ডিসেম্বর)\s*,?\s*(2026|2027)\b",
    re.I,
)
MONTHS = {
    "january":1,"february":2,"march":3,"april":4,"may":5,"june":6,"july":7,
    "august":8,"september":9,"october":10,"november":11,"december":12,
    "জানুয়ারি":1,"জানুয়ারি":1,"ফেব্রুয়ারি":2,"ফেব্রুয়ারি":2,"মার্চ":3,"এপ্রিল":4,
    "মে":5,"জুন":6,"জুলাই":7,"আগস্ট":8,"সেপ্টেম্বর":9,"অক্টোবর":10,"নভেম্বর":11,"ডিসেম্বর":12,
}

session = requests.Session()
session.headers.update(HEADERS)

def normalize(s):
    return re.sub(r"\s+", " ", str(s or "").replace("\u200c", " ").replace("\u200d", " ")).strip()

def load_rows():
    text = DATA_FILE.read_text(encoding="utf-8")
    m = re.search(r"window\.ADMISSION_EXAMS\s*=\s*(\[.*\]);?\s*$", text, re.S)
    if not m:
        raise RuntimeError("Cannot parse data.js")
    return json.loads(m.group(1))

def parse_date(text):
    for m in DATE_RE.finditer(normalize(text)):
        g = m.groups()
        try:
            if g[0]:
                y, mo, d = int(g[3]), int(g[2]), int(g[1])
                return f"{y:04d}-{mo:02d}-{d:02d}"
            if g[3]:
                y, mo, d = int(g[3]), int(g[4]), int(g[5])
                return f"{y:04d}-{mo:02d}-{d:02d}"
            if g[6]:
                return f"{int(g[8]):04d}-{MONTHS[g[7].lower()]:02d}-{int(g[6]):02d}"
        except (ValueError, KeyError, TypeError):
            pass
    return ""

def clean_url(url):
    p = urlparse(url)
    path = re.sub(r"/+", "/", p.path or "/")
    return urlunparse((p.scheme.lower(), p.netloc.lower(), path.rstrip("/") or "/", "", p.query, ""))

def origin(url):
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"

def fetch(url):
    last = None
    for verify in (True, False):
        try:
            r = session.get(url, timeout=TIMEOUT, allow_redirects=True, verify=verify)
            r.raise_for_status()
            if not r.encoding or r.encoding.lower() in ("iso-8859-1", "latin-1"):
                try:
                    r.encoding = r.apparent_encoding
                except Exception:
                    pass
            return r
        except requests.RequestException as exc:
            last = exc
    raise last or RuntimeError("request failed")

def parse_pdf(content):
    try:
        from pypdf import PdfReader
        reader = PdfReader(io.BytesIO(content))
        return "\n".join((p.extract_text() or "") for p in reader.pages[:8])
    except Exception:
        return ""

def is_pdf(url, response=None):
    ctype = (response.headers.get("content-type", "") if response else "").lower()
    return "pdf" in ctype or urlparse(url).path.lower().endswith(".pdf")

def extract_pdf_item(url, response, university):
    text = parse_pdf(response.content)
    if not text.strip():
        return None
    lines = [normalize(x) for x in text.splitlines() if normalize(x)]
    title = next((x for x in lines[:25] if len(x) >= 12 and NOTICE_WORDS.search(x)), "")
    if not title:
        title = next((x for x in lines[:12] if len(x) >= 12), f"{university} admission notice")
    date = parse_date("\n".join(lines[:80]))
    if not date:
        lm = response.headers.get("Last-Modified", "")
        date = parse_date(lm)
    return {
        "university": university,
        "title": title[:300],
        "date": date,
        "url": clean_url(url),
        "source": f"{university} official source",
        "summary": normalize(" ".join(lines[:35]))[:1200],
        "notify": True,
        "generatedBy": "official-notice-monitor",
    }

def robots_sitemaps(base):
    urls = []
    try:
        r = fetch(origin(base) + "/robots.txt")
        for line in r.text.splitlines():
            if line.lower().startswith("sitemap:"):
                urls.append(line.split(":", 1)[1].strip())
    except Exception:
        pass
    urls += [
        origin(base) + "/sitemap.xml",
        origin(base) + "/sitemap_index.xml",
        origin(base) + "/wp-sitemap.xml",
    ]
    return list(dict.fromkeys(clean_url(x) for x in urls if x))

def sitemap_urls(url, limit=120):
    found = []
    try:
        r = fetch(url)
        soup = BeautifulSoup(r.text, "xml")
        locs = [normalize(x.get_text()) for x in soup.find_all("loc")]
        for loc in locs[:limit]:
            if loc.lower().endswith((".xml", ".xml.gz")) or "sitemap" in loc.lower():
                found.extend(sitemap_urls(loc, max(20, limit // 3)))
            else:
                found.append(loc)
    except Exception:
        pass
    return list(dict.fromkeys(clean_url(x) for x in found if x))

def candidate_urls(seed):
    base = origin(seed)
    p = urlparse(seed)
    candidates = [seed, base]
    common = [
        "/notice","/notices","/notice-board","/news","/admission","/admission/notices",
        "/admission/notice","/admission/circular","/circular","/circulars",
        "/downloads","/download","/en/notice","/bn/notice","/en/notices","/bn/notices",
        "/student/notices","/student/notice","/index.php/student/notices",
    ]
    if "admission" in p.path.lower():
        common += [p.path, p.path.rstrip("/") + "/notices", p.path.rstrip("/") + "/notice"]
    for path in common:
        candidates.append(base + path)
    for sm in robots_sitemaps(seed):
        candidates.extend(sitemap_urls(sm, 100))
    filtered = []
    for u in dict.fromkeys(clean_url(x) for x in candidates):
        low = u.lower()
        if u == clean_url(seed) or NOTICE_WORDS.search(low):
            filtered.append(u)
    return filtered[:MAX_DISCOVERY_PAGES]

def extract_html_items(url, response, university):
    soup = BeautifulSoup(response.text, "html.parser")
    page_text = normalize(soup.get_text(" ", strip=True))
    page_date = parse_date(page_text)
    items = []
    seen = set()

    pdf_budget = 4
    for a in soup.find_all("a", href=True):
        href = clean_url(urljoin(response.url, a.get("href", "")))
        if urlparse(href).scheme not in ("http", "https"):
            continue
        label = normalize(a.get_text(" ", strip=True))
        blob = (label + " " + href).lower()
        if not (NOTICE_WORDS.search(blob) or ".pdf" in href.lower()):
            continue

        node = a
        context = []
        for _ in range(4):
            if not node:
                break
            context.append(normalize(node.get_text(" ", strip=True)))
            node = getattr(node, "parent", None)
        context_text = " ".join(x for x in context if x)
        title = label
        if len(title) < 8:
            for parent in context:
                if 8 <= len(parent) <= 500 and NOTICE_WORDS.search(parent):
                    title = parent
                    break
        date = parse_date(context_text) or page_date
        key = (href, title.lower())
        if key in seen:
            continue
        seen.add(key)

        if ".pdf" in href.lower() and pdf_budget > 0:
            try:
                pdf_budget -= 1
                pr = fetch(href)
                item = extract_pdf_item(href, pr, university)
                if item:
                    if date and not item["date"]:
                        item["date"] = date
                    items.append(item)
                    continue
            except Exception:
                pass

        if title and len(title) >= 8:
            items.append({
                "university": university,
                "title": title[:300],
                "date": date,
                "url": href,
                "source": f"{university} official source",
                "summary": context_text[:1200],
                "notify": True,
                "generatedBy": "official-notice-monitor",
            })

    return items, bool(NOTICE_WORDS.search(page_text))

def build_sources(rows):
    grouped = {}
    for row in rows:
        if "Public" not in str(row.get("admissionType", "")):
            continue
        url = row.get("officialUrl")
        if not url:
            continue
        key = origin(url).lower()
        entry = grouped.setdefault(key, {"university": row.get("universityName", "Public University"), "seed": url})
        name = str(row.get("universityName", ""))
        if name and len(name) < len(entry["university"]):
            entry["university"] = name
    # Prefer a clean institution label when unit names are repeated.
    aliases = {
        "du - iba unit":"University of Dhaka","du - science unit (a unit)":"University of Dhaka",
        "du - arts, law & social science (b unit)":"University of Dhaka","du - fine arts unit (f unit)":"University of Dhaka",
        "du - business studies unit (c unit)":"University of Dhaka","ru - b unit":"University of Rajshahi",
        "ru - c unit":"University of Rajshahi","ru - a unit":"University of Rajshahi",
        "cu - unit c":"University of Chittagong","cu - unit a":"University of Chittagong",
        "cu - sub-unit b1":"University of Chittagong","cu - sub-unit b2":"University of Chittagong",
        "cu - unit b":"University of Chittagong","cu - unit d":"University of Chittagong",
        "cu - sub-unit d1":"University of Chittagong",
    }
    for entry in grouped.values():
        entry["university"] = aliases.get(entry["university"].lower(), entry["university"])
    return list(grouped.values())

def load_state():
    if not STATE_FILE.exists():
        return {"knownUrls": [], "sourceHealth": {}}
    try:
        data = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        return {
            "knownUrls": list(data.get("knownUrls", [])),
            "sourceHealth": dict(data.get("sourceHealth", {})),
        }
    except Exception:
        return {"knownUrls": [], "sourceHealth": {}}

def load_notices():
    if not NOTICES_FILE.exists():
        return []
    text = NOTICES_FILE.read_text(encoding="utf-8")
    m = re.search(r"window\.ADMISSION_NOTICES\s*=\s*(\[.*\]);?\s*$", text, re.S)
    return json.loads(m.group(1)) if m else []

def notice_key(n):
    u = clean_url(n.get("url", "")) if n.get("url") else ""
    return ("url", u.lower()) if u else (
        "manual", str(n.get("university","")).lower(), str(n.get("title","")).lower(), str(n.get("date",""))
    )

def main():
    rows = load_rows()
    sources = build_sources(rows)
    state = load_state()
    existing = load_notices()
    existing_by_key = {notice_key(n): n for n in existing}
    all_items = []
    health = {}
    failures = []

    def check_source(source):
        name, seed = source["university"], source["seed"]
        key = origin(seed).lower()
        candidates = candidate_urls(seed)
        source_items = []
        fetched = 0
        notice_pages = 0
        errors = 0
        for url in candidates:
            try:
                r = fetch(url)
                fetched += 1
                if is_pdf(url, r):
                    item = extract_pdf_item(url, r, name)
                    if item:
                        source_items.append(item)
                    continue
                items, has_notice_text = extract_html_items(url, r, name)
                notice_pages += int(has_notice_text)
                source_items.extend(items)
            except Exception:
                errors += 1

        unique = {}
        for item in source_items:
            k = notice_key(item)
            old = unique.get(k)
            if not old or (item.get("date","") > old.get("date","")):
                unique[k] = item
        source_items = list(unique.values())
        source_items.sort(key=lambda x: (x.get("date",""), x.get("title","")), reverse=True)
        healthy = fetched > 0 and (notice_pages > 0 or bool(source_items))
        return key, {
            "university": name,
            "seed": seed,
            "checkedAt": datetime.utcnow().isoformat(timespec="seconds") + "Z",
            "candidatePages": len(candidates),
            "pagesFetched": fetched,
            "noticePagesFound": notice_pages,
            "noticesExtracted": len(source_items),
            "requestErrors": errors,
            "healthy": healthy,
        }, source_items

    # Public universities are monitored concurrently so one slow/blocked
    # institution cannot starve the rest of the monitoring cycle.
    with ThreadPoolExecutor(max_workers=min(6, max(1, len(sources)))) as pool:
        futures = [pool.submit(check_source, source) for source in sources]
        for future in as_completed(futures):
            key, report, source_items = future.result()
            health[key] = report
            if not report["healthy"]:
                failures.append(f'{report["university"]} ({report["seed"]})')
            all_items.extend(source_items[:MAX_ITEMS_PER_SOURCE])

    if failures:
        print("PUBLIC SOURCE HEALTH FAILURE:")
        for item in failures:
            print(" -", item)
        raise SystemExit(2)

    # Never delete manual notices. Auto notices are keyed by canonical URL.
    manual = [n for n in existing if not n.get("url")]
    auto = {notice_key(n): n for n in existing if n.get("url")}
    for item in all_items:
        auto[notice_key(item)] = item
    merged = manual + sorted(auto.values(), key=lambda x: (x.get("date",""), x.get("university",""), x.get("title","")), reverse=True)
    merged = merged[:60]

    state["knownUrls"] = sorted(set(
        [str(x).rstrip("/").lower() for x in state.get("knownUrls", []) if x]
        + [clean_url(x.get("url","")).lower() for x in all_items if x.get("url")]
    ))
    state["sourceHealth"] = health
    STATE_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    NOTICES_FILE.write_text(
        "window.ADMISSION_NOTICES = " + json.dumps(merged, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    print(f"Public institutions monitored: {len(sources)}")
    print(f"Official notice candidates extracted: {len(all_items)}")
    print(f"Notice records saved: {len(merged)}")
    for key, value in health.items():
        print(f"SOURCE {value['university']}: fetched={value['pagesFetched']}/{value['candidatePages']} notices={value['noticesExtracted']} healthy={value['healthy']}")

if __name__ == "__main__":
    main()
