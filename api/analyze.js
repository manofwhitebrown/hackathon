// This file runs on Vercel's servers, not in the browser.
// It's the only place that ever touches your Gemini API key,
// so the key is never visible to anyone using the site.

const GEMINI_MODEL = 'gemini-2.5-flash';

const PROMPT = `You are helping an ordinary person understand a confusing real-world document
(this could be a medical result, a legal contract, an insurance letter, or a bill).

Read the attached document and respond with:
1. documentType: a short label for what kind of document this is (e.g. "Medical result", "Insurance letter", "Legal contract", "Bill").
2. summary: 3-5 plain-English sentences explaining what this document actually says, written for someone with no background in the subject. No jargon.
3. glossary: a list of the confusing or technical terms that actually appear in THIS document, each with a one-sentence plain-English definition. Only include terms that appear in the document. If there are none, return an empty list.
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

  const { data, mimeType } = req.body || {};

  if (!data || !mimeType) {
    return res.status(400).json({ error: 'No document was received.' });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    // This is the #1 cause of a broken deploy: the key was never added
    // to Vercel's Environment Variables (a local .env file is not enough).
    return res.status(500).json({
      error: 'Server is missing GEMINI_API_KEY. In Vercel: Project → Settings → Environment Variables → add GEMINI_API_KEY, then redeploy.'
    });
  }

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
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
        })
      }
    );

    const result = await geminiResponse.json();

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
    return res.status(500).json({ error: 'Something went wrong while analyzing the document. Please try again.' });
  }
}
