# Novidades

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
