// ---- Grab all the page elements we'll need ----
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const fileChosen = document.getElementById('file-chosen');
const fileNameEl = document.getElementById('file-name');
const clearFileBtn = document.getElementById('clear-file');
const decodeButton = document.getElementById('decode-button');

const uploadSection = document.getElementById('upload-section');
const statusSection = document.getElementById('status-section');
const statusText = document.getElementById('status-text');
const errorSection = document.getElementById('error-section');
const errorText = document.getElementById('error-text');
const retryButton = document.getElementById('retry-button');
const resultsSection = document.getElementById('results-section');
const anotherButton = document.getElementById('another-button');

// Vercel's serverless functions reject request bodies over ~4.5MB.
// We warn the person before they even hit "Decode", instead of letting
// the request fail silently on the server.
const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4MB, leaves headroom for base64 overhead

const languageSelect = document.getElementById('language-select');

let selectedFile = null;
let guessedType = '';
let lastResult = null;

// ---- Sample document (demo safety net) ----
// If wifi or the API flakes during a live demo, this button shows a
// real, fully-worked example instantly, with no network call needed.
const sampleButton = document.getElementById('sample-button');

const SAMPLE_RESULT = {
  documentType: 'Insurance letter',
  summary: 'Your insurer is denying part of a recent claim because they say the procedure was "not medically necessary." You have 60 days from the date of this letter to file an appeal. If you miss that window, you lose the right to challenge the decision through this insurer\'s internal process.',
  actionItems: [
    'Mark the appeal deadline on your calendar today, not later',
    'Call your insurer and ask for the specific policy they used to deny this claim',
    'Ask your doctor\'s office for a letter of medical necessity to support your appeal'
  ],
  importantDatesAndMoney: [
    { label: 'Appeal deadline', value: '60 days from letter date', note: 'Miss this and you lose the right to appeal directly with this insurer.' },
    { label: 'Amount denied', value: 'Not specified in this letter', note: 'Ask for the exact dollar amount in writing.' }
  ],
  glossary: [
    { term: 'Prior authorization', definition: 'Approval your insurer requires before a treatment, or they may refuse to pay for it.', moreDetail: 'Even if a treatment is medically appropriate, insurers can deny payment if this approval step was skipped beforehand — it is a procedural requirement, separate from whether the treatment itself was necessary.' },
    { term: 'Explanation of Benefits (EOB)', definition: 'A statement showing what your insurer paid, denied, and why — not a bill itself.', moreDetail: 'You may still receive a separate bill from your provider for anything the EOB shows as denied or as your responsibility.' },
    { term: 'Medically necessary', definition: 'The insurer\'s judgment that a treatment was required to treat your condition, used here as the reason for denial.', moreDetail: 'This is the insurer\'s own determination, not a medical fact — it can be challenged with supporting documentation from your doctor.' }
  ],
  riskFlags: [
    { severity: 'high', issue: '60-day appeal deadline', explanation: 'Miss this date and you permanently lose the right to appeal through the insurer directly.', whatToCheck: 'Confirm the exact letter date and count 60 days from it.', certainty: 'stated' },
    { severity: 'medium', issue: 'No prior authorization on file', explanation: 'The letter implies the procedure was done without pre-approval, which is part of why it was denied.', whatToCheck: 'Ask your provider whether prior authorization was requested and what happened to it.', certainty: 'interpretation' },
    { severity: 'low', issue: 'Balance may still be billed by the provider', explanation: 'Even during an appeal, your doctor\'s office may send you a bill for the disputed amount.', whatToCheck: 'Ask your provider\'s billing department to pause collections while the appeal is active.', certainty: 'interpretation' }
  ],
  beforeAfter: [
    { original: 'This claim has been adjudicated as not medically necessary per plan guidelines.', plain: 'Your insurer decided you did not need this treatment, based on their own rules, and will not pay for it.' },
    { original: 'Requests for reconsideration must be submitted within sixty (60) calendar days of the date of this notice.', plain: 'You have 60 days from today\'s date on this letter to formally disagree with their decision.' }
  ],
  questionsToAsk: [
    { question: 'What exact date is 60 days from today, and where do I send the appeal?', askWho: 'Insurer' },
    { question: 'Can you send me the specific clinical policy you used to decide this was "not medically necessary"?', askWho: 'Insurer' },
    { question: 'Was prior authorization required for this procedure, and if so, why wasn\'t it obtained?', askWho: 'Doctor' },
    { question: 'Will you support my appeal with a letter of medical necessity?', askWho: 'Doctor' },
    { question: 'If the appeal is denied, what is the next step — external review?', askWho: 'Insurer' }
  ]
};

sampleButton.addEventListener('click', () => {
  renderResults(SAMPLE_RESULT);
});

