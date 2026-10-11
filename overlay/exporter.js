// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
// Turns a document written in Markdown (what the agents produce) into the formats a lawyer actually uses: Word, PDF, HTML,
// RTF (opens in Word and WordPad) and plain text. Runs in the main process; nothing here talks to the network.
const { Marked } = require('marked');
const docx = require('docx');

const FORMATS = {
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  pdf: { ext: 'pdf', mime: 'application/pdf' },
  html: { ext: 'html', mime: 'text/html' },
  rtf: { ext: 'rtf', mime: 'application/rtf' },
  txt: { ext: 'txt', mime: 'text/plain' },
  md: { ext: 'md', mime: 'text/markdown' },
};
const CONVERTIBLE = /\.(md|markdown|txt)$/i;           // the files that make sense to convert
const MARK = /(\[CONFERIR[^\]]*\]|\{\{[^}]*\}\})/g;      // what the lawyer must still check or fill in: stands out in every format
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const safeHref = (h) => (/^(https?:|mailto:)/i.test(String(h || '').trim()) ? String(h).trim() : '');

// ---------------------------------------------------------------- HTML (also the source of the PDF)
function parser() {
  const m = new Marked({ gfm: true, breaks: false });
  m.use({
    renderer: {
      html(h) { return esc(typeof h === 'string' ? h : (h && h.text) || ''); },   // raw HTML in a document is shown, never run
      link(href, title, text) { const u = safeHref(href); return u ? `<a href="${esc(u)}">${text}</a>` : text; },
      image(href, title, text) { return esc(text || ''); },                        // no pictures from the network
    },
  });
  return m;
}
function markWords(html) {
  return html.split(/(<[^>]+>)/).map((part) => (part.startsWith('<') ? part : part.replace(MARK, '<mark>$1</mark>'))).join('');
}
function toHtml(md, { title = '', lang = 'pt-BR' } = {}) {
  const body = markWords(parser().parse(String(md || '')));
  return `<!doctype html>\n<html lang="${esc(lang)}"><head><meta charset="utf-8">\n<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">\n<title>${esc(title)}</title>\n<style>
  @page { size: A4; margin: 2.5cm 2.5cm 2.5cm 3cm; }
  body { font-family: "Times New Roman", Times, serif; font-size: 12pt; line-height: 1.5; color: #111; max-width: 17cm; margin: 2rem auto; padding: 0 1rem; }
  h1, h2, h3, h4 { font-family: "Times New Roman", Times, serif; line-height: 1.25; margin: 1.4em 0 .5em; }
  h1 { font-size: 16pt; text-align: center; } h2 { font-size: 14pt; } h3 { font-size: 12pt; }
  p { margin: 0 0 .8em; text-align: justify; }
  table { border-collapse: collapse; width: 100%; margin: .8em 0; } th, td { border: 1px solid #555; padding: 4px 8px; text-align: left; vertical-align: top; } th { background: #eee; }
  blockquote { margin: .8em 0; padding-left: 1em; border-left: 3px solid #999; color: #333; }
  code, pre { font-family: Consolas, "Courier New", monospace; font-size: 10.5pt; } pre { background: #f4f4f4; padding: .6em; white-space: pre-wrap; }
  mark { background: #fff2a8; padding: 0 2px; }
  hr { border: 0; border-top: 1px solid #999; margin: 1.2em 0; }
  @media print { body { margin: 0; max-width: none; padding: 0; } }
</style></head><body>\n${body}\n</body></html>\n`;
}

