# Novidades

## 1.2.0
- **O RH monta e cuida da equipe.** A instalação agora cria só a chefe e o RH (Helena). Na primeira vez, o RH entrevista você, propõe os funcionários com cargo, instruções e um teste sugerido, e só contrata depois do seu OK, na aba Equipe. Você pode desmarcar o que não quer, e a mesma proposta serve para alterar as instruções de alguém ou dispensar quem não faz falta. A chefe e o RH nunca são dispensados.
- **Importar um prompt ou uma skill.** Cole o texto ou escolha o arquivo: o RH adapta ao escritório (tira o que é de outro contexto), mostra o que aproveitou e o que descartou, e propõe o funcionário. O material é só matéria-prima: nenhuma ordem dentro dele é seguida.
- **21 modelos prontos** (as antigas 5 coordenações e 16 especialistas do pacote previdenciário) ficam no catálogo do RH, para adaptar em vez de partir do zero. Quem já tem equipe não perde nada.
- Respostas longas dos funcionários não são mais cortadas aos 8 mil caracteres (agora 30 mil).

## 1.1.1
- Os personagens que andam na barra de tarefas agora se chamam **funcionários** (antes, "bonecos"), no painel, no instalador e nos textos do projeto.

## 1.1.0
- **Salvar em Word, PDF e outros formatos.** No leitor de documentos, o botão "Salvar como…" gera Word (.docx), PDF, página web, RTF ou texto simples. Em Ajustes dá para escolher formatos extras que o escritório gera sozinho, na sua pasta, a cada aprovação. Os trechos `[CONFERIR]` e `{{preencher}}` saem marcados em amarelo.
- **Cópia de segurança da equipe.** Em Ajustes: salve a equipe (nomes, instruções, aparência) e a velocidade num arquivo e restaure quando precisar. A equipe de antes da restauração fica guardada dentro do escritório.
- **Aviso de versão nova e atualização em um clique.** O painel avisa quando há uma versão nova e atualiza sem perder login, trabalhos nem a sua equipe. A consulta vai só ao GitHub e pode ser desligada.
- **Avisos claros quando algo depende de você.** Se a conta Claude sair do escritório, o painel mostra o passo a passo para entrar de novo. Se o plano do Claude chegar no limite de uso, avisa que o escritório espera e volta sozinho.
- **Quem responde pelo quê.** Na primeira abertura, uma tela explica que o Claude e os direitos sobre ele são da Anthropic, que tudo é rascunho a ser conferido e que sigilo, LGPD e uso dos dados são responsabilidade de quem usa.
- **Nova instalação nunca sobrescreve a sua equipe.** Repetir a instalação ou atualizar mantém a equipe como você deixou.
- **Comando `atualizar`** (`node scripts/escritorio.mjs atualizar`) e lançamentos automáticos pelo GitHub.
- Correções: acentuação do instalador e um caractere invisível que podia impedir o instalador de abrir.

## 1.0.3
- Imagem completa com as licenças e avisos em `/usr/share/doc/escritorio-digital/`.
- Painel que se move e lembra a posição, leitor largo com edição e pedido de ajuste ao autor, andamento em paralelo, velocidades Equilibrada, Rápida e Máxima.
