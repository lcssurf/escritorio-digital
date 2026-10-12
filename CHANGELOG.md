# Novidades

## 1.6.0
- **A página `localhost:8080` agora é a do Escritório Digital.** Em vez da fazendinha do clodfarm original, ela mostra uma página calma de apoio, em português ou inglês: se o escritório está no ar, onde ficam os funcionários (num programa à parte, sobre a barra de tarefas ou o Dock), os comandos para abri-los quando não aparecem, como usar e como atualizar. O painel original do clodfarm continua existindo, escondido em `/farm`, para quem quiser.

## 1.5.1
- **Quando os funcionários não abrem, o instalador agora diz.** Antes, se o programa dos funcionários falhasse ao abrir (visto num Mac), o instalador dizia que tinha dado certo e só a página `localhost:8080` aparecia. Agora ele espera alguns segundos, confere se o programa está aberto e, se não estiver, mostra o motivo (também guardado em `overlay/overlay.log`) e o que fazer. O `verificar` passou a conferir isso, e o aviso final explica que `localhost:8080` é só o painel de apoio.

## 1.5.0
- **Tamanho dos funcionários.** Em Ajustes, escolha Pequeno, Médio, Grande ou Gigante. O tamanho muda de forma exata (cada pixel do desenho vira 2, 3, 4 ou 5 pixels da tela), então eles continuam nítidos, e a janela da barra acompanha.
- O atualizador agora explica quando a versão nova ainda está sendo publicada, em vez de pedir um login que não existe.

## 1.4.2
- A bolinha vermelha que os bichos usavam para brincar deu lugar a um brinquedo que se reconhece: novelo (gato), osso (cachorro), cenoura (coelho), bambu (panda), peixe (pinguim), ratinho (coruja), biscoito (guaxinim) e bolinha de tênis (raposa).

## 1.4.1
- **Animais menores e mais claros.** Os bichinhos foram redesenhados no mesmo nível de detalhe das pessoas: menores, de silhueta clara, com olhos grandes e brilhantes. Ganharam uma vida de bicho: comem de uma tigela (no lugar do café), brincam com uma bolinha (no lugar da leitura), dormem enrolados numa caminha de pet (no lugar do sofá) e sentam num banquinho para usar o computador.

## 1.4.0
- **Animais de verdade.** O estilo Animais foi refeito: agora são bichinhos cartoon fofos (gato, cachorro, coelho, raposa, panda, pinguim, coruja e guaxinim), de quatro patas (pinguim e coruja em pé), com cabeça grande e olhos brilhantes, e não mais pessoas com cabeça de bicho. A equipe veste um **colete e uma bandana** na cor da equipe (dourado para a chefe, com medalha prateada nas coordenações), e cada cargo usa o seu acessório na cabeça. Sentam-se na almofada para trabalhar, enrolam-se no sofá para dormir e pulam quando uma entrega é aprovada.

## 1.3.1
- O RH agora se chama **Teresa** (antes, Helena), para não se confundir com a Helena da coordenação INSS do catálogo.

## 1.3.0
- **Quem é quem, num relance.** Cada equipe veste uma cor (todos de uma coordenação iguais) e leva um crachá com o desenho da equipe; cada cargo tem o seu acessório (fone, viseira verde, lápis na orelha, óculos redondos, gravata-borboleta, cachecol, boné, coração, coroa, monóculo); a chefe usa coroa e dragonas douradas, as coordenações dragonas prateadas. O nome de cada um aparece sempre numa plaquinha com a cor da equipe, e há um anel da cor da equipe no chão. A chefe e as coordenações são um pouco maiores.
- **Muito mais variedade:** 8 penteados para cada gênero (raspado, cacheado, careca, bigode, black power, chanel, trança, ondulado), mais tons de pele e de cabelo, porte robusto e acessórios.
- **Estilo Animais.** Em Ajustes, troque pessoas por bichinhos de verdade, no estilo cartoon fofo: gatos, cachorros, coelhos, raposas, pandas, pinguins, corujas e guaxinins, de quatro patas (os pássaros em pé), com colete e bandana na cor da equipe e o acessório de cada cargo. Cada um pode ter o seu animal no editor.
- **O RH ficou melhor.** O método (entrevista com limites e anti-objetivos, equipe pequena sem sobreposição, instruções com esqueleto, voz diferente para cada pessoa, passagem de bastão por nome, conferência antes de propor) agora vem junto de cada pedido, então melhora a cada versão sem mexer na equipe que você editou. Ele também escolhe a aparência certa para cada cargo.
- Os modelos do catálogo passaram a usar as cores da equipe e os acessórios de cada cargo.

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
