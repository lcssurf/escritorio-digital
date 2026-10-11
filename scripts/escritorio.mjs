#!/usr/bin/env node
// Escritório Digital: uma ferramenta só, igual no Windows, no Mac e no Linux (precisa só do Node 18+).
// Pensada para uma IA (o Claude) instalar e cuidar do escritório, mas serve para qualquer pessoa.
//
//   node scripts/escritorio.mjs verificar        o que está pronto e o que falta, com a correção de cada item
//   node scripts/escritorio.mjs construir        monta a imagem do escritório no Docker (demora alguns minutos)
//   node scripts/escritorio.mjs iniciar          liga (ou recria) o escritório      [--ca arquivo.pem] [--entregas pasta]
//   node scripts/escritorio.mjs equipe           instala a equipe pronta (5 coordenações e 16 especialistas)
//   node scripts/escritorio.mjs abrir            abre os bonecos na barra
//   node scripts/escritorio.mjs inicio on|off    abrir sozinho quando o computador ligar
//   node scripts/escritorio.mjs status           resumo de uma linha por item
//   node scripts/escritorio.mjs desinstalar --sim   remove o escritório (os dados ficam, salvo --apagar-dados)
//
// Cada comando é seguro de repetir. Saída em português, curta e sem jargão; erros dizem o que fazer.
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OVERLAY = path.join(ROOT, 'overlay');
const IMAGE = process.env.ESCRITORIO_IMAGE || 'escritorio-digital:dev';
const NAME = 'clodfarm';
const PORT = 8080;
const URL_BASE = `http://localhost:${PORT}`;
const win = process.platform === 'win32', mac = process.platform === 'darwin';

// no Mac, programas abertos pelo Finder não herdam o PATH do terminal: o Docker costuma estar nestes lugares
const EXTRA_PATH = ['/usr/local/bin', '/opt/homebrew/bin', '/Applications/Docker.app/Contents/Resources/bin'];
const ENV = { ...process.env, PATH: [process.env.PATH || '', ...EXTRA_PATH].join(path.delimiter) };

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', env: ENV, windowsHide: true, ...opts });
const ok = (m) => console.log('  ✔ ' + m);
const bad = (m, fix) => { console.log('  ✖ ' + m); if (fix) console.log('      → ' + fix); };
const say = (m) => console.log(m);
const flag = (name) => { const i = process.argv.indexOf('--' + name); return i < 0 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };

function documentsDir() {
  if (win) {
    const r = run('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('MyDocuments')"]);
    const d = (r.stdout || '').trim();
    if (d) return d;
  }
  return path.join(os.homedir(), 'Documents');
}
const exportDir = () => (typeof flag('entregas') === 'string' ? flag('entregas') : path.join(documentsDir(), 'Escritório Digital'));
const userDataDir = () => path.join(win ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')) : mac ? path.join(os.homedir(), 'Library', 'Application Support') : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')), 'escritorio-digital-overlay');

