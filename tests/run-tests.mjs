// ─── Automated Test Runner ────────────────────────────────────────────────────
// Run: node tests/run-tests.mjs
// Tests: prompt building, file extraction logic, export utilities, schema validation

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));

// ─── Tiny test framework ──────────────────────────────────────────────────────
let passed = 0, failed = 0, total = 0;

function test(name, fn) {
  total++;
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    failed++;
  }
}

function expect(val) {
  return {
    toBe: (expected) => { if (val !== expected) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(val)}`); },
    toEqual: (expected) => { if (JSON.stringify(val) !== JSON.stringify(expected)) throw new Error(`Objects not equal`); },
    toBeTruthy: () => { if (!val) throw new Error(`Expected truthy, got ${val}`); },
    toBeFalsy: () => { if (val) throw new Error(`Expected falsy, got ${val}`); },
    toContain: (s) => { if (!String(val).includes(s)) throw new Error(`Expected to contain "${s}"`); },
    toHaveLength: (n) => { if (val.length !== n) throw new Error(`Expected length ${n}, got ${val.length}`); },
    toBeGreaterThan: (n) => { if (val <= n) throw new Error(`Expected > ${n}, got ${val}`); },
    toBeInstanceOf: (cls) => { if (!(val instanceof cls)) throw new Error(`Expected instance of ${cls.name}`); },
  };
}

// ─── Inline implementations to test (no browser APIs needed) ─────────────────

function buildUserPrompt({ companyName, industry, description, repoUrl, fileContent }) {
  let prompt = `## ANALYSIS REQUEST\n\n`;
  prompt += `**Company:** ${companyName}\n`;
  prompt += `**Industry:** ${industry}\n`;
  if (description) prompt += `\n**Business Context:**\n${description}\n`;
  if (fileContent) prompt += `\n**Uploaded Document Content:**\n${fileContent}\n`;
  if (repoUrl) prompt += `\n**Knowledge Repository URL:** ${repoUrl}\n`;
  prompt += `\n## INSTRUCTIONS\n1. Perform deep context analysis\n4. Return ONLY the JSON object`;
  return prompt;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function validateResult(result) {
  const errors = [];
  if (!result.context) errors.push('Missing context');
  if (!result.context?.valueProposition) errors.push('Missing valueProposition');
  if (!Array.isArray(result.primaryActivities)) errors.push('primaryActivities must be array');
  if (!Array.isArray(result.supportFunctions)) errors.push('supportFunctions must be array');
  if (result.primaryActivities?.length < 3) errors.push('Need at least 3 primary activities');
  if (result.supportFunctions?.length < 2) errors.push('Need at least 2 support functions');
  result.primaryActivities?.forEach((a, i) => {
    if (!a.id || !a.name || !a.capabilities) errors.push(`PA[${i}] missing fields`);
    if (!Array.isArray(a.capabilities) || a.capabilities.length < 2) errors.push(`PA[${i}] needs 2+ capabilities`);
  });
  result.supportFunctions?.forEach((f, i) => {
    if (!f.id || !f.name || !f.capabilities) errors.push(`SF[${i}] missing fields`);
  });
  return errors;
}

function generateMarkdown(result, company, industry) {
  let md = `# Business Value Chain\n**Company:** ${company}\n\n`;
  md += `## Context\n${result.context.valueProposition}\n\n`;
  md += `## Primary Activities\n`;
  result.primaryActivities.forEach(a => {
    md += `### ${a.name}\n`;
    a.capabilities.forEach(c => { md += `- **${c.name}:** ${c.description}\n`; });
  });
  md += `## Support Functions\n`;
  result.supportFunctions.forEach(f => {
    md += `### ${f.name}\n`;
    f.capabilities.forEach(c => { md += `- **${c.name}:** ${c.description}\n`; });
  });
  return md;
}

function generateCSVRows(result) {
  const rows = [['Type', 'Component', 'Capability', 'Description']];
  result.primaryActivities.forEach(a => a.capabilities.forEach(c => rows.push(['Primary', a.name, c.name, c.description])));
  result.supportFunctions.forEach(f => f.capabilities.forEach(c => rows.push(['Support', f.name, c.name, c.description])));
  return rows;
}

// ─── Mock result for testing ──────────────────────────────────────────────────
const MOCK_RESULT = {
  context: {
    valueProposition: "India's leading digital-first bank delivering seamless omnichannel banking",
    businessModel: "Interest income on loans + fee income on transactions and advisory",
    differentiation: "Technology leadership and risk discipline vs PSU banks",
    keyInsights: ["75% digital transactions target", "Rural expansion via BCs", "Wealth cross-sell opportunity"]
  },
  primaryActivities: [
    {
      id: "PA1",
      name: "Customer Acquisition",
      description: "Attracting and onboarding retail, SME, and corporate customers",
      capabilities: [
        { id: "PA1-C1", name: "Digital Lead Management", description: "Capture and nurture leads from digital channels" },
        { id: "PA1-C2", name: "Branch Onboarding", description: "In-branch KYC and account opening" },
        { id: "PA1-C3", name: "Partner Channel Management", description: "Manage DSA and fintech partner relationships" }
      ]
    },
    {
      id: "PA2",
      name: "Product Origination",
      description: "Credit and deposit product underwriting and issuance",
      capabilities: [
        { id: "PA2-C1", name: "Credit Underwriting", description: "AI-assisted credit decisioning for loans" },
        { id: "PA2-C2", name: "Account Setup & KYC", description: "Regulatory-compliant customer identity verification" }
      ]
    },
    {
      id: "PA3",
      name: "Transaction Servicing",
      description: "Day-to-day banking operations across channels",
      capabilities: [
        { id: "PA3-C1", name: "Digital Payments Processing", description: "Real-time UPI, NEFT, IMPS transaction handling" },
        { id: "PA3-C2", name: "Branch & ATM Operations", description: "Physical channel cash and service operations" }
      ]
    }
  ],
  supportFunctions: [
    {
      id: "SF1",
      name: "Risk & Compliance",
      description: "Regulatory adherence, credit risk, and fraud prevention",
      capabilities: [
        { id: "SF1-C1", name: "Regulatory Reporting", description: "RBI compliance and statutory submissions" },
        { id: "SF1-C2", name: "Fraud Detection & Prevention", description: "Real-time transaction monitoring for fraud" }
      ]
    },
    {
      id: "SF2",
      name: "Technology & Digital",
      description: "Core banking platform, digital channels, and data infrastructure",
      capabilities: [
        { id: "SF2-C1", name: "Core Banking Management", description: "Reliability and evolution of CBS platform" },
        { id: "SF2-C2", name: "Digital Channel Engineering", description: "Mobile and netbanking product development" }
      ]
    }
  ]
};

// ─── TEST SUITES ──────────────────────────────────────────────────────────────

console.log('\n🏗️  Business Architect AI — Test Suite\n');
console.log('═'.repeat(50));

// Suite 1: Prompt Building
console.log('\n📝 Suite 1: Prompt Building\n');
test('builds prompt with required fields', () => {
  const p = buildUserPrompt({ companyName: 'HDFC Bank', industry: 'Banking' });
  expect(p).toContain('HDFC Bank');
  expect(p).toContain('Banking');
});
test('includes description when provided', () => {
  const p = buildUserPrompt({ companyName: 'X', industry: 'Y', description: 'digital bank' });
  expect(p).toContain('digital bank');
});
test('includes repoUrl when provided', () => {
  const p = buildUserPrompt({ companyName: 'X', industry: 'Y', repoUrl: 'https://example.com/caps' });
  expect(p).toContain('https://example.com/caps');
});
test('includes fileContent when provided', () => {
  const p = buildUserPrompt({ companyName: 'X', industry: 'Y', fileContent: '=== doc.pdf ===\nsome content' });
  expect(p).toContain('some content');
});
test('omits optional fields when not provided', () => {
  const p = buildUserPrompt({ companyName: 'X', industry: 'Y' });
  expect(p).toBeTruthy();
  expect(String(p).includes('undefined')).toBe(false);
});

// Suite 2: File Size Formatting
console.log('\n📁 Suite 2: File Utilities\n');
test('formats bytes correctly', () => { expect(formatFileSize(500)).toBe('500 B'); });
test('formats kilobytes correctly', () => { expect(formatFileSize(2048)).toBe('2.0 KB'); });
test('formats megabytes correctly', () => { expect(formatFileSize(2097152)).toBe('2.0 MB'); });
test('slugifies company name for export', () => { expect(slug('HDFC Bank Limited')).toBe('hdfc-bank-limited'); });
test('slugifies special characters', () => { expect(slug('Zomato & Blinkit!')).toBe('zomato-blinkit'); });

// Suite 3: Schema Validation
console.log('\n✅ Suite 3: Result Schema Validation\n');
test('validates correct mock result', () => {
  const errs = validateResult(MOCK_RESULT);
  expect(errs.length).toBe(0);
});
test('catches missing context', () => {
  const errs = validateResult({ primaryActivities: [], supportFunctions: [] });
  expect(errs.length).toBeGreaterThan(0);
});
test('catches empty primaryActivities', () => {
  const errs = validateResult({ context: { valueProposition: 'x' }, primaryActivities: [], supportFunctions: [{ id: 'SF1', name: 'x', capabilities: [{}, {}] }] });
  expect(errs.length).toBeGreaterThan(0);
});
test('catches PA with too few capabilities', () => {
  const bad = JSON.parse(JSON.stringify(MOCK_RESULT));
  bad.primaryActivities[0].capabilities = [{ id: 'x', name: 'y', description: 'z' }]; // only 1
  const errs = validateResult(bad);
  expect(errs.length).toBeGreaterThan(0);
});
test('result has correct total capability count', () => {
  const totalCaps = [...MOCK_RESULT.primaryActivities, ...MOCK_RESULT.supportFunctions]
    .reduce((s, c) => s + c.capabilities.length, 0);
  expect(totalCaps).toBeGreaterThan(5); // PA: 3+2+2=7, SF: 2+2=4 → 11 total
});

// Suite 4: Export Utilities
console.log('\n📤 Suite 4: Export Generation\n');
test('markdown contains company name', () => {
  const md = generateMarkdown(MOCK_RESULT, 'HDFC Bank', 'Banking');
  expect(md).toContain('HDFC Bank');
});
test('markdown contains all primary activities', () => {
  const md = generateMarkdown(MOCK_RESULT, 'X', 'Y');
  expect(md).toContain('Customer Acquisition');
  expect(md).toContain('Product Origination');
});
test('markdown contains support functions', () => {
  const md = generateMarkdown(MOCK_RESULT, 'X', 'Y');
  expect(md).toContain('Risk & Compliance');
});
test('CSV has header row', () => {
  const rows = generateCSVRows(MOCK_RESULT);
  expect(rows[0][0]).toBe('Type');
});
test('CSV has correct row count', () => {
  const rows = generateCSVRows(MOCK_RESULT);
  // header + all capabilities
  const capCount = [...MOCK_RESULT.primaryActivities, ...MOCK_RESULT.supportFunctions]
    .reduce((s, c) => s + c.capabilities.length, 0);
  expect(rows.length).toBe(capCount + 1); // +1 for header
});
test('CSV primary rows tagged correctly', () => {
  const rows = generateCSVRows(MOCK_RESULT);
  const paCount = MOCK_RESULT.primaryActivities.reduce((s, a) => s + a.capabilities.length, 0);
  const paRows = rows.slice(1).filter(r => r[0] === 'Primary');
  expect(paRows.length).toBe(paCount);
});

// Suite 5: Sample File Validation
console.log('\n📄 Suite 5: Sample File Validation\n');
test('HDFC Bank sample file exists and is readable', () => {
  const content = readFileSync(join(__dir, '../sample-files/hdfc-bank-profile.txt'), 'utf-8');
  expect(content).toContain('HDFC Bank');
  expect(content).toContain('Banking');
});
test('Zomato sample JSON is valid', () => {
  const raw = readFileSync(join(__dir, '../sample-files/zomato-profile.json'), 'utf-8');
  const data = JSON.parse(raw);
  expect(data.company).toContain('Zomato');
  expect(Array.isArray(data.keyProducts)).toBeTruthy();
});
test('Infosys CSV is parseable', () => {
  const content = readFileSync(join(__dir, '../sample-files/infosys-profile.csv'), 'utf-8');
  expect(content).toContain('Infosys');
  const lines = content.split('\n').filter(Boolean);
  expect(lines.length).toBeGreaterThan(5);
});



// Suite 6: Ollama-specific — JSON extraction robustness
console.log('\n🦙 Suite 6: Ollama JSON Extraction\n');

function extractJSON(raw) {
  const cleaned = raw.replace(/```json\s*/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('No JSON found');
  return cleaned.slice(start, end + 1);
}

const validJSON = '{"context":{"valueProposition":"test"},"primaryActivities":[],"supportFunctions":[]}';

test('extracts clean JSON as-is', () => {
  const result = extractJSON(validJSON);
  expect(result).toBe(validJSON);
});
test('strips ```json fences', () => {
  const result = extractJSON('```json\n' + validJSON + '\n```');
  expect(result).toBe(validJSON);
});
test('strips ``` fences without json label', () => {
  const result = extractJSON('```\n' + validJSON + '\n```');
  expect(result).toBe(validJSON);
});
test('handles prose before JSON', () => {
  const result = extractJSON('Here is the result:\n' + validJSON);
  expect(result).toBe(validJSON);
});
test('handles prose after JSON', () => {
  const result = extractJSON(validJSON + '\nI hope that helps!');
  expect(result).toBe(validJSON);
});
test('handles prose before and after JSON', () => {
  const result = extractJSON('Sure, here:\n' + validJSON + '\nLet me know!');
  expect(result).toBe(validJSON);
});
test('throws on empty string', () => {
  let threw = false;
  try { extractJSON(''); } catch { threw = true; }
  expect(threw).toBe(true);
});
test('throws on prose-only response', () => {
  let threw = false;
  try { extractJSON('I cannot provide that information.'); } catch { threw = true; }
  expect(threw).toBe(true);
});

// Summary update

// ─── Final Summary ────────────────────────────────────────────────────────────
console.log('\n' + '═'.repeat(50));
console.log(`\n📊 Results: ${passed}/${total} passed, ${failed} failed\n`);

if (failed > 0) {
  console.log('⚠️  Some tests failed. Review the errors above.\n');
  process.exit(1);
} else {
  console.log('🎉 All tests passed!\n');
  process.exit(0);
}
