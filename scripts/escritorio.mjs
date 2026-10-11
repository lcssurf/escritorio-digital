#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
// EscritÃ³rio Digital: uma ferramenta sÃ³, igual no Windows, no Mac e no Linux (precisa sÃ³ do Node 18+).
// Pensada para uma IA (o Claude) instalar e cuidar do escritÃ³rio, mas serve para qualquer pessoa.
//
//   node scripts/escritorio.mjs instalar         TUDO: prepara, liga, instala a equipe e abre os bonecos (pode repetir)
//
// Os passos, se vocÃª quiser um por vez:
//   verificar    o que estÃ¡ pronto e o que falta, com a correÃ§Ã£o de cada item
//   construir    baixa a nossa imagem do GitHub (de 2 a 4 minutos); --completo monta tudo do zero (5 a 15 min) [--ca arquivo.pem]
//   iniciar      liga (ou recria) o escritÃ³rio      [--ca arquivo.pem] [--entregas pasta]
//   equipe       instala a equipe pronta (5 coordenaÃ§Ãµes e 16 especialistas)
//   abrir        abre os bonecos na barra
//   inicio on|off   abrir sozinho quando o computador ligar
//   status       resumo
//   desinstalar --sim   remove o escritÃ³rio (os dados ficam, salvo --apagar-dados)
//
// CÃ³digos de saÃ­da: 0 tudo certo; 1 falhou (a mensagem diz o que fazer); 3 falta um passo que sÃ³ a pessoa pode fazer
// (entrar com a conta Claude): ela faz e vocÃª roda o mesmo comando de novo.
import { spawnSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OVERLAY = path.join(ROOT, 'overlay');
// A nossa imagem completa (Claude Code, Node, Chromium e o nosso cÃ³digo), publicada no GitHub. A instalaÃ§Ã£o sÃ³ baixa isso.
// Para montar do zero no prÃ³prio computador: construir --completo (usa o Dockerfile deste projeto).
const IMAGE = process.env.ESCRITORIO_IMAGE || 'ghcr.io/lcssurf/escritorio-digital:1.0.3';
const REGISTRY_USER = 'lcssurf';
const NAME = 'clodfarm';
const PORT = 8080;
const URL_BASE = `http://localhost:${PORT}`;
const win = process.platform === 'win32', mac = process.platform === 'darwin';

// no Mac, programas abertos pelo Finder nÃ£o herdam o PATH do terminal: o Docker costuma estar nestes lugares
const EXTRA_PATH = ['/usr/local/bin', '/opt/homebrew/bin', '/Applications/Docker.app/Contents/Resources/bin'];
const ENV = { ...process.env, PATH: [process.env.PATH || '', ...EXTRA_PATH].join(path.delimiter) };

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', env: ENV, windowsHide: true, ...opts });
const say = (m) => console.log(m);
const ok = (m) => { console.log('  âœ” ' + m); return true; };
const bad = (m, fix) => { console.log('  âœ– ' + m); if (fix) console.log('      â†’ ' + fix); return false; };
const flag = (name) => { const i = process.argv.indexOf('--' + name); return i < 0 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NEEDS_PERSON = 3;

function documentsDir() {
  if (win) {
    const r = run('powershell', ['-NoProfile', '-Command', "[Environment]::GetFolderPath('MyDocuments')"]);
    const d = (r.stdout || '').trim();
    if (d) return d;
  }
  return path.join(os.homedir(), 'Documents');
}
const exportDir = () => (typeof flag('entregas') === 'string' ? flag('entregas') : path.join(documentsDir(), 'EscritÃ³rio Digital'));

const docker = (args, opts) => run('docker', args, opts);
const dockerUp = () => docker(['info']).status === 0;
const hasImage = () => docker(['image', 'inspect', IMAGE]).status === 0;
const containerState = () => { const r = docker(['inspect', '-f', '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}', NAME]); return r.status === 0 ? r.stdout.trim() : ''; };
const isLoggedIn = () => /loggedIn:\s*True/i.test(docker(['exec', NAME, 'clodfarm', 'whoami']).stdout || '');
const dockerHelp = () => (win ? 'Instale com: winget install -e --id Docker.DockerDesktop (reinicie o computador se pedir).' : mac ? 'Instale com: brew install --cask docker (ou baixe o Docker Desktop em docker.com).' : 'Instale o Docker Engine (docs.docker.com/engine/install).');

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
  say('Verificando o EscritÃ³rio Digital...\n');
  let all = true;
  const check = (cond, good, problem, fix) => { if (cond) ok(good); else { all = false; bad(problem, fix); } return cond; };

  const major = Number(process.versions.node.split('.')[0]);
  check(major >= 18, `Node ${process.versions.node}`, `Node ${process.versions.node} Ã© antigo demais`, 'Instale o Node 18 ou mais novo (https://nodejs.org).');
  if (!check(docker(['--version']).status === 0, 'Docker instalado', 'Docker nÃ£o encontrado', dockerHelp())) return fim(all);
  if (!check(dockerUp(), 'Docker rodando', 'O Docker estÃ¡ instalado, mas nÃ£o estÃ¡ rodando', 'Abra o Docker Desktop, aceite os termos se pedir e espere aparecer "Engine running".')) return fim(all);
  const img = check(hasImage(), `Imagem ${IMAGE} pronta`, `A imagem ${IMAGE} ainda nÃ£o existe`, 'Rode: node scripts/escritorio.mjs construir');
  const st = containerState();
  const up = check(st.startsWith('running'), `EscritÃ³rio ligado (${st})`, 'O escritÃ³rio nÃ£o estÃ¡ ligado', img ? 'Rode: node scripts/escritorio.mjs iniciar' : null);
  if (up) {
    try { await api('/api/me'); ok(`Painel no ar em ${URL_BASE}`); } catch (e) { all = false; bad('O painel nÃ£o respondeu', 'Espere uns segundos e rode de novo; se persistir: docker logs clodfarm'); }
    check(isLoggedIn(), 'Conta Claude conectada', 'Falta entrar com a conta Claude', 'Rode num terminal: docker exec -it clodfarm clodfarm login  (abre um endereÃ§o; aprove e cole o cÃ³digo)');
    try {
      const team = await api('/api/team', { token: overlayToken() });
      check(team.length > 1, `Equipe instalada (${team.length} pessoas)`, 'A equipe ainda nÃ£o foi instalada', 'Rode: node scripts/escritorio.mjs equipe');
    } catch (e) { all = false; bad('NÃ£o consegui ler a equipe: ' + e.message); }
    // um antivÃ­rus ou proxy que refaz o HTTPS faz o Claude de dentro do Docker reclamar de "certificado autoassinado"
    const iss = docker(['exec', NAME, 'sh', '-c', 'echo | openssl s_client -connect api.anthropic.com:443 -servername api.anthropic.com 2>/dev/null | openssl x509 -noout -issuer']).stdout || '';
    const suspect = /kaspersky|eset|avast|avg|bitdefender|zscaler|fortinet|cisco|symantec|mcafee|norton|sophos|bluecoat|netskope|proxy/i.test(iss);
    const trusted = docker(['exec', NAME, 'sh', '-c', 'test -f /workspace/.farm/extra-ca.pem']).status === 0;
    check(!suspect || trusted, suspect ? 'Certificado de antivÃ­rus/proxy jÃ¡ Ã© aceito pelo escritÃ³rio' : 'ConexÃ£o segura com a Anthropic sem intermediÃ¡rios',
      `Algo no computador estÃ¡ refazendo o HTTPS (${iss.trim().replace(/^issuer=\s*/, '')})`,
      'Exporte o certificado desse programa (sÃ³ a parte pÃºblica) e rode: node scripts/escritorio.mjs iniciar --ca caminho/do/certificado.pem');
  }
  check(fs.existsSync(path.join(OVERLAY, 'node_modules')), 'Bonecos instalados (overlay)', 'O overlay ainda nÃ£o foi instalado', 'Rode: node scripts/escritorio.mjs abrir');
  return fim(all);
}
function fim(all) { say(all ? '\nTudo certo.' : '\nHÃ¡ itens para resolver (acima).'); return all; }

// ---------------------------------------------------------------- construir
// O pacote Ã© privado enquanto o projeto for. O GitHub NÃƒO aceita o token do "gh" para baixar pacotes: sÃ³ um token
// pessoal "clÃ¡ssico" com a permissÃ£o read:packages, usado no "docker login". Isso Ã© feito pela pessoa (nunca digitamos token).
const TOKEN_URL = 'https://github.com/settings/tokens/new?scopes=read:packages&description=Escritorio+Digital';

function construir() {
  if (!dockerUp()) return bad('O Docker nÃ£o estÃ¡ rodando', 'Abra o Docker Desktop e tente de novo.');
  if (flag('completo')) {
    say('Montando tudo do zero (de 5 a 15 minutos)...');
    const args = ['build', '-t', IMAGE];
    const ca = flag('ca');
    if (typeof ca === 'string') args.push('--secret', `id=extra_ca,src=${path.resolve(ca)}`);   // sÃ³ vale durante a montagem; nÃ£o fica na imagem
    const r = run('docker', [...args, '.'], { cwd: ROOT, stdio: 'inherit' });
    if (r.status !== 0) { say('\nA montagem falhou. Se o erro falou de "certificate", "SSL" ou "self-signed", repita com: construir --completo --ca caminho/do/certificado.pem (veja INSTALAR.md, "AntivÃ­rus que inspeciona HTTPS").'); return false; }
    return ok('Imagem pronta: ' + IMAGE);
  }
  say('Baixando a imagem do escritÃ³rio (de 2 a 4 minutos na primeira vez; guardo o que jÃ¡ baixei)...');
  const pull = run('docker', ['pull', IMAGE], { encoding: 'utf8' });
  if (pull.status !== 0) {
    const out = ((pull.stderr || '') + (pull.stdout || '')).trim().split('\n').slice(-3).join(' | ');
    if (/unauthorized|denied|authentication required|not found|manifest unknown/i.test(out)) {
      say('\nðŸ§ O pacote do escritÃ³rio Ã© privado: o Docker precisa entrar no GitHub (sÃ³ vocÃª pode fazer, eu nÃ£o vejo o token):');
      say(`   1. Abra ${TOKEN_URL}`);
      say('      (jÃ¡ vem com a permissÃ£o read:packages; escolha "30 days" e clique em "Generate token"; copie o texto ghp_...)');
      say('   2. Num terminal rode:  docker login ghcr.io -u SEU_USUARIO_DO_GITHUB   e cole o token quando pedir a senha.');
      say('   3. Rode de novo o mesmo comando.');
      say('   (Sem acesso ao pacote? Alternativa: construir --completo, que monta tudo do zero neste computador.)');
      return bad('Falta autorizar o Docker no GitHub (cÃ³digo 3)') && false || NEEDS_PERSON;
    }
    return bad('NÃ£o consegui baixar a imagem: ' + out, 'Se o erro falar de certificado, veja INSTALAR.md ("AntivÃ­rus que inspeciona HTTPS"). Alternativa: construir --completo');
  }
  const info = docker(['image', 'inspect', IMAGE, '--format', '{{.Id}}']);
  if (info.status !== 0) return bad('A imagem nÃ£o apareceu depois do download', 'Rode de novo.');
  return ok('Imagem pronta: ' + IMAGE);
}

// ---------------------------------------------------------------- iniciar
async function iniciar() {
  if (!dockerUp()) return bad('O Docker nÃ£o estÃ¡ rodando', 'Abra o Docker Desktop e tente de novo.');
  if (!hasImage()) return bad(`A imagem ${IMAGE} nÃ£o existe`, 'Rode antes: node scripts/escritorio.mjs construir');
  const entregas = exportDir();
  fs.mkdirSync(entregas, { recursive: true });
  const extra = [];
  const ca = flag('ca');
  if (typeof ca === 'string') {
    // sÃ³ o certificado PÃšBLICO da CA do antivÃ­rus/proxy vai para o volume; o Claude (Node) passa a confiar nele
    const abs = path.resolve(ca);
    if (!fs.existsSync(abs)) return bad('Arquivo de certificado nÃ£o encontrado: ' + abs);
    const r = docker(['run', '--rm', '--entrypoint', 'sh', '-v', 'clodfarm_workspace:/workspace', '-v', `${path.dirname(abs)}:/in:ro`, IMAGE, '-c', `mkdir -p /workspace/.farm && cp "/in/${path.basename(abs)}" /workspace/.farm/extra-ca.pem`]);
    if (r.status !== 0) return bad('NÃ£o consegui copiar o certificado para o volume: ' + (r.stderr || '').trim());
    extra.push('-e', 'NODE_EXTRA_CA_CERTS=/workspace/.farm/extra-ca.pem');
  } else if (docker(['run', '--rm', '--entrypoint', 'sh', '-v', 'clodfarm_workspace:/workspace', IMAGE, '-c', 'test -f /workspace/.farm/extra-ca.pem']).status === 0) {
    extra.push('-e', 'NODE_EXTRA_CA_CERTS=/workspace/.farm/extra-ca.pem');   // copiado numa vez anterior
  }
  docker(['rm', '-f', NAME]);
  const r = docker(['run', '-d', '--name', NAME, '--hostname', NAME, '--restart', 'unless-stopped', '-p', `127.0.0.1:${PORT}:8080`,
    '-e', `FARM_CONTAINER_NAME=${NAME}`, '-e', 'FARM_APPROVE_LANDING=1', '-e', 'FARM_EXPORT_DIR=/export', ...extra,
    '-v', 'clodfarm_claude-home:/home/farm/.claude', '-v', 'clodfarm_workspace:/workspace', '-v', `${entregas}:/export`, IMAGE]);
  if (r.status !== 0) return bad('NÃ£o consegui ligar o escritÃ³rio: ' + (r.stderr || '').trim(), 'Se a porta 8080 estiver ocupada, feche o programa que a usa.');
  say('Ligando...');
  for (let i = 0; i < 40; i++) { await sleep(2000); if (containerState().includes('healthy')) break; }
  const st = containerState();
  if (!st.includes('healthy')) return bad(`O escritÃ³rio nÃ£o ficou saudÃ¡vel (${st})`, 'Veja: docker logs clodfarm');
  ok(`EscritÃ³rio no ar em ${URL_BASE}`);
  ok(`Entregas aprovadas ficam em: ${entregas}`);
  return true;
}

// ---------------------------------------------------------------- login (sÃ³ a pessoa pode fazer)
function login() {
  if (isLoggedIn()) return ok('Conta Claude jÃ¡ conectada');
  const how = 'docker exec -it clodfarm clodfarm login';
  if (process.stdin.isTTY && process.stdout.isTTY) {
    say('\nAgora entre com a sua conta Claude. Vai aparecer um endereÃ§o: abra no navegador, aprove e cole o cÃ³digo aqui.\n');
    spawnSync('docker', ['exec', '-it', NAME, 'clodfarm', 'login'], { stdio: 'inherit', env: ENV });
    if (isLoggedIn()) return ok('Conta Claude conectada');
  }
  say(`\nðŸ§ Falta entrar com a conta Claude (sÃ³ vocÃª pode fazer). Rode num terminal:\n    ${how}\n  Ele mostra um endereÃ§o: abra no navegador, aprove e cole o cÃ³digo de volta.\n  Depois rode o mesmo comando de novo: ele continua de onde parou.`);
  return NEEDS_PERSON;
}

// ---------------------------------------------------------------- equipe
async function equipe() {
  const token = overlayToken();
  if (!token) return bad('O escritÃ³rio nÃ£o estÃ¡ ligado', 'Rode: node scripts/escritorio.mjs iniciar');
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
  return ok(`Equipe pronta: ${list.length} pessoas (a chefe, ${pack.leads.length} coordenaÃ§Ãµes e ${pack.members.length} especialistas)`);
}

// ---------------------------------------------------------------- abrir / inÃ­cio automÃ¡tico
function abrir() {
  if (!fs.existsSync(path.join(OVERLAY, 'node_modules'))) {
    say('Instalando os bonecos (primeira vez, de 1 a 2 minutos)...');
    const r = run('npm install --no-audit --no-fund', [], { cwd: OVERLAY, stdio: 'inherit', shell: true });
    if (r.status !== 0) return bad('npm install falhou', 'Confira a internet e rode de novo.');
  }
  // o prÃ³prio Node abre o Electron (sem passar por um shell): igual em qualquer sistema
  const p = spawn(process.execPath, [path.join(OVERLAY, 'node_modules', 'electron', 'cli.js'), '.'], { cwd: OVERLAY, detached: true, stdio: 'ignore', env: ENV, windowsHide: true });
  p.unref();
  return ok('Bonecos abertos: procure-os sobre a barra de tarefas (ou o Dock) e o Ã­cone perto do relÃ³gio.');
}

function inicio(modo) {
  if (!['on', 'off'].includes(modo)) return bad('Use: inicio on   ou   inicio off');
  const bin = path.join(OVERLAY, 'node_modules', '.bin', win ? 'electron.cmd' : 'electron');
  if (win) {
    const vbs = path.join(OVERLAY, 'Escritorio-Digital.vbs');
    const key = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
    const r = modo === 'on' ? run('reg', ['add', key, '/v', 'EscritorioDigital', '/t', 'REG_SZ', '/d', `wscript.exe "${vbs}"`, '/f']) : run('reg', ['delete', key, '/v', 'EscritorioDigital', '/f']);
    return r.status === 0 ? ok(`InÃ­cio automÃ¡tico ${modo === 'on' ? 'ligado' : 'desligado'}`) : bad('NÃ£o consegui alterar: ' + (r.stderr || '').trim());
  }
  if (mac) {
    const plist = path.join(os.homedir(), 'Library', 'LaunchAgents', 'com.escritoriodigital.overlay.plist');
    if (modo === 'off') { run('launchctl', ['unload', plist]); fs.rmSync(plist, { force: true }); return ok('InÃ­cio automÃ¡tico desligado'); }
    fs.mkdirSync(path.dirname(plist), { recursive: true });
    fs.writeFileSync(plist, `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n<key>Label</key><string>com.escritoriodigital.overlay</string>\n<key>ProgramArguments</key><array><string>${bin}</string><string>.</string></array>\n<key>WorkingDirectory</key><string>${OVERLAY}</string>\n<key>EnvironmentVariables</key><dict><key>PATH</key><string>${ENV.PATH}</string></dict>\n<key>RunAtLoad</key><true/>\n</dict></plist>\n`);
    run('launchctl', ['load', plist]);
    return ok('InÃ­cio automÃ¡tico ligado');
  }
  const desk = path.join(os.homedir(), '.config', 'autostart', 'escritorio-digital.desktop');
  if (modo === 'off') { fs.rmSync(desk, { force: true }); return ok('InÃ­cio automÃ¡tico desligado'); }
  fs.mkdirSync(path.dirname(desk), { recursive: true });
  fs.writeFileSync(desk, `[Desktop Entry]\nType=Application\nName=EscritÃ³rio Digital\nExec=${bin} .\nPath=${OVERLAY}\n`);
  return ok('InÃ­cio automÃ¡tico ligado');
}

// ---------------------------------------------------------------- instalar: tudo, na ordem, pulando o que jÃ¡ estÃ¡ pronto
async function instalar() {
  say('Instalando o EscritÃ³rio Digital. Cada passo sÃ³ roda se ainda for preciso.\n');
  say('1/5  Docker');
  if (docker(['--version']).status !== 0) return bad('Docker nÃ£o encontrado', dockerHelp());
  if (!dockerUp()) return bad('O Docker estÃ¡ instalado, mas nÃ£o estÃ¡ rodando', 'Abra o Docker Desktop, aceite os termos se pedir, espere "Engine running" e rode este comando de novo.');
  ok('Docker rodando');

  say('\n2/5  Imagem do escritÃ³rio');
  if (hasImage() && !flag('refazer')) ok(`${IMAGE} jÃ¡ existe`); else { const b = construir(); if (b !== true) return b === NEEDS_PERSON ? NEEDS_PERSON : false; }

  say('\n3/5  Ligar o escritÃ³rio');
  const st = containerState();
  if (st.startsWith('running') && st.includes('healthy') && !flag('recriar')) ok(`JÃ¡ estÃ¡ ligado em ${URL_BASE}`); else if (!(await iniciar())) return false;

  say('\n4/5  Conta Claude');
  const lg = login();
  if (lg !== true) return lg === NEEDS_PERSON ? NEEDS_PERSON : false;

  say('\n5/5  Equipe e bonecos');
  if (!(await equipe())) return false;
  if (!abrir()) return false;
  say('\nPronto! Clique na Marina (a chefe) para conversar. Um tour de 3 telas aparece na primeira vez.');
  say('Quer que abra sozinho quando o computador ligar? Rode: node scripts/escritorio.mjs inicio on');
  return true;
}

// ---------------------------------------------------------------- status / desinstalar
async function status() {
  const st = dockerUp() ? containerState() || 'nÃ£o criado' : 'Docker parado';
  say(`Docker/escritÃ³rio: ${st}`);
  try { const t = await api('/api/team', { token: overlayToken() }); say(`Equipe: ${t.length} pessoas`); } catch (_) { say('Equipe: indisponÃ­vel'); }
  say(`Entregas: ${exportDir()}`);
  say(`Bonecos instalados: ${fs.existsSync(path.join(OVERLAY, 'node_modules')) ? 'sim' : 'nÃ£o'}`);
  return true;
}

function desinstalar() {
  if (!flag('sim')) { say('Isto desliga e remove o escritÃ³rio do Docker. Para confirmar, rode de novo com --sim.\nOs dados (login e trabalhos) ficam nos volumes do Docker, a menos que vocÃª use tambÃ©m --apagar-dados.'); return true; }
  docker(['rm', '-f', NAME]);
  ok('EscritÃ³rio removido do Docker');
  if (flag('apagar-dados')) { docker(['volume', 'rm', 'clodfarm_claude-home', 'clodfarm_workspace']); ok('Dados apagados (login e trabalhos dentro do Docker). A pasta de entregas no seu computador nÃ£o foi tocada.'); }
  return true;
}

const cmd = process.argv[2];
const table = { instalar, verificar, construir, iniciar, equipe, abrir, status, desinstalar, inicio: () => inicio(process.argv[3]) };
if (!table[cmd]) {
  say('Uso: node scripts/escritorio.mjs <instalar | verificar | construir | iniciar | equipe | abrir | inicio on|off | status | desinstalar>');
  process.exitCode = cmd ? 2 : 0;
} else {
  Promise.resolve(table[cmd]()).then((r) => { process.exitCode = r === true || r === undefined ? 0 : r === NEEDS_PERSON ? NEEDS_PERSON : 1; })
    .catch((e) => { bad(e.message || String(e)); process.exitCode = 1; });
}