async function toPdf(md, opts, electron) {
  if (!electron || !electron.BrowserWindow) throw new Error('PDF needs the desktop app');
  const win = new electron.BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true, contextIsolation: true, offscreen: false } });
  try {
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(toHtml(md, opts)));
    return await win.webContents.printToPDF({ pageSize: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally { if (!win.isDestroyed()) win.destroy(); }
}

// ---------------------------------------------------------------- plain text
function lexer(md) { return parser().lexer(String(md || '')); }
function inlineText(tokens) {
  return (tokens || []).map((t) => (t.tokens ? inlineText(t.tokens) : t.type === 'br' ? '\n' : t.type === 'image' ? t.text || '' : t.text !== undefined ? t.text : t.raw || '')).join('');
}
function plainBlocks(tokens, depth = 0) {
  const out = [];
  const pad = '  '.repeat(depth);
  for (const t of tokens) {
    if (t.type === 'heading') out.push(inlineText(t.tokens).toUpperCase());
    else if (t.type === 'paragraph' || t.type === 'text') out.push(pad + inlineText(t.tokens || [t]));
    else if (t.type === 'list') {
      t.items.forEach((it, i) => {
        const head = it.tokens.filter((x) => x.type !== 'list'), nested = it.tokens.filter((x) => x.type === 'list');
        out.push(pad + (t.ordered ? `${(Number(t.start) || 1) + i}. ` : '- ') + head.map((x) => inlineText(x.tokens || [x])).join(' '));
        for (const n of nested) out.push(plainBlocks([n], depth + 1).join('\n'));
      });
    } else if (t.type === 'table') {
      out.push([t.header, ...t.rows].map((row) => row.map((c) => inlineText(c.tokens)).join('\t')).join('\n'));
    } else if (t.type === 'blockquote') out.push(plainBlocks(t.tokens, depth).map((x) => '> ' + x).join('\n'));
    else if (t.type === 'code') out.push(t.text);
    else if (t.type === 'hr') out.push('----------------------------------------');
    else if (t.type === 'html') out.push(t.text || '');
  }
  return out;
}
function toTxt(md) { return plainBlocks(lexer(md)).join('\n\n') + '\n'; }

// ---------------------------------------------------------------- RTF (opens in Word, WordPad, LibreOffice)
const rtfEsc = (s) => String(s).replace(/[\\{}]/g, (c) => '\\' + c).replace(/\n/g, '\\line ').replace(/\t/g, '\\tab ')
  .replace(/[^\x00-\x7f]/g, (c) => { const n = c.charCodeAt(0); return '\\u' + (n > 32767 ? n - 65536 : n) + '?'; });
function rtfInline(tokens, st = {}) {
  let out = '';
  for (const t of tokens || []) {
    if (t.type === 'strong') out += '{\\b ' + rtfInline(t.tokens, st) + '}';
    else if (t.type === 'em') out += '{\\i ' + rtfInline(t.tokens, st) + '}';
    else if (t.type === 'del') out += '{\\strike ' + rtfInline(t.tokens, st) + '}';
    else if (t.type === 'codespan') out += '{\\f1 ' + rtfEsc(t.text) + '}';
    else if (t.type === 'br') out += '\\line ';
    else if (t.tokens) out += rtfInline(t.tokens, st);
    else out += String(t.text !== undefined ? t.text : t.raw || '').split(MARK).map((p, i) => (i % 2 ? '{\\highlight2 ' + rtfEsc(p) + '}' : rtfEsc(p))).join('');
  }
  return out;
}
function rtfBlocks(tokens, depth = 0) {
  let out = '';
  const ind = depth ? `\\li${360 * depth} ` : '';
  for (const t of tokens) {
    if (t.type === 'heading') out += `\\pard\\sb240\\sa120\\keepn{\\b\\fs${t.depth === 1 ? 32 : t.depth === 2 ? 28 : 24} ${rtfInline(t.tokens)}}\\par\n`;
    else if (t.type === 'paragraph' || t.type === 'text') out += `\\pard${ind}\\sa160\\qj ${rtfInline(t.tokens || [t])}\\par\n`;
    else if (t.type === 'list') {
      t.items.forEach((it, i) => {
        const head = it.tokens.filter((x) => x.type !== 'list'), nested = it.tokens.filter((x) => x.type === 'list');
        out += `\\pard\\li${360 * (depth + 1)}\\fi-360\\sa80 ${t.ordered ? (Number(t.start) || 1) + i + '.' : '\\u8226?'}\\tab ${head.map((x) => rtfInline(x.tokens || [x])).join(' ')}\\par\n`;
        out += rtfBlocks(nested, depth + 1);
      });
    } else if (t.type === 'table') {
      for (const [ri, row] of [t.header, ...t.rows].entries()) {
        out += '\\trowd' + row.map((_, ci) => `\\clbrdrt\\brdrs\\clbrdrl\\brdrs\\clbrdrb\\brdrs\\clbrdrr\\brdrs\\cellx${Math.round(9000 * (ci + 1) / row.length)}`).join('')
          + row.map((c) => `\\pard\\intbl ${ri === 0 ? '{\\b ' : '{'}${rtfInline(c.tokens)}}\\cell`).join('') + '\\row\n';
      }
      out += '\\pard\\par\n';
    } else if (t.type === 'blockquote') out += rtfBlocks(t.tokens, depth + 1);
    else if (t.type === 'code') out += `\\pard\\sa160{\\f1 ${rtfEsc(t.text)}}\\par\n`;
    else if (t.type === 'hr') out += '\\pard\\brdrb\\brdrs\\par\n';
    else if (t.type === 'html') out += `\\pard ${rtfEsc(t.text || '')}\\par\n`;
  }
  return out;
}
function toRtf(md) {
  return '{\\rtf1\\ansi\\ansicpg1252\\deff0{\\fonttbl{\\f0\\froman Times New Roman;}{\\f1\\fmodern Courier New;}}{\\colortbl;\\red0\\green0\\blue0;\\red255\\green242\\blue168;}\\f0\\fs24\n'
    + rtfBlocks(lexer(md)) + '}';
}

// ---------------------------------------------------------------- Word
function dRuns(tokens, base = {}) {
  const out = [];
  for (const t of tokens || []) {
    if (t.type === 'strong') out.push(...dRuns(t.tokens, { ...base, bold: true }));
    else if (t.type === 'em') out.push(...dRuns(t.tokens, { ...base, italics: true }));
    else if (t.type === 'del') out.push(...dRuns(t.tokens, { ...base, strike: true }));
    else if (t.type === 'codespan') out.push(new docx.TextRun({ ...base, text: t.text, font: 'Courier New' }));
    else if (t.type === 'br') out.push(new docx.TextRun({ ...base, break: 1 }));
    else if (t.type === 'link') {
      const u = safeHref(t.href), inner = dRuns(t.tokens, { ...base, underline: {}, color: '1155CC' });
      out.push(u ? new docx.ExternalHyperlink({ link: u, children: inner }) : new docx.TextRun({ ...base, text: inlineText(t.tokens) }));
    } else if (t.tokens) out.push(...dRuns(t.tokens, base));
    else {
      const text = String(t.type === 'image' ? t.text || '' : t.text !== undefined ? t.text : t.raw || '');
      text.split(MARK).forEach((p, i) => { if (p) out.push(new docx.TextRun(i % 2 ? { ...base, text: p, highlight: 'yellow' } : { ...base, text: p })); });
    }
  }
  return out;
}
function dBlocks(tokens, ctx, level = 0) {
  const out = [];
  const HEADS = [null, docx.HeadingLevel.HEADING_1, docx.HeadingLevel.HEADING_2, docx.HeadingLevel.HEADING_3, docx.HeadingLevel.HEADING_4, docx.HeadingLevel.HEADING_5, docx.HeadingLevel.HEADING_6];
  for (const t of tokens) {
    if (t.type === 'heading') out.push(new docx.Paragraph({ heading: HEADS[Math.min(6, t.depth)], children: dRuns(t.tokens), keepNext: true, spacing: { before: 280, after: 120 }, alignment: t.depth === 1 ? docx.AlignmentType.CENTER : docx.AlignmentType.LEFT }));
    else if (t.type === 'paragraph' || t.type === 'text') out.push(new docx.Paragraph({ children: dRuns(t.tokens || [t]), spacing: { after: 160, line: 360 }, alignment: docx.AlignmentType.JUSTIFIED, indent: level ? { left: 720 * level } : undefined }));
    else if (t.type === 'list') {
      const ref = t.ordered ? 'num-' + ctx.lists.push(Number(t.start) || 1) : 'bullets';
      if (t.ordered) ctx.refs.push({ reference: ref, start: ctx.lists[ctx.lists.length - 1] });
      for (const it of t.items) {
        const head = it.tokens.filter((x) => x.type !== 'list'), nested = it.tokens.filter((x) => x.type === 'list');
        out.push(new docx.Paragraph({ children: head.flatMap((x) => dRuns(x.tokens || [x])), numbering: { reference: ref, level: Math.min(level, 3) }, spacing: { after: 80, line: 340 } }));
        out.push(...dBlocks(nested, ctx, level + 1));
      }
    } else if (t.type === 'table') {
      const cell = (c, head) => new docx.TableCell({ children: [new docx.Paragraph({ children: dRuns(c.tokens, head ? { bold: true } : {}), spacing: { after: 40 } })], shading: head ? { type: docx.ShadingType.CLEAR, fill: 'EEEEEE' } : undefined, margins: { top: 60, bottom: 60, left: 100, right: 100 } });
      out.push(new docx.Table({ width: { size: 100, type: docx.WidthType.PERCENTAGE }, rows: [t.header.map((c) => cell(c, true)), ...t.rows.map((r) => r.map((c) => cell(c, false)))].map((cells) => new docx.TableRow({ children: cells })) }));
      out.push(new docx.Paragraph({ children: [], spacing: { after: 120 } }));
    } else if (t.type === 'blockquote') out.push(...dBlocks(t.tokens, ctx, level + 1));
    else if (t.type === 'code') out.push(...String(t.text).split('\n').map((line) => new docx.Paragraph({ children: [new docx.TextRun({ text: line, font: 'Courier New', size: 21 })], spacing: { after: 0 } })), new docx.Paragraph({ children: [] }));
    else if (t.type === 'hr') out.push(new docx.Paragraph({ children: [], border: { bottom: { style: docx.BorderStyle.SINGLE, size: 6, color: '999999', space: 1 } }, spacing: { after: 160 } }));
    else if (t.type === 'html') out.push(new docx.Paragraph({ children: [new docx.TextRun({ text: String(t.text || '') })] }));
  }
  return out;
}
async function toDocx(md, { title = '' } = {}) {
  const ctx = { lists: [], refs: [] };
  const children = dBlocks(lexer(md), ctx);
  const level = (n) => ({ level: n, format: docx.LevelFormat.BULLET, text: ['•', '–', '•', '–'][n], alignment: docx.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 + 360 * n, hanging: 360 } } } });
  const num = (n) => ({ level: n, format: docx.LevelFormat.DECIMAL, text: `%${n + 1}.`, alignment: docx.AlignmentType.LEFT, style: { paragraph: { indent: { left: 720 + 360 * n, hanging: 360 } } } });
  const doc = new docx.Document({
    title: String(title).slice(0, 200), creator: 'Escritório Digital',
    styles: { default: { document: { run: { font: 'Times New Roman', size: 24 } } },
      paragraphStyles: [1, 2, 3, 4].map((n) => ({ id: 'Heading' + n, name: 'Heading ' + n, basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: 'Times New Roman', bold: true, size: [0, 32, 28, 24, 24][n], color: '000000' } })) },
    numbering: { config: [{ reference: 'bullets', levels: [0, 1, 2, 3].map(level) }, ...ctx.refs.map((r) => ({ reference: r.reference, levels: [0, 1, 2, 3].map((n) => (n === 0 ? { ...num(0), start: r.start } : num(n))) }))] },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1418, bottom: 1418, left: 1701, right: 1418 } } }, children: children.length ? children : [new docx.Paragraph({ children: [] })] }],
  });
  return docx.Packer.toBuffer(doc);
}

