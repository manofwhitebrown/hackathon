// runs server-side on Vercel - the only place the Gemini key ever touches
import mammoth from 'mammoth';

// The fallback chain below can take longer than Vercel's default 10s limit
// if multiple models are busy - this gives it enough room to actually try.
export const config = {
  maxDuration: 30
};

// best-effort per-instance rate limit - not distributed (Vercel can run
// multiple cold-started instances), but stops a stuck retry loop from
// burning the whole Gemini quota. would move to Upstash/KV for real scale.
const requestLog = new Map(); // ip -> array of request timestamps (ms)
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 15; // per IP, per window

function isRateLimited(ip) {
  const now = Date.now();
  const timestamps = (requestLog.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  timestamps.push(now);
  requestLog.set(ip, timestamps);

  // Keep the map from growing forever across a long-lived instance.
  if (requestLog.size > 5000) {
    for (const [key, times] of requestLog) {
      if (times.every((t) => now - t > RATE_LIMIT_WINDOW_MS)) requestLog.delete(key);
    }
  }

  return timestamps.length > RATE_LIMIT_MAX_REQUESTS;
}

function getClientIp(req) {
  // Vercel puts the real client IP first in x-forwarded-for.
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

const BASE_PROMPT = `You are helping an ordinary person understand a confusing real-world document
(this could be a medical result, a legal contract, an insurance letter, or a bill).

The person you are writing for may have limited formal education and may not be familiar with
technical, legal, medical, or financial vocabulary. Write as if explaining it out loud to a
friend or family member with no background in the subject:
- Use short sentences.
- Use everyday, common words instead of technical or formal ones wherever possible.
- If a technical term truly cannot be avoided, explain it in the simplest possible way the moment you use it.
- Avoid long or compound sentences. One idea per sentence where possible.

EVIDENCE RULE (most important rule in this whole prompt): every claim you make must be traceable
to something actually written in the document. Wherever the schema below asks for "evidence",
you must give a short verbatim excerpt (a few words to one sentence, copied exactly as it appears
in the document - do not paraphrase it) that the claim is based on. If you cannot find a real excerpt
to support a claim, do not make that claim. Never invent dates, amounts, deadlines, fees, diagnoses,
rights, or obligations that are not actually in the document.

If the document contains a reference number useful for contacting the sender about it (a claim
number, account number, or case number), mention it plainly near the start of the summary.

Read the attached document and respond with:

1. documentType: a short label for what kind of document this is (e.g. "Medical result", "Insurance letter", "Legal contract", "Bill").

2. summary: 3-5 plain, simple sentences explaining what this document actually says.

3. glossary: the confusing or technical terms that actually appear in THIS document - never a generic dictionary of terms that don't appear here. For each: term, definition (one simple sentence), moreDetail (2-3 sentences going a bit deeper), and evidence (the exact short phrase or sentence from the document where this term appears). Only include terms that appear verbatim in the document. Empty list if none.

4. riskFlags: things worth paying attention to - unusual clauses, concerning results, hidden fees, deadlines, anything that could cost money, health, or legal standing if missed. For each: severity ("high"/"medium"/"low"), issue (short title), explanation (why it matters and what the impact could be), whatToCheck (one concrete thing the person should verify or do about it), evidence (the exact excerpt from the document this risk is based on - can be an empty string only if certainty is "unclear"), and certainty: "stated" if this is explicitly written in the document, "interpretation" if you are inferring or reading between the lines from something that is in the document, or "unclear" if the document simply does not give enough information to know. Do not invent risks. Empty list if none.

5. actionItems: 2-5 concrete, specific actions the person should take because of this document (e.g. "Pay $110 by September 30" or "Call your insurer to confirm this claim number"). For each: action (the specific thing to do) and evidence (the exact excerpt from the document that this action is based on). These are things to DO, distinct from questions to ask.

6. importantDatesAndMoney: every deadline, payment amount, fee, deductible, or renewal date that appears in the document. For each: label (what it is), value (the date or amount, exactly as it would be said aloud), and note (one short sentence of context). Empty list if genuinely none appear.

7. questionsToAsk: 3-6 specific, smart questions based on THIS document. For each: question, askWho - who the person should ask: "Doctor", "Lawyer", "Insurer", "Biller", or "Other" - and basedOn (the exact excerpt from the document, or the gap in it, that prompted this question).

8. beforeAfter: 2-4 examples pairing a short confusing phrase or sentence actually taken from the document (original, verbatim) with its plain-language explanation (plain). Pick the most jargon-heavy or important phrases. This is different from the glossary - use short phrases or sentences, not single terms.

Be accurate and conservative. Do not diagnose medical conditions or give legal advice - only explain what the document says and flag what's worth asking about. Never invent information that is not in the document. If you are not confident an excerpt is verbatim from the document, leave the field out rather than guessing.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    documentType: { type: 'STRING' },
    summary: { type: 'STRING' },
    glossary: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          term: { type: 'STRING' },
          definition: { type: 'STRING' },
          moreDetail: { type: 'STRING' },
          evidence: { type: 'STRING' }
        },
        required: ['term', 'definition', 'moreDetail', 'evidence']
      }
    },
    riskFlags: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          severity: { type: 'STRING', enum: ['high', 'medium', 'low'] },
          issue: { type: 'STRING' },
          explanation: { type: 'STRING' },
          whatToCheck: { type: 'STRING' },
          evidence: { type: 'STRING' },
          certainty: { type: 'STRING', enum: ['stated', 'interpretation', 'unclear'] }
        },
        required: ['severity', 'issue', 'explanation', 'whatToCheck', 'evidence', 'certainty']
      }
    },
    actionItems: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          action: { type: 'STRING' },
          evidence: { type: 'STRING' }
        },
        required: ['action', 'evidence']
      }
    },
    importantDatesAndMoney: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING' },
          value: { type: 'STRING' },
          note: { type: 'STRING' }
        },
        required: ['label', 'value', 'note']
      }
    },
    questionsToAsk: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          question: { type: 'STRING' },
          askWho: { type: 'STRING', enum: ['Doctor', 'Lawyer', 'Insurer', 'Biller', 'Other'] },
          basedOn: { type: 'STRING' }
        },
        required: ['question', 'askWho', 'basedOn']
      }
    },
    beforeAfter: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          original: { type: 'STRING' },
          plain: { type: 'STRING' }
        },
        required: ['original', 'plain']
      }
    }
  },
  required: ['documentType', 'summary', 'glossary', 'riskFlags', 'actionItems', 'importantDatesAndMoney', 'questionsToAsk', 'beforeAfter']
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const clientIp = getClientIp(req);
  if (isRateLimited(clientIp)) {
    return res.status(429).json({
      error: 'Too many documents submitted in a short time. Please wait a minute and try again.'
    });
  }

  const { data, mimeType, language } = req.body || {};

  if (!data || !mimeType) {
    return res.status(400).json({ error: 'No document was received.' });
  }

  // never trust the client - recheck size server-side (base64 is ~4/3 raw size)
  const approxRawBytes = (data.length * 3) / 4;
  if (approxRawBytes > 4.2 * 1024 * 1024) {
    return res.status(400).json({ error: 'That file is too large (max 4MB). Try a smaller photo, a compressed scan, or a shorter document.' });
  }

  const outputLanguage = language && language !== 'Simple English' ? language : 'English';
  const PROMPT = outputLanguage === 'English'
    ? BASE_PROMPT
    : `${BASE_PROMPT}\n\nWrite your entire response (every field, including documentType, summary, glossary terms and definitions, risk flags, and questions) in ${outputLanguage}. Keep the same simple, everyday style described above, in ${outputLanguage} rather than English.`;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // This is the #1 cause of a broken deploy: the key was never added
    // to Vercel's Environment Variables (a local .env file is not enough).
    return res.status(500).json({
      error: 'Server is missing GEMINI_API_KEY. In Vercel: Project → Settings → Environment Variables → add GEMINI_API_KEY, then redeploy.'
    });
  }

  const isWordDoc = mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const isPlainText = mimeType === 'text/plain';

  let documentPart;

  if (isWordDoc) {
    // Gemini can't read .docx binary directly - pull the plain text out first.
    try {
      const buffer = Buffer.from(data, 'base64');
      const { value: extractedText } = await mammoth.extractRawText({ buffer });
      if (!extractedText || !extractedText.trim()) {
        return res.status(400).json({ error: 'This Word document appears to be empty, or is mostly images/tables we could not read. Try a PDF or photo instead.' });
      }
      documentPart = { text: `Document content:\n\n${extractedText}` };
    } catch (err) {
      console.error('mammoth extraction failed', err);
      return res.status(400).json({ error: 'Could not read this Word document. Make sure it is a .docx file (not the older .doc format), then try again.' });
    }
  } else if (isPlainText) {
    const text = Buffer.from(data, 'base64').toString('utf-8');
    documentPart = { text: `Document content:\n\n${text}` };
  } else {
    // Images and PDFs go to Gemini as-is - it reads them directly.
    documentPart = { inline_data: { mime_type: mimeType, data: data } };
  }

  const requestBody = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          { text: PROMPT },
          documentPart
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA
    }
  });

  const MODELS_TO_TRY = ['gemini-3.1-flash-lite', 'gemini-3.5-flash', 'gemini-2.5-flash'];
  const RETRIES_PER_MODEL = 2;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  let lastError = 'The AI service is unusually busy right now.';

  for (const model of MODELS_TO_TRY) {
    for (let attempt = 1; attempt <= RETRIES_PER_MODEL; attempt++) {
      try {
        const geminiResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-goog-api-key': apiKey
            },
            body: requestBody
          }
        );

        const result = await geminiResponse.json();

        // 429 = rate limited, 503 = overloaded - either way, a different
        // model has its own quota so falling through beats waiting
        if (geminiResponse.status === 429 || geminiResponse.status === 503) {
          lastError = result?.error?.message || 'The AI service is busy right now.';
          if (attempt < RETRIES_PER_MODEL) {
            await sleep(800);
            continue;
          }
          break; // give up on this model, fall through to the next one
        }

        // 404 = model name not available to this key, skip straight to next
        if (geminiResponse.status === 404) {
          lastError = result?.error?.message || 'Model unavailable.';
          break;
        }

        if (!geminiResponse.ok) {
          // not a capacity issue, other models won't help - fail now
          const message = result?.error?.message || 'The AI service returned an error.';
          return res.status(geminiResponse.status).json({ error: message });
        }

        const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
          return res.status(500).json({ error: 'The AI did not return a readable response. Try a clearer photo or scan.' });
        }

        const parsed = JSON.parse(text);
        return res.status(200).json(parsed);

      } catch (err) {
        console.error(err);
        lastError = 'Something went wrong while analyzing the document.';
        if (attempt < RETRIES_PER_MODEL) {
          await sleep(800);
          continue;
        }
        break;
      }
    }
  }

  // Every model in the fallback chain was busy - genuinely rare, but be honest about it.
  console.error('All models exhausted:', lastError);
  return res.status(503).json({ error: 'The AI service is unusually busy right now across all backup options. Please wait about a minute and try again.' });
}
