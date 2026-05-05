import React, { useState, useRef, useCallback } from 'react';
import { generateValueChain, checkBackendHealth, loadDemo, BACKEND_URL } from './aiEngine.js';
import { formatFileSize } from './fileReader.js';
import { exportAsJSON, exportAsMarkdown, exportAsCSV, exportAsPDF } from './exportUtils.js';

// ─── Icons (inline SVG for zero deps) ────────────────────────────────────────
const Icon = ({ d, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const ICONS = {
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  chevronDown: "M6 9l6 6 6-6",
  chevronRight: "M9 18l6-6-6-6",
  sparkles: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 1 1 7.072 0l-.548.547A3.374 3.374 0 0 0 14 18.469V19a2 2 0 1 1-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z",
  building: "M2 20h20M5 20V8l7-5 7 5v12M9 20v-5h6v5",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  check: "M20 6L9 17l-5-5",
  x: "M18 6L6 18M6 6l12 12",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6",
  layers: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  copy: "M8 17.929H6c-1.105 0-2-.912-2-2.036V5.036C4 3.91 4.895 3 6 3h8c1.105 0 2 .911 2 2.036v1.866m-6 .17h8c1.105 0 2 .91 2 2.035v10.857C20 21.09 19.105 22 18 22h-8c-1.105 0-2-.911-2-2.036V9.107c0-1.124.895-2.036 2-2.036z",
  info: "M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10zM12 8h.01M11 12h1v4h1",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"
};

// ─── Input Form Component ─────────────────────────────────────────────────────
function InputForm({ onSubmit, loading }) {
  const [companyName, setCompanyName] = useState('');
  const [industry, setIndustry] = useState('');
  const [description, setDescription] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [files, setFiles] = useState([]);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef();

  const INDUSTRIES = [
    'Banking & Financial Services', 'Insurance', 'Healthcare & Life Sciences',
    'Retail & E-Commerce', 'Manufacturing', 'Technology / SaaS',
    'Telecommunications', 'Energy & Utilities', 'Logistics & Supply Chain',
    'Media & Entertainment', 'Real Estate', 'Education',
    'Government & Public Sector', 'Automotive', 'Professional Services'
  ];

  const handleFiles = (newFiles) => {
    const allowed = ['pdf', 'pptx', 'docx', 'txt', 'md', 'csv', 'json'];
    const valid = Array.from(newFiles).filter(f => {
      const ext = f.name.split('.').pop().toLowerCase();
      return allowed.includes(ext);
    });
    setFiles(prev => [...prev, ...valid].slice(0, 3));
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!companyName.trim() || !industry) return;
    // Pass raw File objects — the Python backend extracts text server-side
    onSubmit({ companyName: companyName.trim(), industry, description, repoUrl, files });
  };

  return (
    <form onSubmit={handleSubmit} style={styles.form}>
      <div style={styles.formGrid}>
        {/* Company Name */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Company Name <span style={styles.required}>*</span></label>
          <input
            style={styles.input}
            value={companyName}
            onChange={e => setCompanyName(e.target.value)}
            placeholder="e.g. Infosys, Zomato, HDFC Bank"
            required
          />
        </div>

        {/* Industry */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>Industry <span style={styles.required}>*</span></label>
          <select
            style={{ ...styles.input, ...styles.select }}
            value={industry}
            onChange={e => setIndustry(e.target.value)}
            required
          >
            <option value="">Select industry...</option>
            {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
      </div>

      {/* Description */}
      <div style={styles.fieldGroup}>
        <label style={styles.label}>Business Context <span style={styles.optional}>(optional)</span></label>
        <textarea
          style={{ ...styles.input, height: 100, resize: 'vertical' }}
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Describe the company's business model, key products/services, strategy, or any context that helps generate a more accurate value chain..."
        />
      </div>

      {/* Repo URL */}
      <div style={styles.fieldGroup}>
        <label style={styles.label}>
          <Icon d={ICONS.link} size={14} />
          <span style={{ marginLeft: 6 }}>Knowledge Repository URL <span style={styles.optional}>(optional)</span></span>
        </label>
        <input
          style={styles.input}
          value={repoUrl}
          onChange={e => setRepoUrl(e.target.value)}
          placeholder="https://sharepoint.company.com/capability-framework"
          type="url"
        />
      </div>

      {/* File Upload */}
      <div style={styles.fieldGroup}>
        <label style={styles.label}>
          <Icon d={ICONS.upload} size={14} />
          <span style={{ marginLeft: 6 }}>Upload Documents <span style={styles.optional}>(PDF, PPTX, DOCX, TXT, CSV, JSON — max 3)</span></span>
        </label>
        <div
          style={{ ...styles.dropzone, ...(dragOver ? styles.dropzoneActive : {}) }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" multiple accept=".pdf,.pptx,.docx,.txt,.md,.csv,.json" style={{ display: 'none' }} onChange={e => handleFiles(e.target.files)} />
          <Icon d={ICONS.upload} size={24} />
          <p style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: 13 }}>
            {files.length === 0 ? 'Drop files here or click to browse' : `${files.length} file(s) selected — click to add more`}
          </p>
        </div>

        {files.length > 0 && (
          <div style={styles.fileList}>
            {files.map((f, i) => (
              <div key={i} style={styles.fileChip}>
                <Icon d={ICONS.file} size={13} />
                <span style={{ marginLeft: 6, flex: 1 }}>{f.name}</span>
                <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{formatFileSize(f.size)}</span>
                <button type="button" style={styles.removeBtn} onClick={(e) => { e.stopPropagation(); setFiles(fs => fs.filter((_, j) => j !== i)); }}>
                  <Icon d={ICONS.x} size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <button type="submit" disabled={loading || !companyName || !industry} style={{ ...styles.submitBtn, ...(loading || !companyName || !industry ? styles.submitBtnDisabled : {}) }}>
        {loading ? (
          <>
            <div style={styles.spinner} />
            <span>Generating Value Chain...</span>
          </>
        ) : (
          <>
            <Icon d={ICONS.sparkles} size={16} />
            <span style={{ marginLeft: 8 }}>Generate Value Chain & Capabilities</span>
          </>
        )}
      </button>
    </form>
  );
}

// ─── Context Summary Card ────────────────────────────────────────────────────
function ContextSummary({ context }) {
  return (
    <div style={styles.contextCard}>
      <h3 style={styles.sectionTitle}>
        <Icon d={ICONS.info} size={16} />
        <span style={{ marginLeft: 8 }}>Context Summary</span>
      </h3>
      <div style={styles.contextGrid}>
        <div style={styles.contextItem}>
          <div style={styles.contextLabel}>Value Proposition</div>
          <div style={styles.contextValue}>{context.valueProposition}</div>
        </div>
        <div style={styles.contextItem}>
          <div style={styles.contextLabel}>Business Model</div>
          <div style={styles.contextValue}>{context.businessModel}</div>
        </div>
        <div style={{ ...styles.contextItem, gridColumn: '1 / -1' }}>
          <div style={styles.contextLabel}>Differentiation</div>
          <div style={styles.contextValue}>{context.differentiation}</div>
        </div>
      </div>
      <div style={{ marginTop: 16 }}>
        <div style={styles.contextLabel}>Key Insights</div>
        <ul style={styles.insightList}>
          {context.keyInsights.map((insight, i) => (
            <li key={i} style={styles.insightItem}>
              <span style={styles.insightDot} />
              {insight}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── Capability Card ──────────────────────────────────────────────────────────
function CapabilityCard({ capability, color }) {
  return (
    <div style={{ ...styles.capCard, borderLeftColor: color }}>
      <div style={{ ...styles.capId, color }}>{capability.id}</div>
      <div style={styles.capName}>{capability.name}</div>
      <div style={styles.capDesc}>{capability.description}</div>
    </div>
  );
}

// ─── Value Chain Component ────────────────────────────────────────────────────
function ValueChainComponent({ component, type, color, index }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div style={{ ...styles.vcComponent, borderColor: expanded ? color + '44' : 'var(--border)' }}>
      <div style={styles.vcHeader} onClick={() => setExpanded(e => !e)}>
        <div style={styles.vcHeaderLeft}>
          <div style={{ ...styles.vcBadge, background: color + '22', color, borderColor: color + '55' }}>
            {component.id}
          </div>
          <div>
            <div style={styles.vcName}>{component.name}</div>
            <div style={styles.vcDesc}>{component.description}</div>
          </div>
        </div>
        <div style={styles.vcRight}>
          <span style={styles.capCount}>{component.capabilities.length} capabilities</span>
          <div style={{ transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform 0.2s', color: 'var(--text-muted)' }}>
            <Icon d={ICONS.chevronDown} size={16} />
          </div>
        </div>
      </div>

      {expanded && (
        <div style={styles.capGrid}>
          {component.capabilities.map(cap => (
            <CapabilityCard key={cap.id} capability={cap} color={color} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Architecture Diagram ─────────────────────────────────────────────────────
function ArchDiagram({ result }) {
  const pa = result.primaryActivities;
  const sf = result.supportFunctions;
  const PRIMARY_COLOR = '#e8c547';
  const SUPPORT_COLOR = '#7c6af5';

  return (
    <div style={styles.archContainer}>
      <h3 style={styles.sectionTitle}>
        <Icon d={ICONS.layers} size={16} />
        <span style={{ marginLeft: 8 }}>Primary Value Chain</span>
      </h3>

      {/* Value chain flow diagram */}
      <div style={styles.archDiagram}>
        {/* Primary Activities Row */}
        <div style={styles.archLabel} data-type="primary">
          <span style={{ color: PRIMARY_COLOR, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 2 }}>PRIMARY ACTIVITIES</span>
        </div>
        <div style={styles.primaryFlow}>
          {pa.map((a, i) => (
            <React.Fragment key={a.id}>
              <div style={styles.archNode}>
                <div style={{ ...styles.archNodeBadge, background: PRIMARY_COLOR + '22', color: PRIMARY_COLOR, border: `1px solid ${PRIMARY_COLOR}44` }}>
                  {a.id}
                </div>
                <div style={styles.archNodeName}>{a.name}</div>
                <div style={styles.archNodeCount}>{a.capabilities.length} caps</div>
              </div>
              {i < pa.length - 1 && (
                <div style={styles.archArrow}>
                  <svg width="24" height="12" viewBox="0 0 24 12">
                    <path d="M0 6 H20 M14 1 L20 6 L14 11" stroke={PRIMARY_COLOR + '88'} strokeWidth="1.5" fill="none" strokeLinecap="round" />
                  </svg>
                </div>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Divider */}
        <div style={styles.archDivider} />

        {/* Support Functions Row */}
        <div style={styles.archLabel}>
          <span style={{ color: SUPPORT_COLOR, fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: 2 }}>SUPPORT FUNCTIONS</span>
        </div>
        <div style={styles.supportFlow}>
          {sf.map(f => (
            <div key={f.id} style={{ ...styles.archNode, ...styles.supportNode }}>
              <div style={{ ...styles.archNodeBadge, background: SUPPORT_COLOR + '22', color: SUPPORT_COLOR, border: `1px solid ${SUPPORT_COLOR}44` }}>
                {f.id}
              </div>
              <div style={styles.archNodeName}>{f.name}</div>
              <div style={styles.archNodeCount}>{f.capabilities.length} caps</div>
            </div>
          ))}
        </div>

        {/* Stats bar */}
        <div style={styles.archStats}>
          <div style={styles.statPill}>
            <span style={{ color: PRIMARY_COLOR }}>●</span>
            <span style={{ marginLeft: 6 }}>{pa.length} Primary Activities</span>
          </div>
          <div style={styles.statPill}>
            <span style={{ color: SUPPORT_COLOR }}>●</span>
            <span style={{ marginLeft: 6 }}>{sf.length} Support Functions</span>
          </div>
          <div style={styles.statPill}>
            <span style={{ color: '#4ae8b0' }}>●</span>
            <span style={{ marginLeft: 6 }}>
              {[...pa, ...sf].reduce((s, c) => s + c.capabilities.length, 0)} Total Capabilities
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Result View ──────────────────────────────────────────────────────────────
function ResultView({ result, companyName, industry, onReset, savedAt }) {
  const PA_COLORS = ['#e8c547', '#f09d35', '#e8705a', '#c75a8c', '#a06af5', '#6aa8f5', '#4ae8b0', '#35d4c4'];
  const SF_COLORS = ['#7c6af5', '#9b6af5', '#b86af5', '#d46af5', '#f06af5', '#f56acd'];
  const [activeTab, setActiveTab] = useState('primary');
  const [pdfLoading, setPdfLoading] = useState(false);
  const [expiryLabel, setExpiryLabel] = useState(() => savedAt ? formatExpiry(savedAt) : null);
  const resultRef = useRef();

  React.useEffect(() => {
    if (!savedAt) return;
    const t = setInterval(() => setExpiryLabel(formatExpiry(savedAt)), 60000);
    return () => clearInterval(t);
  }, [savedAt]);

  const handleExportPDF = async () => {
    if (!resultRef.current) return;
    setPdfLoading(true);
    try {
      await exportAsPDF(resultRef.current, companyName);
    } finally {
      setPdfLoading(false);
    }
  };

  return (
    <div style={styles.resultContainer} ref={resultRef}>
      {/* Header */}
      <div style={styles.resultHeader}>
        <div>
          <div style={styles.resultTitle}>
            <Icon d={ICONS.building} size={20} />
            <span style={{ marginLeft: 10 }}>{companyName}</span>
            <span style={styles.industryPill}>{industry}</span>
          </div>
          <div style={styles.resultSubtitle}>
            Business Value Chain & Capability Map
            {expiryLabel && (
              <span style={styles.expiryBadge}>⏱ saved · expires in {expiryLabel}</span>
            )}
          </div>
        </div>
        <div style={styles.headerActions}>
          <button style={styles.exportBtn} onClick={() => exportAsJSON(result, companyName)}>
            <Icon d={ICONS.download} size={14} /> JSON
          </button>
          <button style={styles.exportBtn} onClick={() => exportAsMarkdown(result, companyName, industry)}>
            <Icon d={ICONS.download} size={14} /> Markdown
          </button>
          <button style={styles.exportBtn} onClick={() => exportAsCSV(result, companyName)}>
            <Icon d={ICONS.download} size={14} /> CSV
          </button>
          <button style={{ ...styles.exportBtn, ...styles.pdfBtn }} onClick={handleExportPDF} disabled={pdfLoading}>
            {pdfLoading
              ? <div style={{ ...styles.spinner, borderTopColor: 'var(--text-muted)', width: 12, height: 12, borderWidth: 1.5 }} />
              : <Icon d={ICONS.download} size={14} />}
            {pdfLoading ? ' Generating...' : ' PDF'}
          </button>
          <button style={{ ...styles.exportBtn, ...styles.resetBtn }} onClick={onReset}>
            <Icon d={ICONS.x} size={14} /> New Analysis
          </button>
        </div>
      </div>

      {/* Context Summary */}
      <ContextSummary context={result.context} />

      {/* Architecture Diagram */}
      <ArchDiagram result={result} />

      {/* Tabs */}
      <div style={styles.tabs}>
        <button
          style={{ ...styles.tab, ...(activeTab === 'primary' ? styles.tabActive : {}) }}
          onClick={() => setActiveTab('primary')}
        >
          Primary Activities
          <span style={styles.tabBadge}>{result.primaryActivities.length}</span>
        </button>
        <button
          style={{ ...styles.tab, ...(activeTab === 'support' ? styles.tabActive : {}) }}
          onClick={() => setActiveTab('support')}
        >
          Support Functions
          <span style={styles.tabBadge}>{result.supportFunctions.length}</span>
        </button>
      </div>

      {/* Components */}
      <div style={styles.componentList}>
        {activeTab === 'primary'
          ? result.primaryActivities.map((a, i) => (
              <ValueChainComponent key={a.id} component={a} type="primary" color={PA_COLORS[i % PA_COLORS.length]} index={i} />
            ))
          : result.supportFunctions.map((f, i) => (
              <ValueChainComponent key={f.id} component={f} type="support" color={SF_COLORS[i % SF_COLORS.length]} index={i} />
            ))
        }
      </div>
    </div>
  );
}

// ─── Ollama Status Banner ─────────────────────────────────────────────────────
function OllamaStatus({ status }) {
  if (status === 'checking') return null;
  const ok = status === 'ok';
  return (
    <div style={{
      background: ok ? 'var(--accent3)11' : '#f05b5b11',
      border: `1px solid ${ok ? 'var(--accent3)44' : '#f05b5b44'}`,
      borderRadius: 8, padding: '8px 14px', fontSize: 12,
      color: ok ? 'var(--accent3)' : 'var(--error)',
      display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
      fontFamily: 'var(--font-mono)'
    }}>
      <span style={{ fontSize: 8 }}>{ok ? '●' : '○'}</span>
      {ok
        ? `Backend + Ollama connected · ${BACKEND_URL}/api/health`
        : `Backend not reachable at ${BACKEND_URL} — run: uvicorn backend.main:app --reload --port 8000`}
    </div>
  );
}

// ─── Session persistence ──────────────────────────────────────────────────────
const STORAGE_KEY = 'biz-architect-session';
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function loadPersistedSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { result: null, lastInputs: null, savedAt: null };
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.savedAt > TTL_MS) {
      localStorage.removeItem(STORAGE_KEY);
      return { result: null, lastInputs: null, savedAt: null };
    }
    return parsed;
  } catch {
    return { result: null, lastInputs: null, savedAt: null };
  }
}

function saveSession(result, lastInputs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ result, lastInputs, savedAt: Date.now() }));
  } catch { /* storage full — ignore */ }
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function formatExpiry(savedAt) {
  const msLeft = TTL_MS - (Date.now() - savedAt);
  if (msLeft <= 0) return null;
  const h = Math.floor(msLeft / 3600000);
  const m = Math.floor((msLeft % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const persisted = loadPersistedSession();
  const [result, setResult] = useState(persisted.result);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [lastInputs, setLastInputs] = useState(persisted.lastInputs);
  const [savedAt, setSavedAt] = useState(persisted.savedAt);
  const [ollamaStatus, setOllamaStatus] = useState('checking');
  const [elapsed, setElapsed] = useState(0);

  React.useEffect(() => {
    checkBackendHealth().then(({ ok }) => setOllamaStatus(ok ? 'ok' : 'error'));
  }, []);

  React.useEffect(() => {
    if (!loading) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [loading]);

  const handleDemo = useCallback(async () => {
    setLoading(true);
    setError('');
    setResult(null);
    const inputs = { companyName: 'HDFC Bank', industry: 'Banking & Financial Services' };
    setLastInputs(inputs);
    try {
      const data = await loadDemo();
      setResult(data);
      saveSession(data, inputs);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err.message || 'Could not load demo.');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSubmit = useCallback(async ({ companyName, industry, description, repoUrl, files }) => {
    setLoading(true);
    setError('');
    setResult(null);
    const inputs = { companyName, industry };
    setLastInputs(inputs);

    try {
      const data = await generateValueChain(
        { companyName, industry, description, repoUrl, files },
        setProgress
      );
      setResult(data);
      saveSession(data, inputs);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err.message || 'An unexpected error occurred.');
    } finally {
      setLoading(false);
      setProgress('');
    }
  }, []);

  return (
    <div style={styles.app}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logo}>
            <div style={styles.logoMark}>
              <Icon d={ICONS.activity} size={18} />
            </div>
            <div>
              <div style={styles.logoTitle}>Business Architect AI</div>
              <div style={styles.logoSub}>Value Chain & Capability Mapper</div>
            </div>
          </div>
          <div style={styles.headerBadge}>FastAPI + Ollama</div>
        </div>
      </header>

      <main style={styles.main}>
        {!result ? (
          <div style={styles.inputSection}>
            {/* Hero */}
            <div style={styles.hero}>
              <h1 style={styles.heroTitle}>Generate Your Business<br /><span style={styles.heroAccent}>Value Chain</span></h1>
              <p style={styles.heroDesc}>
                AI-powered Value Chain Analysis and Level 2 Capability Mapping.<br />
                Python FastAPI backend + Ollama (llama3.2) — 100% local, no data leaves your machine.
              </p>
              <button
                style={styles.demoBtn}
                onClick={handleDemo}
                disabled={loading}
              >
                <Icon d={ICONS.sparkles} size={15} />
                <span style={{ marginLeft: 8 }}>Try Live Demo — HDFC Bank</span>
              </button>
            </div>

            {/* Ollama Status */}
            <OllamaStatus status={ollamaStatus} />

            {/* Form */}
            <div style={styles.formCard}>
              <InputForm onSubmit={handleSubmit} loading={loading} />
            </div>

            {/* Loading state */}
            {loading && (
              <div style={styles.loadingCard}>
                <div style={styles.loadingDots}>
                  {[0, 1, 2].map(i => (
                    <div key={i} style={{ ...styles.dot, animationDelay: `${i * 0.2}s` }} />
                  ))}
                </div>
                <p style={styles.loadingText}>{progress || 'Analyzing...'}</p>
                <p style={{ ...styles.loadingText, marginTop: 6, fontSize: 11, opacity: 0.6 }}>
                  {elapsed}s elapsed{elapsed > 30 ? ' — model is still generating, please wait' : ''}
                </p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div style={styles.errorCard}>
                <Icon d={ICONS.x} size={16} />
                <span style={{ marginLeft: 8 }}>{error}</span>
              </div>
            )}
          </div>
        ) : (
          <ResultView
            result={result}
            companyName={lastInputs.companyName}
            industry={lastInputs.industry}
            savedAt={savedAt}
            onReset={() => { clearSession(); setResult(null); setSavedAt(null); }}
          />
        )}
      </main>

      <footer style={styles.footer}>
        Business Architect AI — FastAPI backend + Ollama (llama3.2) · 100% local
      </footer>
    </div>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  app: { minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' },

  header: { borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 100, background: 'var(--bg)', backdropFilter: 'blur(12px)' },
  headerInner: { maxWidth: 1200, margin: '0 auto', padding: '14px 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo: { display: 'flex', alignItems: 'center', gap: 12 },
  logoMark: { width: 36, height: 36, borderRadius: 8, background: 'var(--accent)', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  logoTitle: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16, color: 'var(--text)' },
  logoSub: { fontSize: 11, color: 'var(--text-muted)', letterSpacing: 1 },
  headerBadge: { fontSize: 11, color: 'var(--accent)', background: 'var(--accent)1a', border: '1px solid var(--accent)33', padding: '3px 10px', borderRadius: 20, fontFamily: 'var(--font-mono)', letterSpacing: 1 },

  main: { flex: 1, maxWidth: 1200, margin: '0 auto', width: '100%', padding: '40px 24px' },

  inputSection: { maxWidth: 760, margin: '0 auto' },
  hero: { textAlign: 'center', marginBottom: 40 },
  heroEyebrow: { fontSize: 11, letterSpacing: 3, color: 'var(--accent)', fontFamily: 'var(--font-mono)', marginBottom: 12, textTransform: 'uppercase' },
  heroTitle: { fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 5vw, 52px)', fontWeight: 800, lineHeight: 1.1, marginBottom: 16, color: 'var(--text)' },
  heroAccent: { color: 'var(--accent)' },
  heroDesc: { fontSize: 15, color: 'var(--text-muted)', lineHeight: 1.7 },

  demoBtn: { marginTop: 24, display: 'inline-flex', alignItems: 'center', background: 'transparent', border: '1px solid var(--accent)66', color: 'var(--accent)', borderRadius: 24, padding: '10px 22px', fontSize: 13, fontFamily: 'var(--font-mono)', cursor: 'pointer', transition: 'all 0.15s', letterSpacing: 0.5 },

  formCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 16, padding: 28 },
  form: { display: 'flex', flexDirection: 'column', gap: 20 },
  formGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  fieldGroup: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', display: 'flex', alignItems: 'center' },
  required: { color: 'var(--accent)', marginLeft: 3 },
  optional: { color: 'var(--text-dim)', fontWeight: 400, marginLeft: 4 },
  input: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', color: 'var(--text)', fontSize: 14, outline: 'none', transition: 'border-color 0.15s', width: '100%' },
  select: { cursor: 'pointer' },

  dropzone: { border: '1px dashed var(--border)', borderRadius: 8, padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'center', cursor: 'pointer', transition: 'all 0.15s', color: 'var(--text-muted)' },
  dropzoneActive: { border: '1px dashed var(--accent)', background: 'var(--accent)0a' },
  fileList: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 },
  fileChip: { display: 'flex', alignItems: 'center', background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 10px', fontSize: 12, color: 'var(--text-muted)' },
  removeBtn: { background: 'none', border: 'none', color: 'var(--text-muted)', padding: '0 0 0 8px', display: 'flex', lineHeight: 1 },

  submitBtn: { background: 'var(--accent)', color: '#000', border: 'none', borderRadius: 10, padding: '14px 24px', fontSize: 15, fontWeight: 700, fontFamily: 'var(--font-display)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'opacity 0.15s, transform 0.15s', cursor: 'pointer' },
  submitBtnDisabled: { opacity: 0.45, cursor: 'not-allowed' },
  spinner: { width: 16, height: 16, border: '2px solid #00000033', borderTop: '2px solid #000', borderRadius: '50%', animation: 'spin 0.7s linear infinite' },

  loadingCard: { textAlign: 'center', padding: '32px', marginTop: 20 },
  loadingDots: { display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 12 },
  dot: { width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: 'pulse 1s ease-in-out infinite' },
  loadingText: { color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 },

  errorCard: { background: '#f05b5b11', border: '1px solid #f05b5b44', borderRadius: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', color: 'var(--error)', marginTop: 16, fontSize: 14 },

  // Result styles
  resultContainer: { display: 'flex', flexDirection: 'column', gap: 28 },
  resultHeader: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 16 },
  resultTitle: { fontFamily: 'var(--font-display)', fontSize: 26, fontWeight: 800, display: 'flex', alignItems: 'center', color: 'var(--text)' },
  industryPill: { marginLeft: 12, fontSize: 12, background: 'var(--accent2)22', color: 'var(--accent2)', border: '1px solid var(--accent2)44', padding: '2px 10px', borderRadius: 20, fontFamily: 'var(--font-mono)', letterSpacing: 0.5 },
  resultSubtitle: { color: 'var(--text-muted)', marginTop: 4, fontSize: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  expiryBadge: { fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--accent3)', background: 'var(--accent3)11', border: '1px solid var(--accent3)33', borderRadius: 20, padding: '2px 10px', letterSpacing: 0.3 },
  headerActions: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  exportBtn: { background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)', borderRadius: 7, padding: '7px 13px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'var(--font-mono)' },
  resetBtn: { color: 'var(--error)', borderColor: 'var(--error)44' },
  pdfBtn: { color: 'var(--accent)', borderColor: 'var(--accent)44' },

  // Context
  contextCard: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 22 },
  sectionTitle: { fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', marginBottom: 16, color: 'var(--text)' },
  contextGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  contextItem: { background: 'var(--surface2)', borderRadius: 8, padding: '12px 14px' },
  contextLabel: { fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-dim)', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 },
  contextValue: { fontSize: 14, color: 'var(--text)', lineHeight: 1.6 },
  insightList: { listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 },
  insightItem: { display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 14, color: 'var(--text-muted)' },
  insightDot: { width: 6, height: 6, borderRadius: '50%', background: 'var(--accent3)', marginTop: 6, flexShrink: 0 },

  // Arch diagram
  archContainer: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 22 },
  archDiagram: { background: 'var(--surface2)', borderRadius: 10, padding: 20, overflow: 'auto' },
  archLabel: { marginBottom: 12, marginTop: 8 },
  primaryFlow: { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  supportFlow: { display: 'flex', flexWrap: 'wrap', gap: 10 },
  archNode: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 14px', minWidth: 100, textAlign: 'center', flex: '0 0 auto' },
  supportNode: { flex: '1 1 120px' },
  archNodeBadge: { display: 'inline-block', padding: '1px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'var(--font-mono)', marginBottom: 5 },
  archNodeName: { fontSize: 12, fontWeight: 600, color: 'var(--text)', lineHeight: 1.3 },
  archNodeCount: { fontSize: 10, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' },
  archArrow: { flexShrink: 0 },
  archDivider: { height: 1, background: 'var(--border)', margin: '16px 0' },
  archStats: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' },
  statPill: { display: 'flex', alignItems: 'center', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 20, padding: '4px 12px', fontSize: 12, color: 'var(--text-muted)' },

  // Tabs
  tabs: { display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 0 },
  tab: { background: 'none', border: 'none', color: 'var(--text-muted)', padding: '10px 16px', fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, borderBottom: '2px solid transparent', transition: 'all 0.15s', fontFamily: 'var(--font-body)' },
  tabActive: { color: 'var(--accent)', borderBottomColor: 'var(--accent)' },
  tabBadge: { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 20, padding: '1px 7px', fontSize: 11, fontFamily: 'var(--font-mono)' },

  // Components
  componentList: { display: 'flex', flexDirection: 'column', gap: 14 },
  vcComponent: { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', transition: 'border-color 0.2s' },
  vcHeader: { padding: '16px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' },
  vcHeaderLeft: { display: 'flex', alignItems: 'flex-start', gap: 14, flex: 1, minWidth: 0 },
  vcBadge: { padding: '3px 9px', borderRadius: 5, fontSize: 11, fontFamily: 'var(--font-mono)', fontWeight: 700, flexShrink: 0, border: '1px solid' },
  vcName: { fontFamily: 'var(--font-display)', fontSize: 15, fontWeight: 700, color: 'var(--text)' },
  vcDesc: { fontSize: 13, color: 'var(--text-muted)', marginTop: 3, lineHeight: 1.4 },
  vcRight: { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  capCount: { fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' },
  capGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, padding: '0 18px 18px' },

  // Capability cards
  capCard: { background: 'var(--surface2)', border: '1px solid var(--border)', borderLeft: '3px solid', borderRadius: 6, padding: '12px 14px' },
  capId: { fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, marginBottom: 5, letterSpacing: 0.5 },
  capName: { fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 5 },
  capDesc: { fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 },

  footer: { textAlign: 'center', padding: '18px 24px', fontSize: 12, color: 'var(--text-dim)', borderTop: '1px solid var(--border)' },
};

// Inject CSS animations
const styleEl = document.createElement('style');
styleEl.textContent = `
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 100% { opacity: 0.3; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1); } }
input:focus, textarea:focus, select:focus { border-color: var(--accent) !important; }
button:hover:not(:disabled) { opacity: 0.85; }
`;
document.head.appendChild(styleEl);
