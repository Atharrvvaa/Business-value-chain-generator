// ─── Export Utilities ────────────────────────────────────────────────────────

export async function exportAsPDF(element, companyName) {
  const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: '#0a0a0f',
    logging: false,
  });

  const imgData = canvas.toDataURL('image/png');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

  const pdfWidth = pdf.internal.pageSize.getWidth();
  const pdfHeight = pdf.internal.pageSize.getHeight();
  const imgHeight = (canvas.height * pdfWidth) / canvas.width;

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
  heightLeft -= pdfHeight;

  while (heightLeft > 0) {
    position -= pdfHeight;
    pdf.addPage();
    pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, imgHeight);
    heightLeft -= pdfHeight;
  }

  pdf.save(`${slug(companyName)}-value-chain.pdf`);
}

export function exportAsJSON(result, companyName) {
  const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' });
  download(blob, `${slug(companyName)}-value-chain.json`);
}

export function exportAsMarkdown(result, companyName, industry) {
  let md = `# Business Value Chain & Capability Map\n`;
  md += `**Company:** ${companyName} | **Industry:** ${industry}\n\n`;
  md += `---\n\n`;
  md += `## Context Summary\n\n`;
  md += `**Value Proposition:** ${result.context.valueProposition}\n\n`;
  md += `**Business Model:** ${result.context.businessModel}\n\n`;
  md += `**Differentiation:** ${result.context.differentiation}\n\n`;
  md += `**Key Insights:**\n`;
  result.context.keyInsights.forEach(i => { md += `- ${i}\n`; });
  md += `\n---\n\n`;

  md += `## Primary Activities\n\n`;
  result.primaryActivities.forEach((a, idx) => {
    md += `### ${idx + 1}. ${a.name}\n`;
    md += `${a.description}\n\n`;
    md += `**Level 2 Capabilities:**\n`;
    a.capabilities.forEach(c => {
      md += `- **${c.name}:** ${c.description}\n`;
    });
    md += `\n`;
  });

  md += `## Support Functions\n\n`;
  result.supportFunctions.forEach((f, idx) => {
    md += `### ${idx + 1}. ${f.name}\n`;
    md += `${f.description}\n\n`;
    md += `**Level 2 Capabilities:**\n`;
    f.capabilities.forEach(c => {
      md += `- **${c.name}:** ${c.description}\n`;
    });
    md += `\n`;
  });

  const blob = new Blob([md], { type: 'text/markdown' });
  download(blob, `${slug(companyName)}-value-chain.md`);
}

export function exportAsCSV(result, companyName) {
  const rows = [['Type', 'Component ID', 'Component Name', 'Capability ID', 'Capability Name', 'Capability Description']];

  result.primaryActivities.forEach(a => {
    a.capabilities.forEach(c => {
      rows.push(['Primary Activity', a.id, a.name, c.id, c.name, c.description]);
    });
  });

  result.supportFunctions.forEach(f => {
    f.capabilities.forEach(c => {
      rows.push(['Support Function', f.id, f.name, c.id, c.name, c.description]);
    });
  });

  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  download(blob, `${slug(companyName)}-capabilities.csv`);
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