// ---- File selection (click or drag-and-drop) ----
fileInput.addEventListener('change', (e) => {
  if (e.target.files[0]) setSelectedFile(e.target.files[0]);
});

dropzone.addEventListener('dragover', (e) => {
  e.preventDefault();
});
dropzone.addEventListener('drop', (e) => {
  e.preventDefault();
  if (e.dataTransfer.files[0]) setSelectedFile(e.dataTransfer.files[0]);
});

function setSelectedFile(file) {
  if (file.size > MAX_FILE_BYTES) {
    showError('That file is too large (max 4MB). Try a smaller photo, a compressed scan, or a shorter document.');
    return;
  }

  // Some browsers (especially on mobile) don't reliably report a mime type
  // for Word/text files, so fall back to guessing from the file extension.
  const name = file.name.toLowerCase();
  if (!file.type || file.type === 'application/octet-stream') {
    if (name.endsWith('.docx')) {
      guessedType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (name.endsWith('.txt')) {
      guessedType = 'text/plain';
    } else if (name.endsWith('.pdf')) {
      guessedType = 'application/pdf';
    } else {
      guessedType = '';
    }
  } else {
    guessedType = file.type;
  }

  if (name.endsWith('.doc') && !name.endsWith('.docx')) {
    showError('Older .doc files aren\'t supported yet — please save it as .docx (Word\'s "Save As" menu) or as a PDF, then try again.');
    return;
  }

  selectedFile = file;
  fileNameEl.textContent = file.name;
  fileChosen.hidden = false;
  decodeButton.disabled = false;
}

clearFileBtn.addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  fileChosen.hidden = true;
  decodeButton.disabled = true;
});

// ---- Turn the chosen file into base64 (what the API needs) ----
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // reader.result looks like "data:image/png;base64,AAAA..."
      // we only need the part after the comma
      const base64 = reader.result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ---- Main action: send the document off to be decoded ----
decodeButton.addEventListener('click', async () => {
  if (!selectedFile) return;

  decodeButton.disabled = true; // stop a second click while this one is still working

  showStatus('Reading your document…');

  try {
    const base64Data = await fileToBase64(selectedFile);

    const response = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: base64Data,
        mimeType: guessedType || selectedFile.type || 'application/pdf',
        language: languageSelect.value
      })
    });

    // If /api/analyze doesn't exist (e.g. this page was opened directly
    // as a file instead of being deployed), response.json() below will
    // throw because the server sends back an HTML error page, not JSON.
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Something went wrong while reading the document.');
    }

    renderResults(result);
  } catch (err) {
    if (err instanceof SyntaxError) {
      showError('Could not reach the AI service. If you are viewing this file locally, deploy it first — this page needs a live /api/analyze endpoint to work.');
    } else {
      showError(err.message || 'Something went wrong. Please try again.');
    }
  } finally {
    decodeButton.disabled = false; // safe to click again now
  }
});

// ---- Screen switching helpers ----
function showStatus(message) {
  uploadSection.hidden = true;
  errorSection.hidden = true;
  resultsSection.hidden = true;
  statusText.textContent = message;
  statusSection.hidden = false;
}

function showError(message) {
  statusSection.hidden = true;
  resultsSection.hidden = true;
  errorText.textContent = message;
  errorSection.hidden = false;
  uploadSection.hidden = false;
}

function showResults() {
  statusSection.hidden = true;
  errorSection.hidden = true;
  uploadSection.hidden = true;
  resultsSection.hidden = false;
  resultsSection.focus(); // so keyboard and screen-reader users land here, not stuck at the old upload button
}

retryButton.addEventListener('click', () => {
  errorSection.hidden = true;
});

anotherButton.addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  fileChosen.hidden = true;
  decodeButton.disabled = true;
  resultsSection.hidden = true;
  uploadSection.hidden = false;
});

