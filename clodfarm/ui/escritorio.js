// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Required Notice: Copyright (c) 2026 lcssurf (https://github.com/lcssurf/escritorio-digital)
// The page you get at localhost:8080: not the old clodfarm farm, just a calm "support" page. The characters live in a program of
// their own on the taskbar (or the Dock); this page says so, shows whether the office is up and how to open them.
(function () {
  const TXT = {
    'pt-BR': {
      sub: 'Um escritório de advocacia com agentes de IA. Esta página é só de apoio.',
      up: 'Escritório no ar', down: 'Escritório não respondeu', copy: 'Copiar', copied: 'Copiado',
      statusUp: 'O motor está funcionando. Os trabalhos e as aprovações aparecem no painel dos funcionários.',
      statusDown: 'Não consegui falar com o escritório agora. Se acabou de ligar, espere alguns segundos e atualize a página.',
      tWhere: 'Onde estão os funcionários?',
      pWhere: 'Eles ficam sobre a barra de tarefas (Windows) ou o Dock (Mac), num programa à parte. Clique em qualquer um para conversar, e na chefe se não souber com quem falar.',
      notSeen: 'Não está vendo os funcionários? Rode no terminal, na pasta do projeto:',
      tHow: 'Como usar',
      steps: ['Na primeira vez, converse com o RH (botão "Montar a minha equipe"): ele faz algumas perguntas e propõe a equipe.', 'Você aprova quem entra na aba Equipe do painel.', 'Peça os trabalhos à chefe. Nada entra no projeto nem sai do escritório sem a sua aprovação.'],
      tHelp: 'Atualizar e ajuda', pHelp: 'Para trazer a versão mais nova (sem perder login, trabalhos nem a sua equipe):',
      repo: 'Documentação e novidades no GitHub', credit: 'Escritório Digital, cópia modificada do clodfarm (MIT).', adv: 'Modo avançado (painel original do clodfarm)',
    },
    en: {
      sub: 'A law office of AI agents. This page is only a support page.',
      up: 'Office is up', down: 'Office did not answer', copy: 'Copy', copied: 'Copied',
      statusUp: 'The engine is running. Jobs and approvals show up in the employees\' panel.',
      statusDown: 'Could not reach the office right now. If it has just started, wait a few seconds and reload.',
      tWhere: 'Where are the employees?',
      pWhere: 'They stand on the taskbar (Windows) or the Dock (Mac), in a program of their own. Click any of them to talk, and the chief if you do not know whom to ask.',
      notSeen: 'Cannot see them? Run this in a terminal, in the project folder:',
      tHow: 'How to use it',
      steps: ['The first time, talk to HR ("Build my team"): it asks a few questions and proposes the team.', 'You approve who joins in the Team tab of the panel.', 'Ask the chief for jobs. Nothing lands in the project or leaves the office without your approval.'],
      tHelp: 'Updating and help', pHelp: 'To get the newest version (keeping your login, jobs and team):',
      repo: 'Documentation and news on GitHub', credit: 'Digital Office, a modified copy of clodfarm (MIT).', adv: 'Advanced mode (the original clodfarm panel)',
    },
  };
  const lang = /^en/i.test(navigator.language || '') ? 'en' : 'pt-BR', T = TXT[lang], $ = (id) => document.getElementById(id);
  document.documentElement.lang = lang;
  $('sub').textContent = T.sub; $('t-where').textContent = T.tWhere; $('p-where').textContent = T.pWhere; $('p-notseen').textContent = T.notSeen;
  $('t-how').textContent = T.tHow; $('t-help').textContent = T.tHelp; $('p-help').textContent = T.pHelp; $('a-repo').textContent = T.repo;
  $('credit').textContent = T.credit; $('a-adv').textContent = T.adv;
  const ol = $('steps'); for (const s of T.steps) { const li = document.createElement('li'); li.textContent = s; ol.append(li); }
  for (const b of document.querySelectorAll('button[data-copy]')) {
    b.textContent = T.copy;
    b.addEventListener('click', () => { try { navigator.clipboard.writeText(b.dataset.copy); b.textContent = T.copied; setTimeout(() => { b.textContent = T.copy; }, 1500); } catch (_) { /* the command is on screen */ } });
  }
  function show(on) {
    $('pill').className = 'pill ' + (on ? 'on' : 'off');
    $('pilltext').textContent = on ? T.up : T.down;
    $('statustext').textContent = on ? T.statusUp : T.statusDown;
  }
  async function check() {
    try { const r = await fetch('healthz', { cache: 'no-store' }); const d = await r.json(); show(!!(r.ok && d && d.ok)); } catch (_) { show(false); }
  }
  check(); setInterval(check, 10000);
})();
