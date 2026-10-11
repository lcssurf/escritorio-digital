# Escritório Digital

**Um escritório de advocacia com agentes de IA.** Funcionários em pixel-art vivem sobre a barra de tarefas (Windows) ou o Dock (macOS): uma chefe, coordenações e especialistas. Você conversa com a chefe, ela encaminha para quem sabe, mostra o plano antes de começar, e **nada entra no projeto nem sai do escritório sem a sua aprovação**.

<p align="center">
  <img src="docs/media/demo-pt-BR.gif" alt="Os funcionários na barra de tarefas, o painel com a conversa, o andamento em paralelo, e o leitor onde você edita ou pede um ajuste antes de aprovar" width="860">
</p>

<p align="center"><sub>Gravado com dados fictícios · <a href="docs/media/demo-pt-BR.mp4">vídeo em MP4</a> · <a href="docs/media/demo-en.gif">English version (GIF)</a></sub></p>

## O que você ganha

| | |
|---|---|
| **Uma equipe, não um chat** | Chefe, coordenações e especialistas, cada um com a sua função. Você pode criar, editar e escolher a aparência de quem quiser. |
| **Trabalho em paralelo** | Vários agentes trabalham ao mesmo tempo. Em *Ajustes* você escolhe a velocidade: Equilibrada, Rápida ou Máxima. |
| **Andamento claro** | Veja quem chamou quem, o que cada um está fazendo e por que alguém está esperando. |
| **Aprovação antes de tudo** | O trabalho pronto chega como rascunho. Você lê, edita ali mesmo ou pede ao autor um ajuste, e só então aprova. |
| **Janela sua** | O painel se redimensiona, se move e abre mais largo para ler documentos. |
| **Word, PDF e mais** | Salve qualquer documento em Word (.docx), PDF, página web, RTF ou texto, e escolha formatos extras para vir junto a cada aprovação. |
| **Cópia de segurança** | Guarde a sua equipe num arquivo e restaure quando precisar. |
| **Avisos claros** | Se a conta Claude sair, ou o plano chegar no limite, o painel explica o que fazer. |
| **Conectores sob controle** | Drive, Gmail e Agenda vêm desligados. Dá para liberar, somente leitura. |
| **Português e inglês** | Interface completa nos dois idiomas. |

## Instalar: peça ao Claude

Abra o Claude (Claude Code, no app ou no terminal) e cole:

```text
Instale o Escritório Digital no meu computador. Leia e siga o INSTALAR.md deste projeto
(https://github.com/lcssurf/escritorio-digital). Explique cada passo em português simples
e me avise só quando precisar de mim.
```

O Claude segue o [INSTALAR.md](INSTALAR.md): instala o que faltar (com a sua licença), baixa o projeto e roda **um comando só** (`node scripts/escritorio.mjs instalar`) que liga o escritório, instala a equipe e mostra os funcionários. Só duas coisas são suas: entrar com a sua conta Claude e, no Windows, reiniciar o computador se o Docker pedir. Leva uns 10 a 15 minutos.

Prefere fazer sozinho? Com Node, Git e Docker instalados: `git clone` o projeto e rode `node scripts/escritorio.mjs instalar`. Para ver o que falta, com a correção de cada item: `node scripts/escritorio.mjs verificar`.

| Sistema | Situação |
|---|---|
| Windows 10/11 | Testado |
| macOS | **Ainda não testado num Mac.** Se for testar, abra uma *issue* com o que travou. |

## Atualizar

Quando sair versão nova, peça ao Claude: *"Atualize o Escritório Digital"* (ele roda o comando abaixo), ou rode você mesmo na pasta do projeto:

```bash
node scripts/escritorio.mjs atualizar
```

O painel também avisa quando há versão nova (Ajustes > Versão e atualizações) e atualiza com um clique; a consulta vai só ao GitHub e pode ser desligada. O comando baixa o código novo, atualiza a imagem do Docker e religa o escritório e os funcionários. **O login, os trabalhos e a sua equipe editada ficam como estão.** Se houver trabalho em andamento, ele avisa e espera (use `--forcar` para religar mesmo assim). Se você mexeu em arquivos da pasta do projeto, ele não sobrescreve: guarde as mudanças primeiro.

## Como funciona
- **Conversa:** clique em qualquer funcionário (ou no ícone perto do relógio). Se não souber com quem falar, fale com a chefe.
- **Plano antes de agir:** a chefe propõe quem faz o quê e espera o seu "Começar".
- **Aprovação:** quando um trabalho fica pronto, o funcionário chama você. Leia o rascunho no painel e aprove ou recuse. O que você aprova também é copiado para a pasta `Documentos > Escritório Digital`.
- **Ajustes:** no leitor, edite o texto ou escreva o que quer mudar. O autor devolve uma proposta e você decide se aplica.

## Quem responde pelo quê
- **O Claude é da Anthropic.** Ele e todos os direitos sobre ele continuam sendo dela. Este projeto só facilita instalar e usar, sem fazer uso exclusivo nem comercial do Claude. Cada pessoa entra com a própria conta.
- **Tudo é responsabilidade de quem usa.** A IA rascunha; você confere, corrige e decide. Sigilo profissional, LGPD, os dados que você coloca no escritório e os conectores que você libera são decisão e responsabilidade sua.
- **Em testes, só dados fictícios.** Nenhum dado de cliente real.
- O programa é fornecido como está, sem garantia. Detalhes em [NOTICE.md](NOTICE.md).

## Licença e avisos legais
Use à vontade, inclusive no seu escritório, **menos para vender um produto ou serviço que concorra com este**: a nossa parte é [PolyForm Shield 1.0.0](LICENSES/PolyForm-Shield-1.0.0.md), e a parte herdada do clodfarm continua MIT (o [LICENSE](LICENSE) mostra quem é quem). Nome e funcionários em pixel-art: [TRADEMARKS.md](TRADEMARKS.md). O Claude Code é software da Anthropic, sob os termos dela, e cada pessoa entra com a própria conta: leia o [NOTICE.md](NOTICE.md).

## Sobre este projeto
Cópia modificada do [clodfarm](https://github.com/matank001/clodfarm) (MIT, © 2026 Duke Security, Inc.; a licença original está em `LICENSES/MIT-clodfarm.txt`); o README original do clodfarm e os arquivos do projeto original estão em `docs/clodfarm/`. Para desenvolver, veja o [CLAUDE.md](CLAUDE.md).
