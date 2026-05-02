// ─── AI Engine: Business Architect ───────────────────────────────────────────
// Calls the Python FastAPI backend (which talks to Ollama internally).
// Frontend never touches Ollama directly.

// Empty string = relative URL — all /api/* calls go through Vite's proxy.
// This works both locally and from other devices on the network.
export const BACKEND_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_BACKEND_URL) ||
  '';

// ── Health check ──────────────────────────────────────────────────────────────
export async function checkBackendHealth() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/health`);
    if (!res.ok) return { ok: false, model: '', ollamaConnected: false };
    const data = await res.json();
    return {
      ok: data.status === 'ok',
      model: data.model,
      ollamaConnected: data.ollama_connected,
      availableModels: data.available_models || [],
    };
  } catch {
    return { ok: false, model: '', ollamaConnected: false, availableModels: [] };
  }
}

// ── Generate value chain (with optional files) ────────────────────────────────
export async function generateValueChain(inputs, onProgress) {
  const { companyName, industry, description, repoUrl, files } = inputs;

  if (!companyName || !industry) {
    throw new Error('Company name and industry are required.');
  }

  onProgress?.('Sending request to backend...');

  let response;
  try {
    if (files && files.length > 0) {
      // Multipart form — files handled server-side by Python
      const form = new FormData();
      form.append('company_name', companyName);
      form.append('industry', industry);
      if (description) form.append('description', description);
      if (repoUrl) form.append('repo_url', repoUrl);
      files.forEach(f => form.append('files', f));

      onProgress?.('Extracting documents on server...');
      response = await fetch(`${BACKEND_URL}/api/generate/upload`, {
        method: 'POST',
        body: form,
      });
    } else {
      // Plain JSON — no files
      response = await fetch(`${BACKEND_URL}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company_name: companyName,
          industry,
          description: description || null,
          repo_url: repoUrl || null,
        }),
      });
    }
  } catch {
    throw new Error(
      `Cannot reach backend at ${BACKEND_URL}.\n` +
      `Start it with:  uvicorn backend.main:app --reload --port 8000`
    );
  }

  onProgress?.('llama3.2 is generating your value chain — this takes 1-3 min on CPU...');

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.detail || `Backend error ${response.status}`);
  }

  onProgress?.('Structuring value chain...');

  const data = await response.json();

  if (!data.primaryActivities || !data.supportFunctions) {
    throw new Error('Incomplete response from backend. Please retry.');
  }

  return data;
}