// ---- Render the AI's answer onto the page ----
function renderResults(data) {
  lastResult = data; // keep a reference for copy/download
  document.getElementById('doc-type-badge').textContent = data.documentType || 'Document';
  document.getElementById('summary-text').textContent = data.summary || '';

  // Action items
  const actionList = document.getElementById('action-items-list');
  const actionBlock = document.getElementById('action-items-block');
  actionList.innerHTML = '';
  if (data.actionItems && data.actionItems.length > 0) {
    actionBlock.hidden = false;
    data.actionItems.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      actionList.appendChild(li);
    });
  } else {
    actionBlock.hidden = true;
  }

  // Important dates & money
  const datesList = document.getElementById('dates-money-list');
  const datesBlock = document.getElementById('dates-money-block');
  datesList.innerHTML = '';
  if (data.importantDatesAndMoney && data.importantDatesAndMoney.length > 0) {
    datesBlock.hidden = false;
    data.importantDatesAndMoney.forEach((item) => {
      const card = document.createElement('div');
      card.className = 'date-money-card';
      card.innerHTML = `
        <span class="date-money-value">${escapeHtml(item.value)}</span>
        <span class="date-money-label">${escapeHtml(item.label)}</span>
        <span class="date-money-note">${escapeHtml(item.note)}</span>
      `;
      datesList.appendChild(card);
    });
  } else {
    datesBlock.hidden = true;
  }

  // Risk flags
  const riskList = document.getElementById('risk-list');
  const riskBlock = document.getElementById('risk-block');
  riskList.innerHTML = '';
  if (data.riskFlags && data.riskFlags.length > 0) {
    riskBlock.hidden = false;
    data.riskFlags.forEach((risk) => {
      const li = document.createElement('li');
      li.className = `risk-item ${risk.severity || 'low'}`;
      const marker = risk.severity === 'high' ? '●' : risk.severity === 'medium' ? '◐' : '○';
      const certaintyLabel = risk.certainty === 'interpretation' ? 'Needs verification' : 'Clearly stated';
      const certaintyClass = risk.certainty === 'interpretation' ? 'needs-verification' : 'clearly-stated';
      li.innerHTML = `
        <span class="risk-label"><span class="risk-marker" aria-hidden="true">${marker}</span> ${risk.severity || ''}</span>
        <span class="risk-body">
          <strong>${escapeHtml(risk.issue)}</strong>
          <span class="certainty-tag ${certaintyClass}">${certaintyLabel}</span>
          <span>${escapeHtml(risk.explanation)}</span>
          ${risk.whatToCheck ? `<span class="risk-check"><strong>Check:</strong> ${escapeHtml(risk.whatToCheck)}</span>` : ''}
        </span>
      `;
      riskList.appendChild(li);
    });
  } else {
    riskBlock.hidden = true;
  }

  // Before / after examples
  const beforeAfterList = document.getElementById('before-after-list');
  const beforeAfterBlock = document.getElementById('before-after-block');
  beforeAfterList.innerHTML = '';
  if (data.beforeAfter && data.beforeAfter.length > 0) {
    beforeAfterBlock.hidden = false;
    data.beforeAfter.forEach((pair) => {
      const card = document.createElement('div');
      card.className = 'before-after-card';
      card.innerHTML = `
        <div class="ba-original"><span class="ba-label">In the document</span>"${escapeHtml(pair.original)}"</div>
        <div class="ba-plain"><span class="ba-label">In plain words</span>${escapeHtml(pair.plain)}</div>
      `;
      beforeAfterList.appendChild(card);
    });
  } else {
    beforeAfterBlock.hidden = true;
  }

  // Glossary (with expandable "explain more")
  const glossaryList = document.getElementById('glossary-list');
  const glossaryBlock = document.getElementById('glossary-block');
  glossaryList.innerHTML = '';
  if (data.glossary && data.glossary.length > 0) {
    glossaryBlock.hidden = false;
    data.glossary.forEach((entry, i) => {
      const dt = document.createElement('dt');
      dt.textContent = entry.term;
      const dd = document.createElement('dd');
      const moreId = `glossary-more-${i}`;
      dd.innerHTML = `
        ${escapeHtml(entry.definition)}
        ${entry.moreDetail ? `<button type="button" class="explain-more-btn" data-target="${moreId}">Explain more ▾</button>
        <span id="${moreId}" class="explain-more-text" hidden>${escapeHtml(entry.moreDetail)}</span>` : ''}
      `;
      glossaryList.appendChild(dt);
      glossaryList.appendChild(dd);
    });
    glossaryList.querySelectorAll('.explain-more-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = document.getElementById(btn.dataset.target);
        const isHidden = target.hidden;
        target.hidden = !isHidden;
        btn.textContent = isHidden ? 'Show less ▴' : 'Explain more ▾';
      });
    });
  } else {
    glossaryBlock.hidden = true;
  }

  // Questions to ask, grouped by who to ask
  const questionsList = document.getElementById('questions-list');
  const questionsBlock = document.getElementById('questions-block');
  questionsList.innerHTML = '';
  if (data.questionsToAsk && data.questionsToAsk.length > 0) {
    questionsBlock.hidden = false;
    data.questionsToAsk.forEach((q) => {
      const li = document.createElement('li');
      const questionText = typeof q === 'string' ? q : q.question;
      const askWho = typeof q === 'string' ? null : q.askWho;
      li.innerHTML = `${askWho ? `<span class="ask-who-tag">${escapeHtml(askWho)}</span>` : ''}${escapeHtml(questionText)}`;
      questionsList.appendChild(li);
    });
  } else {
    questionsBlock.hidden = true;
  }

  showResults();
}

