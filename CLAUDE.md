# Escritório Digital: guia para quem abrir este projeto

Cópia modificada do [clodfarm](https://github.com/matank001/clodfarm) (MIT, © Duke Security, Inc.; a nossa parte é PolyForm Shield, veja `LICENSE`): um escritório de advocacia com agentes de IA, bonecos em pixel-art sobre a barra de tarefas e **aprovação humana antes de qualquer entrega**.

## Se pediram para INSTALAR
Siga o [INSTALAR.md](INSTALAR.md) à risca. Ferramenta única: `node scripts/escritorio.mjs <instalar|verificar|construir|iniciar|equipe|abrir|inicio|status|desinstalar>`; o `instalar` faz tudo e pula o que já está pronto.

## Regras do projeto (valem para qualquer mudança)
- **Nada de dado real de cliente** em testes, exemplos ou commits.
- A IA **rascunha**; o advogado confere e decide. Nenhum agente envia e-mail/mensagem nem protocola nada.
- Segurança primeiro: valide tudo no servidor, limite tamanhos de entrada, não confie no cliente (a UI do overlay não é fronteira de segurança).
- Os conectores da conta Claude (Gmail, Drive, Agenda) ficam **desligados por padrão** e, se liberados, **somente leitura** (`clodfarm/policy.py`).
- Nunca commite certificados, tokens ou chaves (`.pem`, `overlay.token`, `.env`).
- **Arquivo novo nosso** (código) começa com o cabeçalho `SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0` + `Required Notice: Copyright (c) 2026 lcssurf ...` e entra na lista do `LICENSE` e de `tests/test_licenses.py`. Não mexa nos avisos de copyright do clodfarm.
- Comunicação com o usuário: português do Brasil, simples e curto.

## Mapa
- `clodfarm/` motor (Python). Nosso: `team.py` (chefe, coordenações, especialistas), `chat.py` (conversa e plano), `web.py` (API do overlay: `/api/team`, `/api/chat/*`, `/api/landings/*`, `/api/claude-connectors`), `policy.py` (filtro de ferramentas), `supervisor.py` (`land()` espera a aprovação).
- `overlay/` app de desktop (Electron): bonecos (`renderer/sprites.js`), painel (`renderer/panel.js`), textos em `i18n/` (pt-BR e en).
- `scripts/escritorio.mjs` instalação e manutenção (Windows, macOS, Linux). `scripts/sync-plugin.sh` é do projeto original (um teste cita).
- `Dockerfile` monta a imagem completa (é ela que publicamos em `ghcr.io/lcssurf/escritorio-digital`); `Dockerfile.dev` só põe o nosso código Python por cima dessa imagem, para desenvolver rápido. Nada depende da imagem do projeto original.
- `docs/clodfarm/` tudo o que veio do projeto original e não usamos no dia a dia (README, changelog, compose, scripts de operação).
- `tests/` testes do motor (pytest); `overlay/test/` testes do overlay (`npm test` em `overlay/`).

## Comandos de desenvolvimento
- Testes do motor (no Linux/Docker): `pip install pytest 'moto[server]' -e . && pytest -q tests/`
- Testes do overlay: `cd overlay && npm test`
- Baixar a imagem: `node scripts/escritorio.mjs construir`. Montar do zero: `construir --completo [--ca certificado.pem]`. Desenvolver: `docker build -f Dockerfile.dev -t escritorio-digital:dev .`
- Textos novos: sempre nos **dois** idiomas (`overlay/i18n/pt-BR.json` e `en.json`); `npm test` confere que as chaves batem.
- Arquivos `.js`/`.py` grandes: edite com ferramentas de arquivo, não com `sed`/heredoc (aspas e barras se perdem no shell).
