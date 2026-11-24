# MelonFork

A grade viewer and calculator for MCPS students that follows the 2026-27 MCPS grading rules. It's a fresh rewrite inspired by [Grade Melon](https://github.com/tinuh/grade-melon), with no code, ads or tracking taken from it.

**Use it:** https://potjim80.github.io/MelonFork/

## What it does

- **Gradebook**: every marking period, with category weights. Each grade is MelonFork's own calculation by the MCPS rules. StudentVUE's marking-period page can leave out work that only shows on its interim page, so MelonFork reads both and counts every assignment.
- **What-ifs**: change any score, leave assignments out, add made-up ones, then undo.
- **Grade optimizer**: the score you need on the next assignment to reach a letter for the marking period *or* for the semester.
- **Semester grades, done the MCPS way**: since 2025-26 the semester grade is the average of the two marking-period percentages, each rounded to a whole number first, then rounded half up. Grade Melon still showed the old letter-chart results. Courses with a Maryland end-of-course exam use 40/40/20.
- **"What do I need in MP2?"**: for each semester letter.
- **GPA**: unweighted and weighted. Honors, AP, IB and Montgomery College dual-credit courses get +1 for A, B and C. It shows semester, year and cumulative GPA (enter the GPA from before this year).
- **Also**: schedule, attendance, and documents (report cards).
- **Other**: sample data, entering grades by hand, pasting scores, backup and restore, and dark mode.

All grades stay in your browser's local storage.

## The rules it follows

The sources are listed on the in-app **How grades are calculated** page: MCPS Regulation IKA-RA (revised Oct 9, 2026), IKC-RA, the 2026-27 High School Course Bulletin, and the MCPS grading FAQ. The rules themselves are in [`js/policy.js`](js/policy.js), and `node test/run.mjs` checks them against MCPS's own worked examples.

## How it connects to StudentVUE

It makes the same mobile-API calls Grade Melon makes (`AttemptLogin`, `Gradebook`, `StudentClassList`, `GetStudentAttendanceList`, `GetStudentDocuments`).

Browsers can't call StudentVUE directly, so the requests go through [`relay/worker.js`](relay/worker.js). That's a small Cloudflare Worker you run yourself. It forwards only those calls, only to MCPS, only from this site, and logs nothing.

Grade Melon routes everyone's password through its own server instead.

### Set up your own relay (optional; this site already has one)

1. Make a free Cloudflare account at https://dash.cloudflare.com/sign-up.
2. Deploy the relay:
   ```
   cd relay
   npx wrangler login
   npx wrangler deploy
   ```
3. Copy the `https://melonfork-relay.<you>.workers.dev` address it prints into MelonFork → **Settings → Relay address**.

## Run locally

```
python3 -m http.server 8000
# open http://localhost:8000
node test/run.mjs
```

No build step and no dependencies.

Not affiliated with MCPS, Edupoint or Synergy. StudentVUE is a trademark of Edupoint.
