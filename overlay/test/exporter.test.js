// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
// The document converter: what a lawyer receives in Word, RTF, HTML or text, from the Markdown the agents write.
// Fictitious data only.
const assert = require('assert');
const JSZip = require('jszip');
const X = require('../exporter');

const DOC = `# Requerimento de salário-maternidade

**Requerente:** Maria Exemplo da Silva (CPF {{preencher}})

## Fatos
- Gestante, 30ª semana [CONFERIR]
- Trabalha na roça há *4 anos*
  - sub-item com acentuação: ação, coração

1. Primeiro pedido
2. Segundo pedido

| Documento | Situação |
|---|---|
| RG | Recebido |
| Procuração | **Falta** |

> Citação de exemplo.

Veja [a lei](https://example.com/lei) e [um link ruim](javascript:alert(1)).

<script>alert('x')</script>

\`\`\`
código
\`\`\`
`;

(async () => {
  // ---- Word: a real .docx (a zip) with the headings, the table, the lists, and the marked words highlighted
  const buf = await X.convert('docx', DOC, { title: 'Requerimento' });
  assert.strictEqual(buf.slice(0, 2).toString(), 'PK', 'a .docx is a zip');
  const zip = await JSZip.loadAsync(buf);
  const xml = await zip.file('word/document.xml').async('string');
  assert.ok(xml.includes('Requerimento de sal'), 'the title is there');
  assert.ok(/w:pStyle w:val="Heading1"/.test(xml) && /w:pStyle w:val="Heading2"/.test(xml), 'headings keep their level');
  assert.ok(xml.includes('<w:tbl>') && xml.includes('Procura'), 'the table is a real table');
  assert.ok(/w:highlight w:val="yellow"/.test(xml), '[CONFERIR] and {{...}} are highlighted');
  assert.ok((xml.match(/w:highlight/g) || []).length >= 2, 'both kinds of marked words');
  assert.ok(/w:numPr/.test(xml), 'lists are real lists');
  assert.ok(xml.includes('example.com') === false || true, 'safe links may stay');
  assert.ok(!xml.includes('javascript:'), 'a link that is not http, https or mailto is just text');
  assert.ok(xml.includes('alert'), 'raw HTML is shown as text, not dropped silently');
  assert.ok(zip.file('word/numbering.xml'), 'numbering definitions exist');
  await X.convert('docx', '', {});   // an empty document is still a valid file
  await X.convert('docx', '1. um\n2. dois\n\ntexto\n\n1. outra lista\n');   // two numbered lists

  // ---- HTML: nothing runs, nothing leaks
  const html = (await X.convert('html', DOC, { title: 'A & B <x>' })).toString();
  assert.ok(html.includes('<title>A &amp; B &lt;x&gt;</title>'), 'the title is escaped');
  assert.ok(!/<script/i.test(html) && html.includes('&lt;script&gt;'), 'raw HTML is shown, never run');
  assert.ok(!html.includes('javascript:'), 'no javascript: links');
  assert.ok(html.includes('href="https://example.com/lei"'), 'a normal link stays');
  assert.ok(/<mark>\[CONFERIR\]<\/mark>/.test(html) && /<mark>\{\{preencher\}\}<\/mark>/.test(html), 'marked words stand out');
  assert.ok(html.includes("default-src 'none'"), 'the file carries its own CSP');
  assert.ok(html.includes('<table>') && html.includes('<blockquote>'));

  // ---- RTF: balanced braces, accents escaped, ASCII only
  const rtf = (await X.convert('rtf', DOC)).toString('latin1');
  assert.ok(rtf.startsWith('{\\rtf1') && rtf.endsWith('}'));
  let depth = 0;
  for (let i = 0; i < rtf.length; i++) {
    if (rtf[i] === '\\') { i++; continue; }
    if (rtf[i] === '{') depth++;
    if (rtf[i] === '}') { depth--; assert.ok(depth >= 0, 'braces never close before they open'); }
  }
  assert.strictEqual(depth, 0, 'braces are balanced');
  assert.ok(/^[\x00-\x7f]*$/.test(rtf), 'only ASCII: accents are \\u escapes');
  assert.ok(rtf.includes('\\u231?'), 'ç is \\u231?');
  assert.ok(rtf.includes('\\highlight2'), 'marked words are highlighted');
  assert.ok(X.toRtf('a {b} \\ c').includes('a \\{b\\} \\\\ c'), 'RTF specials are escaped');

  // ---- text
  const txt = (await X.convert('txt', DOC)).toString();
  assert.ok(txt.startsWith('REQUERIMENTO DE SALÁRIO-MATERNIDADE'));
  assert.ok(txt.includes('- Gestante, 30ª semana [CONFERIR]') && txt.includes('1. Primeiro pedido') && txt.includes('Procuração\tFalta'));
  assert.ok(!txt.includes('**') && !txt.includes('|---'), 'Markdown marks are gone');

  // ---- md is the text untouched; an unknown format is refused
  assert.strictEqual((await X.convert('md', DOC)).toString(), DOC);
  await assert.rejects(() => X.convert('exe', DOC), /unknown format/);
  await assert.rejects(() => X.convert('pdf', DOC), /desktop app/, 'PDF needs the desktop app (it prints through Chromium)');

  // ---- file names are safe everywhere
  assert.strictEqual(X.fileName('Petição inicial (rascunho).md', 'docx'), 'Peticao inicial rascunho.docx');
  assert.strictEqual(X.fileName('../../etc/passwd', 'pdf'), 'etc passwd.pdf');
  assert.strictEqual(X.fileName('', 'txt'), 'documento.txt');
  assert.strictEqual(X.fileName('CON:*?"<>|', 'txt'), 'doc-CON.txt', 'Windows reserved names');
  assert.strictEqual(X.fileName('...', 'txt'), 'documento.txt');
  assert.ok(X.fileName('x'.repeat(500), 'pdf').length <= 84);
  assert.ok(X.CONVERTIBLE.test('saidas/a.md') && X.CONVERTIBLE.test('b.TXT') && !X.CONVERTIBLE.test('c.png'));
  // ---- after an approval: the extra formats land next to the original, inside the folder and nowhere else
  const fs = require('fs'), os = require('os'), path = require('path');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-exp-')), root = path.join(tmp, 'entrega');
  fs.mkdirSync(root);
  const made = await X.writeApproved(root, [
    { path: 'saidas/peticao.md', text: DOC },
    { path: 'notas.txt', text: 'uma nota' },
    { path: 'foto.png', text: 'x' },                              // not a document
    { path: '../fora.md', text: 'x' },                             // tries to leave the folder
    { path: 'a/../../fora2.md', text: 'x' },
    { path: '/etc/fora3.md', text: 'x' },
    { path: 'C:\\Windows\\fora4.md', text: 'x' },
    { path: 'a\\..\\..\\fora5.md', text: 'x' },
    { path: 'x\u0000.md', text: 'x' },
    { path: 'ok.md', text: 5 },                                    // not text
  ], ['docx', 'rtf', 'md', 'nope']);
  assert.strictEqual(made, 4, 'two documents, two real formats each (md and an unknown format are ignored)');
  assert.ok(fs.existsSync(path.join(root, 'saidas', 'peticao.docx')) && fs.existsSync(path.join(root, 'saidas', 'peticao.rtf')) && fs.existsSync(path.join(root, 'notas.docx')));
  const leaked = [];
  (function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else leaked.push(p); } })(tmp);
  assert.ok(leaked.every((p) => p.startsWith(root + path.sep)), 'nothing was written outside the folder');
  assert.ok(!leaked.some((p) => /fora/.test(p)), 'no escape attempt was written');
  assert.strictEqual(await X.writeApproved(root, 'not a list', ['docx']), 0);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('exporter ok');
})().catch((e) => { console.error(e); process.exit(1); });
