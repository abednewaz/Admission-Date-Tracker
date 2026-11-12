# Admission Date Tracker

A mobile-first Progressive Web App for tracking Bangladesh undergraduate admission dates for the HSC Batch 2026 (2026–27 admission cycle).

Live site: https://admission-date-tracker.vercel.app/

## What it does

- Tracks admission exams across major Bangladeshi universities and centralized admission systems.
- Shows exam dates, times, locations, countdowns, admission type, and important notes.
- Supports search, Upcoming / All / Finished views, and marked universities.
- Provides a requirements view for different applicant groups.
- Supports PWA installation and browser notifications while the tracker is open.
- Uses a light/dark theme toggle with local persistence.
- Displays "Not published yet" when an official detail is not available.
- Uses "Better check Yourself" only where a field is uncertain or has not been independently verified.

## Project structure

~~~text
.
├── index.html                         # Main UI, styling, and client-side application logic
├── data.js                            # Admission records consumed by the app
├── manifest.webmanifest               # PWA manifest
├── sw.js                              # Service worker, caching, and notifications
├── vercel.json                        # Cache-control headers for fresh deployments
├── icon.svg                           # App/header icon
├── icon-192.png                       # PWA / favicon icon
├── icon-512.png                       # PWA icon
├── favicon.ico                        # Browser favicon
├── Abed_Newaz_Profile.png             # Developer profile image
├── googlef8f94ad3718480f.html         # Google Search Console verification
└── .github/
    ├── workflows/
    │   └── admission-date-check.yml   # Hourly admission-date checker
    └── scripts/
        └── check_admission_dates.py   # Source fetching, parsing, and safety checks
~~~

## Data model

Admission records live in data.js as:

~~~js
window.ADMISSION_EXAMS = [ ... ];
~~~

Each record can contain fields such as:

- id
- universityName
- universityShortName
- unit
- examDate
- examTime
- examLocation
- admissionType
- officialUrl
- requirementsByGroup
- notes

data.js is intentionally kept human-readable because it is both application data and the primary source file maintained by the automation.

## Automatic date checking

GitHub Actions checks the tracked official sources hourly at minute 17 (Asia/Dhaka).

The checker is deliberately conservative:

1. It reads the existing data.js.
2. It fetches the configured official admission source.
3. It can follow relevant official notice/PDF links.
4. It extracts candidate dates from the source.
5. It only considers future dates inside the configured 2026–27 cycle.
6. It requires explicit admission-test context before changing an exam date.
7. It keeps the existing date when a source is unavailable or ambiguous.
8. It commits data.js only when a verified automatic change is detected.

This means a temporary 403, SSL problem, timeout, or ambiguous page should not erase an already published date.

## Source handling

Some university sites use restrictive servers, certificate configurations, or centralized admission portals. The checker therefore has limited, source-specific fallback URLs where appropriate.

Fallbacks are still restricted to known official domains. The checker does not use arbitrary third-party admission sites to overwrite dates automatically.

## Local development

No build step is required. The app is a static site.

You can run it with any static HTTP server, for example:

~~~bash
python -m http.server 8000
~~~

Then open:

~~~text
http://localhost:8000/
~~~

Opening index.html directly with file:// is not recommended because service workers and some browser APIs require a secure or local HTTP context.

## Deployment

The production deployment is on Vercel and is connected to the main branch.

Normal flow:

~~~text
GitHub → Vercel → Production
~~~

When the admission-date workflow detects a real change, it commits the updated data.js to main, which triggers a normal Vercel deployment.

## Important maintenance rules

- Do not manually invent an admission date.
- Prefer the university's official admission portal or official notice.
- Keep uncertain fields as Not published yet or Better check Yourself according to the app's field rules.
- Do not remove an existing date merely because an official source temporarily fails.
- Keep data.js formatted and readable.
- Test changes before altering the automatic checker.
- Create a backup branch before risky changes to the checker or deployment configuration.

## Technology

- HTML
- CSS
- Vanilla JavaScript
- Service Worker / PWA APIs
- Python
- Requests
- BeautifulSoup
- PyMuPDF
- pypdf
- Tesseract OCR
- GitHub Actions
- Vercel

## Maintainer

**Abed Newaz**

For recommendations or feedback: the.abednewaz@gmail.com
