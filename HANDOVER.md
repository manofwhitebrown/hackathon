# Handover

Last updated: Sept 22, 2026 (Builder Day prep, ahead of Sept 26 submission)

## Where things stand
- Core product works end-to-end: upload → Gemini analysis → summary/glossary/risk
  flags/questions, in English, Hindi, Telugu, Tamil, or Spanish.
- Accepts image, PDF, DOCX, and TXT input.
- Deployed and live at https://hackathon-eight-lilac.vercel.app
- Privacy/Terms page live at /privacy.html
- Rate limiting and server-side file-size validation in place in api/analyze.js
- Theme (light/dark) persists across index.html, pitch.html, and privacy.html

## Tested so far
- Medical bill, Spanish-language insurance denial letter, dense legal lease (PDF)
- Credit card agreement (DOCX)
- Garbled/OCR-style receipt and a minimal short document (TXT), for edge cases
- Spanish-language output confirmed working end to end

## Not yet verified
- Hindi and Telugu output quality/rendering (same code path as Spanish, untested live)
- Behavior under a genuinely slow/flaky connection
- Full mobile layout pass across the three HTML pages

## Known, deliberate scope cuts (not bugs)
- No source-level citations (page/line pointing) — needs a real OCR-position pipeline
  first; a wrong citation is worse than none.
- No select-and-explain / follow-up Q&A on a specific sentence — scoped out for
  post-hackathon, not half-built under deadline pressure.

## Watch out for
- Rate limiter in api/analyze.js is in-memory per instance — a best-effort guard,
  not a real distributed limiter. Fine for hackathon scale, not for production.
- Gemini's free tier permits model training on submitted content — disclosed on
  the privacy page, but worth remembering if demoing with a real personal document.
