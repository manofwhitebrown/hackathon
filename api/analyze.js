// This file runs on Vercel's servers, not in the browser.
// It's the only place that ever touches your Gemini API key,
// so the key is never visible to anyone using the site.

const GEMINI_MODEL = 'gemini-3.6-flash';

const BASE_PROMPT = `You are helping an ordinary person understand a confusing real-world document
(this could be a medical result, a legal contract, an insurance letter, or a bill).

The person you are writing for may have limited formal education and may not be familiar with
technical, legal, medical, or financial vocabulary. Write as if explaining it out loud to a
friend or family member with no background in the subject:
- Use short sentences.
- Use everyday, common words instead of technical or formal ones wherever possible.
- If a technical term truly cannot be avoided, explain it in the simplest possible way the moment you use it.
- Avoid long or compound sentences. One idea per sentence where possible.

Read the attached document and respond with:
1. documentType: a short label for what kind of document this is (e.g. "Medical result", "Insurance letter", "Legal contract", "Bill").
2. summary: 3-5 plain, simple sentences explaining what this document actually says.
3. glossary: a list of the confusing or technical terms that actually appear in THIS document, each with a one-sentence simple definition. Only include terms that appear in the document. If there are none, return an empty list.
4. riskFlags: things in the document worth paying attention to - unusual clauses, concerning results, hidden fees, deadlines, anything that could cost the person money, health, or legal standing if missed. For each one, give a severity ("high", "medium", or "low"), a short issue title, and a one-sentence explanation of why it matters. If there is nothing concerning, return an empty list - do not invent risks.
5. questionsToAsk: 3-6 specific, smart questions the person could ask their doctor, lawyer, insurer, or the sender of the bill, based on THIS specific document.

Be accurate and conservative. Do not diagnose medical conditions or give legal advice - only explain what the document says and flag what's worth asking about.`;

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
          definition: { type: 'STRING' }
        },
        required: ['term', 'definition']
      }
    },
    riskFlags: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          severity: { type: 'STRING', enum: ['high', 'medium', 'low'] },
          issue: { type: 'STRING' },
          explanation: { type: 'STRING' }
        },
        required: ['severity', 'issue', 'explanation']
      }
    },
    questionsToAsk: {
      type: 'ARRAY',
      items: { type: 'STRING' }
    }
  },
  required: ['documentType', 'summary', 'glossary', 'riskFlags', 'questionsToAsk']
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { data, mimeType, language } = req.body || {};

  if (!data || !mimeType) {
    return res.status(400).json({ error: 'No document was received.' });
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

  const requestBody = JSON.stringify({
    contents: [
      {
        role: 'user',
        parts: [
          { text: PROMPT },
          { inline_data: { mime_type: mimeType, data: data } }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA
    }
  });

  const MAX_ATTEMPTS = 3;
  let lastError = 'The AI service returned an error.';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
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

      // 429 = rate limited, 503 = model temporarily overloaded.
      // Both are usually gone within a couple seconds, so retry quietly
      // instead of immediately showing the person an error.
      if (geminiResponse.status === 429 || geminiResponse.status === 503) {
        lastError = result?.error?.message || 'The AI service is busy right now.';
        if (attempt < MAX_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, attempt * 1200)); // 1.2s, then 2.4s
          continue;
        }
        return res.status(503).json({ error: 'The AI service is unusually busy right now. Please wait a few seconds and try again.' });
      }

      if (!geminiResponse.ok) {
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
      lastError = 'Something went wrong while analyzing the document. Please try again.';
      if (attempt === MAX_ATTEMPTS) {
        return res.status(500).json({ error: lastError });
      }
    }
  }
}