const docker = (args, opts) => run('docker', args, opts);
const dockerUp = () => docker(['info']).status === 0;
const hasImage = () => docker(['image', 'inspect', IMAGE]).status === 0;
const containerState = () => { const r = docker(['inspect', '-f', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}', NAME]); return r.status === 0 ? r.stdout.trim() : ''; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(pathname, { method = 'GET', body, token } = {}) {
  const res = await fetch(URL_BASE + pathname, {
    method, signal: AbortSignal.timeout(15000),
    headers: { 'X-Overlay-Token': token || '', 'X-Clodfarm': '1', 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch (_) { /* sem corpo */ }
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}
const overlayToken = () => { const r = docker(['exec', NAME, 'cat', '/workspace/.farm/overlay.token']); return r.status === 0 ? r.stdout.trim() : ''; };

// ---------------------------------------------------------------- verificar
async function verificar() {
  say('Verificando o Escritório Digital...\n');
  let all = true;
  const check = (cond, good, problem, fix) => { if (cond) ok(good); else { all = false; bad(problem, fix); } return cond; };

  const major = Number(process.versions.node.split('.')[0]);
  check(major >= 18, `Node ${process.versions.node}`, `Node ${process.versions.node} é antigo demais`, 'Instale o Node 18 ou mais novo (https://nodejs.org).');
  const hasDocker = docker(['--version']).status === 0;
  if (!check(hasDocker, 'Docker instalado', 'Docker não encontrado',
    win ? 'Instale com: winget install -e --id Docker.DockerDesktop (depois reinicie o computador se pedir).' : mac ? 'Instale com: brew install --cask docker (ou baixe o Docker Desktop em docker.com).' : 'Instale o Docker Engine (docs.docker.com/engine/install).')) return finish(all);
  if (!check(dockerUp(), 'Docker rodando', 'O Docker está instalado, mas não está rodando', 'Abra o Docker Desktop, aceite os termos se pedir e espere aparecer "Engine running".')) return finish(all);
  const img = check(hasImage(), `Imagem ${IMAGE} pronta`, `A imagem ${IMAGE} ainda não existe`, 'Rode: node scripts/escritorio.mjs construir');
  const st = containerState();
  const up = check(st.startsWith('running'), `Escritório ligado (${st})`, 'O escritório não está ligado', img ? 'Rode: node scripts/escritorio.mjs iniciar' : null);
  if (up) {
    try { await api('/api/me'); ok(`Painel no ar em ${URL_BASE}`); } catch (e) { all = false; bad('O painel não respondeu', 'Espere uns segundos e rode de novo; se persistir: docker logs clodfarm'); }
    const who = docker(['exec', NAME, 'clodfarm', 'whoami']).stdout || '';
    check(/loggedIn:\s*True/i.test(who), 'Conta Claude conectada', 'Falta entrar com a conta Claude', 'Rode num terminal: docker exec -it clodfarm clodfarm login  (abre um endereço; aprove e cole o código)');
    try {
      const team = await api('/api/team', { token: overlayToken() });
      check(team.length > 1, `Equipe instalada (${team.length} pessoas)`, 'A equipe ainda não foi instalada', 'Rode: node scripts/escritorio.mjs equipe');
    } catch (e) { all = false; bad('Não consegui ler a equipe: ' + e.message); }
    // um antivírus ou proxy que refaz o HTTPS faz o Claude de dentro do Docker reclamar de "certificado autoassinado"
    const iss = docker(['exec', NAME, 'sh', '-c', 'echo | openssl s_client -connect api.anthropic.com:443 -servername api.anthropic.com 2>/dev/null | openssl x509 -noout -issuer']).stdout || '';
    const suspect = /kaspersky|eset|avast|avg|bitdefender|zscaler|fortinet|cisco|symantec|mcafee|norton|sophos|bluecoat|netskope|proxy/i.test(iss);
    check(!suspect, 'Conexão segura com a Anthropic sem intermediários', `Algo no computador está refazendo o HTTPS (${iss.trim().replace(/^issuer=\s*/, '')})`,
      'Exporte o certificado desse programa (só a parte pública) e rode: node scripts/escritorio.mjs iniciar --ca caminho/do/certificado.pem');
  }
  check(fs.existsSync(path.join(OVERLAY, 'node_modules')), 'Bonecos instalados (overlay)', 'O overlay ainda não foi instalado', 'Rode: cd overlay && npm install');
  finish(all);
}
function finish(all) { say(all ? '\nTudo certo.' : '\nHá itens para resolver (acima).'); process.exitCode = all ? 0 : 1; }

// ---------------------------------------------------------------- construir
function construir() {
  if (!dockerUp()) return bad('O Docker não está rodando', 'Abra o Docker Desktop e tente de novo.');
  say('Montando a imagem do escritório (de 5 a 15 minutos na primeira vez)...');
  const r = run('docker', ['build', '-t', IMAGE, '.'], { cwd: ROOT, stdio: 'inherit' });
  if (r.status !== 0) {
    say('\nO build falhou. Se o erro falou de "certificate", "SSL" ou "self-signed", algo no computador (antivírus ou proxy) está refazendo o HTTPS.');
    say('Veja INSTALAR.md, seção "Antivírus que inspeciona HTTPS". Se o erro foi outro, rode de novo: o Docker reaproveita o que já baixou.');
    process.exitCode = 1;
  } else say('\nImagem pronta: ' + IMAGE);
}

// ---------------------------------------------------------------- iniciar
async function iniciar() {
  if (!dockerUp()) return bad('O Docker não está rodando', 'Abra o Docker Desktop e tente de novo.'), (process.exitCode = 1);
  if (!hasImage()) return bad(`A imagem ${IMAGE} não existe`, 'Rode antes: node scripts/escritorio.mjs construir'), (process.exitCode = 1);
  const entregas = exportDir();
  fs.mkdirSync(entregas, { recursive: true });
  const extra = [];
  const ca = flag('ca');
  if (typeof ca === 'string') {
    // só o certificado PÚBLICO da CA do antivírus/proxy vai para o volume; o Claude (Node) passa a confiar nele
    const abs = path.resolve(ca);
    if (!fs.existsSync(abs)) return bad('Arquivo de certificado não encontrado: ' + abs), (process.exitCode = 1);
    const r = docker(['run', '--rm', '--entrypoint', 'sh', '-v', 'clodfarm_workspace:/workspace', '-v', `${path.dirname(abs)}:/in:ro`, IMAGE, '-c', `mkdir -p /workspace/.farm && cp "/in/${path.basename(abs)}" /workspace/.farm/extra-ca.pem`]);
    if (r.status !== 0) return bad('Não consegui copiar o certificado para o volume: ' + (r.stderr || '').trim()), (process.exitCode = 1);
    extra.push('-e', 'NODE_EXTRA_CA_CERTS=/workspace/.farm/extra-ca.pem');
  } else if (docker(['run', '--rm', '--entrypoint', 'sh', '-v', 'clodfarm_workspace:/workspace', IMAGE, '-c', 'test -f /workspace/.farm/extra-ca.pem']).status === 0) {
    extra.push('-e', 'NODE_EXTRA_CA_CERTS=/workspace/.farm/extra-ca.pem');   // copiado numa vez anterior
  }
  docker(['rm', '-f', NAME]);
  const r = docker(['run', '-d', '--name', NAME, '--hostname', NAME, '--restart', 'unless-stopped', '-p', `127.0.0.1:${PORT}:8080`,
    '-e', `FARM_CONTAINER_NAME=${NAME}`, '-e', 'FARM_APPROVE_LANDING=1', '-e', 'FARM_EXPORT_DIR=/export', ...extra,
    '-v', 'clodfarm_claude-home:/home/farm/.claude', '-v', 'clodfarm_workspace:/workspace', '-v', `${entregas}:/export`, IMAGE]);
  if (r.status !== 0) return bad('Não consegui ligar o escritório: ' + (r.stderr || '').trim()), (process.exitCode = 1);
  say('Ligando...');
  for (let i = 0; i < 40; i++) { await sleep(2000); if (containerState().includes('healthy')) break; }
  const st = containerState();
  if (!st.includes('healthy')) return bad(`O escritório não ficou saudável (${st})`, 'Veja: docker logs clodfarm'), (process.exitCode = 1);
  ok(`Escritório no ar em ${URL_BASE}`);
  ok(`Entregas aprovadas ficam em: ${entregas}`);
  const who = docker(['exec', NAME, 'clodfarm', 'whoami']).stdout || '';
  if (!/loggedIn:\s*True/i.test(who)) say('\nFalta entrar com a conta Claude. Rode num terminal:\n  docker exec -it clodfarm clodfarm login\nEle mostra um endereço: abra, aprove e cole o código de volta.');
}

// ---------------------------------------------------------------- equipe
async function equipe() {
  const token = overlayToken();
  if (!token) return bad('O escritório não está ligado', 'Rode: node scripts/escritorio.mjs iniciar'), (process.exitCode = 1);
  const pack = createRequire(import.meta.url)(path.join(OVERLAY, 'renderer', 'pack-previdenciario.js'));
  let list = await api('/api/team', { token });
  const find = (m) => list.find((x) => x.name === m.name && (x.title || '') === (m.title || ''));
  const send = async (body) => { list = await api('/api/team', { method: 'POST', body, token }); };
  const chief = list.find((x) => x.id === 'chief');
  if (chief && !chief.instructions) await send({ ...chief, instructions: pack.chief });
  const leadId = {};
  for (const l of pack.leads) {
    const { key, team, ...body } = l; const cur = find(l);
    await send({ ...body, lead: true, parent: 'chief', ...(cur ? { id: cur.id } : {}) });
    leadId[key] = find(l).id;
  }
  for (const m of pack.members) {
    const { team, ...body } = m; const cur = find(m);
    await send({ ...body, lead: false, parent: leadId[team], ...(cur ? { id: cur.id } : {}) });
  }
  ok(`Equipe pronta: ${list.length} pessoas (a chefe, ${pack.leads.length} coordenações e ${pack.members.length} especialistas)`);
}

// ---------------------------------------------------------------- abrir / início automático
function abrir() {
  if (!fs.existsSync(path.join(OVERLAY, 'node_modules'))) {
    say('Instalando os bonecos (primeira vez)...');
    const r = run(win ? 'npm.cmd' : 'npm', ['install', '--no-audit', '--no-fund'], { cwd: OVERLAY, stdio: 'inherit', shell: win });
    if (r.status !== 0) return bad('npm install falhou'), (process.exitCode = 1);
  }
  const bin = path.join(OVERLAY, 'node_modules', '.bin', win ? 'electron.cmd' : 'electron');
  const p = spawn(bin, ['.'], { cwd: OVERLAY, detached: true, stdio: 'ignore', env: ENV, shell: win, windowsHide: true });
  p.unref();
  ok('Bonecos abertos: procure-os sobre a barra de tarefas (ou o Dock) e o ícone perto do relógio.');
}

function inicio(modo) {
  if (!['on', 'off'].includes(modo)) return bad('Use: inicio on   ou   inicio off');
  const bin = path.join(OVERLAY, 'node_modules', '.bin', win ? 'electron.cmd' : 'electron');
  if (win) {
    const vbs = path.join(OVERLAY, 'Escritorio-Digital.vbs');
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const r = modo === 'on' ? run('reg', ['add', key, '/v', 'EscritorioDigital', '/t', 'REG_SZ', '/d', `wscript.exe "${vbs}"`, '/f']) : run('reg', ['delete', key, '/v', 'EscritorioDigital', '/f']);
    return r.status === 0 ? ok(`Início automático ${modo === 'on' ? 'ligado' : 'desligado'}`) : bad('Não consegui alterar: ' + (r.stderr || '').trim());
  }
  if (mac) {
    const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.escritoriodigital.overlay.plist');
    if (modo === 'off') { run('launchctl', ['unload', plist]); fs.rmSync(plist, { force: true }); return ok('Início automático desligado'); }
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.escritoriodigital.overlay</string>\n<key>ProgramArguments</key><array><string>${bin}</string><string>.</string></array>\n<key>WorkingDirectory</key><string>${OVERLAY}</string>\n<key>EnvironmentVariables</key><dict><key>PATH</key><string>${ENV.PATH}</string></dict>\n<key>RunAtLoad</key><true/>\n</dict></plist>\n`);
    run('launchctl', ['load', plist]);
    return ok('Início automático ligado');
  }
  const desk = path.join(os.homedir(), '.config', 'autostart', 'escritorio-digital.desktop');
  if (modo === 'off') { fs.rmSync(desk, { force: true }); return ok('Início automático desligado'); }
  fs.mkdirSync(path.dirname(desk), { recursive: true });
  fs.writeFileSync(desk, `[Desktop Entry]\nType=Application\nName=Escritório Digital\nExec=${bin} .\nPath=${OVERLAY}\n`);
  ok('Início automático ligado');
}

// ---------------------------------------------------------------- status / desinstalar
async function status() {
  const st = dockerUp() ? containerState() || 'não criado' : 'Docker parado';
  say(`Docker/escritório: ${st}`);
  try { const t = await api('/api/team', { token: overlayToken() }); say(`Equipe: ${t.length} pessoas`); } catch (_) { say('Equipe: indisponível'); }
  say(`Entregas: ${exportDir()}`);
  say(`Bonecos instalados: ${fs.existsSync(path.join(OVERLAY, 'node_modules')) ? 'sim' : 'não'}`);
}

function desinstalar() {
  if (!flag('sim')) return say('Isto desliga e remove o escritório do Docker. Para confirmar, rode de novo com --sim.\nOs dados (login e trabalhos) ficam nos volumes do Docker, a menos que você use também --apagar-dados.');
  docker(['rm', '-f', NAME]);
  ok('Escritório removido do Docker');
  if (flag('apagar-dados')) { docker(['volume', 'rm', 'clodfarm_claude-home', 'clodfarm_workspace']); ok('Dados apagados (login e trabalhos dentro do Docker). A pasta de entregas no seu computador não foi tocada.'); }
}

const cmd = process.argv[2];
const table = { verificar, construir, iniciar, equipe, abrir, status, desinstalar, inicio: () => inicio(process.argv[3]) };
if (!table[cmd]) {
  say('Uso: node scripts/escritorio.mjs <verificar | construir | iniciar | equipe | abrir | inicio on|off | status | desinstalar>');
  process.exitCode = cmd ? 2 : 0;
} else {
  Promise.resolve(table[cmd]()).catch((e) => { bad(e.message || String(e)); process.exitCode = 1; });
}
