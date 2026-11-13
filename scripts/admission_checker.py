#!/usr/bin/env python3
"""
Admission Date Tracker — conservative official-source checker.

Rules:
- Reads only officialUrl values already present in data.js.
- Never invents dates.
- Updates only dates that are explicitly found near admission/application keywords.
- Leaves a record unchanged when the source is unavailable, ambiguous, or no matching date is found.
- Commits are handled by GitHub Actions only when data.js actually changes.
"""
import json, re, sys, time
from datetime import datetime
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

DATA = Path("data.js")
UA = "Admission-Date-Tracker official-source-checker/1.0"
DATE_RE = re.compile(r"\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b|\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2})\b|\b(\d{1,2})\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(20\d{2})\b", re.I)
MONTHS={m.lower():i for i,m in enumerate(["January","February","March","April","May","June","July","August","September","October","November","December"],1)}
for k,v in list(MONTHS.items()):
    MONTHS[k[:3]]=v

def normalize_date(m):
    try:
        g=m.groups()
        if g[0]:
            y,mo,d=int(g[0]),int(g[1]),int(g[2])
        elif g[3]:
            d,mo,y=int(g[3]),int(g[4]),int(g[5])
        else:
            d,mo,y=int(g[6]),MONTHS[g[7].lower()],int(g[8])
        dt=datetime(y,mo,d)
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return None

def extract_text(html):
    soup=BeautifulSoup(html,"html.parser")
    for x in soup(["script","style","noscript","svg"]):
        x.decompose()
    return re.sub(r"\s+"," ",soup.get_text(" ",strip=True))

def candidates(text, kind):
    if kind=="exam":
        keys=r"(admission\s*(test|exam|examination)|entrance\s*(test|exam)|written\s*(test|exam)|test\s*date|exam\s*date)"
    else:
        keys=r"(application\s*(deadline|last\s*date|closing\s*date)|last\s*date\s*(of|for)?\s*application|apply\s*(by|before)|application\s*ends?)"
    out=[]
    for km in re.finditer(keys,text,re.I):
        a=max(0,km.start()-260); b=min(len(text),km.end()+260)
        chunk=text[a:b]
        for dm in DATE_RE.finditer(chunk):
            d=normalize_date(dm)
            if d:
                # Only accept dates that are plausible admission-cycle dates.
                y=int(d[:4])
                if 2025 <= y <= 2030:
                    out.append((d,chunk))
    return out

def best(cands):
    # Require a unique date in the strongest keyword window.
    dates=[]
    for d,ch in cands:
        if d not in dates: dates.append(d)
    if len(dates)==1:
        return dates[0]
    # If several dates exist, do not guess.
    return None

def main():
    raw=DATA.read_text(encoding="utf-8")
    m=re.search(r"window\.ADMISSION_EXAMS\s*=\s*(\[.*?\])\s*;?\s*$",raw,re.S)
    if not m:
        raise SystemExit("Could not parse data.js")
    records=json.loads(m.group(1))
    session=requests.Session()
    session.headers.update({"User-Agent":UA,"Accept":"text/html,application/xhtml+xml,application/pdf;q=0.9,*/*;q=0.8"})
    changed=[]
    cache={}
    for rec in records:
        url=rec.get("officialUrl")
        if not url:
            continue
        if url not in cache:
            try:
                r=session.get(url,timeout=25,allow_redirects=True)
                r.raise_for_status()
                ctype=r.headers.get("content-type","").lower()
                if "pdf" in ctype or url.lower().endswith(".pdf"):
                    cache[url]=""
                else:
                    cache[url]=extract_text(r.text)
            except Exception as e:
                print(f"[skip] {rec.get('universityShortName')} source unavailable: {e}")
                cache[url]=None
        text=cache[url]
        if not text:
            continue

        old=rec.get("examDate")
        new=best(candidates(text,"exam"))
        if new and new != old:
            rec["previousExamDate"]=old
            rec["examDate"]=new
            rec["dateChanged"]=bool(old and old!=new)
            rec["status"]="Automatically verified from official source"
            rec["notes"]=f"Automatically verified from the official admission source: {url}"
            changed.append((rec.get("id"),"examDate",old,new))

        old_dead=rec.get("applicationDeadline")
        new_dead=best(candidates(text,"deadline"))
        if new_dead and new_dead != old_dead:
            rec["applicationDeadline"]=new_dead
            rec["status"]="Automatically verified from official source"
            rec["notes"]=f"Automatically verified from the official admission source: {url}"
            changed.append((rec.get("id"),"applicationDeadline",old_dead,new_dead))

    if changed:
        new_raw="window.ADMISSION_EXAMS = "+json.dumps(records,ensure_ascii=False,indent=2)+";\n"
        DATA.write_text(new_raw,encoding="utf-8")
        for row in changed:
            print("[change]",row)
    else:
        print("[no-change] No unambiguous new/changed dates were verified.")

if __name__=="__main__":
    main()
