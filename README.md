# Plain Terms — deploy guide (beginner-friendly)

This is your MVP, fixed. Follow these steps in order. Don't skip any.

## Step 1 — Get a free Gemini API key
1. Go to https://aistudio.google.com/apikey
2. Sign in with a Google account
3. Click "Create API key"
4. Copy the key somewhere safe — you'll paste it in Step 4

## Step 2 — Put this project on GitHub
1. Go to https://github.com/new and create a new (empty) repository, e.g. `plain-terms`
2. On your computer, in this folder, run:
   ```
   git init
   git add .
   git commit -m "first version"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/plain-terms.git
   git push -u origin main
   ```
   (Replace YOUR-USERNAME with your actual GitHub username.)

## Step 3 — Deploy on Vercel
1. Go to https://vercel.com and sign in with GitHub
2. Click "Add New" → "Project"
3. Select your `plain-terms` repo → click "Import"
4. Leave all settings as default → click "Deploy"
5. It will fail the first time (or run but give AI errors) because it doesn't have your key yet — that's expected, go to Step 4

## Step 4 — Add your API key (the step people forget)
1. In your Vercel project, go to **Settings → Environment Variables**
2. Add a new one:
   - Name: `GEMINI_API_KEY`
   - Value: (paste the key from Step 1)
3. Click Save
4. Go to the **Deployments** tab → click the "..." on the latest deployment → **Redeploy**
   (Adding a key does NOT apply automatically — you must redeploy after adding it.)

## Step 5 — Test it
1. Open your live URL (Vercel gives you one like `plain-terms-yourname.vercel.app`)
2. Upload a real (or sample) medical result, bill, or contract — photo or PDF, under 4MB
3. Click "Decode this document"
4. You should see: a summary, a glossary, risk flags, and questions to ask

## If it still fails
Open your browser's DevTools (F12 or right-click → Inspect) → Console tab, and read the exact error.
- "Server is missing GEMINI_API_KEY" → you skipped Step 4, or forgot to redeploy after adding it
- A Google/Gemini error message → check the key was copied correctly, and that the model name in `api/analyze.js` (`gemini-2.5-flash`) is still valid — Google renames these sometimes, check https://ai.google.dev/gemini-api/docs/models
- "Could not reach the AI service" → you opened index.html directly as a file instead of visiting the live Vercel URL
- File too large → compress the image or use a shorter PDF (current limit: 4MB)

## What's next (nice-to-haves, not required for submission)
- OCR fallback (Mistral OCR) for very messy scans, if Gemini alone struggles to read them
- A disclaimer on the results screen (already added in the footer) — keep it, judges like this
- Rate-limit the endpoint so one person can't burn your free credits in a loop
