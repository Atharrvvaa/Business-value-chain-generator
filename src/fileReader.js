// ─── File Reader Utility ─────────────────────────────────────────────────────
// Extracts text content from uploaded files (TXT, CSV, JSON, PDF metadata)
// For PDF/PPTX: extracts raw text; binary parsing is done client-side

export async function extractFileContent(file) {
  const name = file.name.toLowerCase();

  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.csv')) {
    return await readAsText(file);
  }

  if (name.endsWith('.json')) {
    const text = await readAsText(file);
    try {
      const parsed = JSON.parse(text);
      return JSON.stringify(parsed, null, 2);
    } catch {
      return text;
    }
  }

  if (name.endsWith('.pdf')) {
    // PDF: read as text (works for text-based PDFs)
    // For complex PDFs, we read the raw bytes and extract readable strings
    const text = await readAsText(file);
    // Basic cleanup: strip non-printable chars, keep readable text
    const cleaned = text
      .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
      .replace(/\s{3,}/g, '\n')
      .substring(0, 8000); // cap at 8k chars
    return `[Extracted from PDF: ${file.name}]\n${cleaned}`;
  }

  if (name.endsWith('.pptx') || name.endsWith('.docx') || name.endsWith('.xlsx')) {
    // Office files: extract whatever readable text we can get
    const text = await readAsText(file);
    const cleaned = text
      .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
      .replace(/\s{3,}/g, '\n')
      .substring(0, 8000);
    return `[Extracted from ${name.split('.').pop().toUpperCase()}: ${file.name}]\n${cleaned}`;
  }

  // Fallback
  return `[File uploaded: ${file.name} — type not parseable for text extraction]`;
}

function readAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target.result || '');
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file, 'utf-8');
  });
}

export function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}