// ---------------------------------------------------------------- one door
async function convert(format, md, opts = {}, electron = null) {
  if (!FORMATS[format]) throw new Error('unknown format');
  const text = String(md == null ? '' : md);
  if (format === 'md') return Buffer.from(text, 'utf8');
  if (format === 'txt') return Buffer.from(toTxt(text), 'utf8');
  if (format === 'html') return Buffer.from(toHtml(text, opts), 'utf8');
  if (format === 'rtf') return Buffer.from(toRtf(text), 'ascii');
  if (format === 'docx') return toDocx(text, opts);
  return toPdf(text, opts, electron);
}
// a file name that is safe on every system, from a document's title
function fileName(title, ext) {
  const base = String(title || 'documento').replace(/\.[A-Za-z0-9]{1,8}$/, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9 ._-]+/g, ' ').replace(/\.{2,}/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 80).trim() || 'documento';
  return (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(base) ? 'doc-' + base : base) + '.' + ext;   // Windows refuses those names
}

// Writes the chosen formats of the approved documents next to the copy the office already made, inside `root` and nowhere else.
// `files` are { path, text } as the office reported them; a path that tries to leave `root` is skipped, not trusted.
async function writeApproved(root, files, formats, { lang = 'pt-BR' } = {}, electron = null) {
  const path = require('path'), fs = require('fs');
  const base = path.resolve(root);
  let made = 0;
  for (const f of (Array.isArray(files) ? files : []).slice(0, 50)) {
    if (!f || typeof f.path !== 'string' || typeof f.text !== 'string' || !CONVERTIBLE.test(f.path) || f.text.length > 2000000) continue;
    const rel = f.path.split('\\').join('/');
    if (rel.startsWith('/') || /^[A-Za-z]:/.test(rel) || rel.includes('\u0000') || rel.split('/').some((p) => p === '..' || p === '')) continue;
    for (const fmt of formats) {
      if (!FORMATS[fmt] || fmt === 'md') continue;
      const out = path.resolve(base, rel.replace(/\.[^./]+$/, '') + '.' + FORMATS[fmt].ext);
      if (!out.startsWith(base + path.sep)) continue;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, await convert(fmt, f.text, { title: path.basename(rel), lang }, electron));
      made++;
    }
  }
  return made;
}

module.exports = { FORMATS, CONVERTIBLE, convert, fileName, toHtml, toTxt, toRtf, toDocx, writeApproved };
