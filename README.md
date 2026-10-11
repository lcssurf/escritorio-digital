# Escritório Digital

Um escritório de advocacia com agentes de IA. Bonecos em pixel-art vivem sobre a barra de tarefas (Windows) ou o Dock (macOS): uma chefe, coordenações e especialistas. Você conversa com a chefe, ela encaminha para quem sabe, mostra o plano antes de começar, e **nada entra no projeto nem sai do escritório sem a sua aprovação**.

## Instalar: peça ao Claude

Abra o Claude (Claude Code, no app ou no terminal) e cole:

```text
Instale o Escritório Digital no meu computador. Leia e siga o INSTALAR.md deste projeto
(https://github.com/lcssurf/escritorio-digital). Explique cada passo em português simples
e me avise só quando precisar de mim.
```

O Claude segue o [INSTALAR.md](INSTALAR.md): confere o que falta, instala com a sua licença, monta e liga o escritório, instala a equipe e abre os bonecos. Só duas coisas são suas: entrar com a sua conta Claude e, no Windows, reiniciar o computador se o Docker pedir. Funciona no **Windows** (testado) e no **macOS** (ainda não testado num Mac).

Prefere fazer sozinho? `node scripts/escritorio.mjs verificar` mostra o que falta, com a correção de cada item.

## Como funciona
- **Conversa:** clique em qualquer boneco (ou no ícone perto do relógio). Se não souber com quem falar, fale com a chefe.
- **Plano antes de agir:** a chefe propõe quem faz o quê e espera o seu "Começar".
- **Aprovação:** quando um trabalho fica pronto, o boneco chama você. Leia o rascunho no painel e aprove ou recuse. O que você aprova também é copiado para a pasta `Documentos > Escritório Digital`.
- **Conectores do Google (Drive, Gmail, Agenda):** vêm desligados. Dá para liberar em Ajustes, somente leitura.
- **Idiomas:** português (Brasil) e inglês.

## Regras do projeto
Nenhum dado de cliente real em testes. A IA rascunha, o advogado confere e envia. Sigilo e LGPD são decisão sua antes de usar dados reais.

## Sobre este projeto
Cópia modificada do [clodfarm](https://github.com/matank001/clodfarm) (MIT, © 2026 Duke Security, Inc.). A licença original está em `LICENSE`; o README original do clodfarm está em `docs/README.clodfarm.md`. Para desenvolver, veja o [CLAUDE.md](CLAUDE.md).
