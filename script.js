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

let selectedFile = null;

// ---- Sample document (demo safety net) ----
// If wifi or the API flakes during a live demo, this button shows a
// real, fully-worked example instantly, with no network call needed.
const sampleButton = document.getElementById('sample-button');

const SAMPLE_RESULT = {
  documentType: 'Insurance letter',
  summary: 'Your insurer is denying part of a recent claim because they say the procedure was "not medically necessary." You have 60 days from the date of this letter to file an appeal. If you miss that window, you lose the right to challenge the decision through this insurer\'s internal process.',
  glossary: [
    { term: 'Prior authorization', definition: 'Approval your insurer requires before a treatment, or they may refuse to pay for it.' },
    { term: 'Explanation of Benefits (EOB)', definition: 'A statement showing what your insurer paid, denied, and why — not a bill itself.' },
    { term: 'Medically necessary', definition: 'The insurer\'s judgment that a treatment was required to treat your condition, used here as the reason for denial.' }
  ],
  riskFlags: [
    { severity: 'high', issue: '60-day appeal deadline', explanation: 'Miss this date and you permanently lose the right to appeal through the insurer directly.' },
    { severity: 'medium', issue: 'No prior authorization on file', explanation: 'The letter implies the procedure was done without pre-approval, which is part of why it was denied.' },
    { severity: 'low', issue: 'Balance may still be billed by the provider', explanation: 'Even during an appeal, your doctor\'s office may send you a bill for the disputed amount.' }
  ],
  questionsToAsk: [
    'What exact date is 60 days from today, and where do I send the appeal?',
    'Can you send me the specific clinical policy you used to decide this was "not medically necessary"?',
    'Was prior authorization required for this procedure, and if so, why wasn\'t it obtained?',
    'Will my doctor\'s office support the appeal with a letter of medical necessity?',
    'If the appeal is denied, what is the next step — external review?'
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
    showError('That file is too large (max 4MB). Try a smaller photo, a compressed scan, or a shorter PDF.');
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
        mimeType: selectedFile.type || 'application/pdf'
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
  document.getElementById('doc-type-badge').textContent = data.documentType || 'Document';
  document.getElementById('summary-text').textContent = data.summary || '';

  // Risk flags
  const riskList = document.getElementById('risk-list');
  const riskBlock = document.getElementById('risk-block');
  riskList.innerHTML = '';
  if (data.riskFlags && data.riskFlags.length > 0) {
    riskBlock.hidden = false;
    data.riskFlags.forEach((risk) => {
      const li = document.createElement('li');
      li.className = `risk-item ${risk.severity || 'low'}`;
      li.innerHTML = `
        <span class="risk-label">${risk.severity || ''}</span>
        <span class="risk-body"><strong>${escapeHtml(risk.issue)}</strong><span>${escapeHtml(risk.explanation)}</span></span>
      `;
      riskList.appendChild(li);
    });
  } else {
    riskBlock.hidden = true;
  }

  // Glossary
  const glossaryList = document.getElementById('glossary-list');
  const glossaryBlock = document.getElementById('glossary-block');
  glossaryList.innerHTML = '';
  if (data.glossary && data.glossary.length > 0) {
    glossaryBlock.hidden = false;
    data.glossary.forEach((entry) => {
      const dt = document.createElement('dt');
      dt.textContent = entry.term;
      const dd = document.createElement('dd');
      dd.textContent = entry.definition;
      glossaryList.appendChild(dt);
      glossaryList.appendChild(dd);
    });
  } else {
    glossaryBlock.hidden = true;
  }

  // Questions to ask
  const questionsList = document.getElementById('questions-list');
  const questionsBlock = document.getElementById('questions-block');
  questionsList.innerHTML = '';
  if (data.questionsToAsk && data.questionsToAsk.length > 0) {
    questionsBlock.hidden = false;
    data.questionsToAsk.forEach((q) => {
      const li = document.createElement('li');
      li.textContent = q;
      questionsList.appendChild(li);
    });
  } else {
    questionsBlock.hidden = true;
  }

  showResults();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}