// ---- Copy / download the results as plain text ----
function buildPlainTextSummary(data) {
  const lines = [];
  lines.push(`${data.documentType || 'Document'} — Plain Terms summary`, '');
  lines.push('WHAT THIS DOCUMENT SAYS', data.summary || '', '');

  if (data.actionItems?.length) {
    lines.push('WHAT TO DO NEXT');
    data.actionItems.forEach((a) => lines.push(`- ${a}`));
    lines.push('');
  }
  if (data.importantDatesAndMoney?.length) {
    lines.push('IMPORTANT DATES & MONEY');
    data.importantDatesAndMoney.forEach((d) => lines.push(`- ${d.label}: ${d.value} (${d.note})`));
    lines.push('');
  }
  if (data.riskFlags?.length) {
    lines.push('WORTH PAYING ATTENTION TO');
    data.riskFlags.forEach((r) => lines.push(`- [${(r.severity || '').toUpperCase()}] ${r.issue}: ${r.explanation} Check: ${r.whatToCheck || ''}`));
    lines.push('');
  }
  if (data.glossary?.length) {
    lines.push('TERMS EXPLAINED');
    data.glossary.forEach((g) => lines.push(`- ${g.term}: ${g.definition}`));
    lines.push('');
  }
  if (data.questionsToAsk?.length) {
    lines.push('QUESTIONS WORTH ASKING');
    data.questionsToAsk.forEach((q) => {
      const questionText = typeof q === 'string' ? q : q.question;
      const askWho = typeof q === 'string' ? '' : ` (ask your ${q.askWho})`;
      lines.push(`- ${questionText}${askWho}`);
    });
  }
  return lines.join('\n');
}

document.getElementById('copy-button').addEventListener('click', async () => {
  if (!lastResult) return;
  try {
    await navigator.clipboard.writeText(buildPlainTextSummary(lastResult));
    const btn = document.getElementById('copy-button');
    const original = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = original; }, 1500);
  } catch (err) {
    showError('Could not copy automatically. Try selecting the text on the page instead.');
  }
});

document.getElementById('download-button').addEventListener('click', () => {
  if (!lastResult) return;

  const d = lastResult;
  const esc = escapeHtml;
  let html = `<h1>Plain Terms — Document Summary</h1>`;
  html += `<div class="print-doctype">${esc(d.documentType || 'Document')}</div>`;
  html += `<h2>What this document says</h2><p>${esc(d.summary || '')}</p>`;

  if (d.actionItems?.length) {
    html += `<h2>What to do next</h2><ul>`;
    d.actionItems.forEach((a) => { html += `<li>${esc(a)}</li>`; });
    html += `</ul>`;
  }

  if (d.importantDatesAndMoney?.length) {
    html += `<h2>Important dates & money</h2>`;
    d.importantDatesAndMoney.forEach((item) => {
      html += `<div class="print-item"><strong>${esc(item.value)}</strong> — ${esc(item.label)}<br><span style="color:#4A5164">${esc(item.note)}</span></div>`;
    });
  }

  if (d.riskFlags?.length) {
    html += `<h2>Worth paying attention to</h2>`;
    d.riskFlags.forEach((r) => {
      const certainty = r.certainty === 'interpretation' ? 'Needs verification' : 'Clearly stated';
      html += `<div class="print-item"><span class="print-tag">${esc((r.severity || '').toUpperCase())}</span><span class="print-tag">${esc(certainty)}</span><br><strong>${esc(r.issue)}</strong><br>${esc(r.explanation)}${r.whatToCheck ? `<br><em>Check: ${esc(r.whatToCheck)}</em>` : ''}</div>`;
    });
  }

  if (d.beforeAfter?.length) {
    html += `<h2>In the document vs. in plain words</h2>`;
    d.beforeAfter.forEach((pair) => {
      html += `<div class="print-item"><em>"${esc(pair.original)}"</em><br>→ ${esc(pair.plain)}</div>`;
    });
  }

  if (d.glossary?.length) {
    html += `<h2>Terms explained</h2>`;
    d.glossary.forEach((g) => {
      html += `<div class="print-item"><strong>${esc(g.term)}</strong> — ${esc(g.definition)}</div>`;
    });
  }

  if (d.questionsToAsk?.length) {
    html += `<h2>Questions worth asking</h2><ul>`;
    d.questionsToAsk.forEach((q) => {
      const questionText = typeof q === 'string' ? q : q.question;
      const askWho = typeof q === 'string' ? '' : ` <span class="print-tag">${esc(q.askWho)}</span>`;
      html += `<li>${esc(questionText)}${askWho}</li>`;
    });
    html += `</ul>`;
  }

  html += `<div class="print-footer">Generated by Plain Terms. This is not medical, legal, or financial advice — always confirm with the relevant professional.</div>`;

  const printContainer = document.getElementById('print-container');
  printContainer.innerHTML = html;
  window.print();
});

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
