# Overlay do Escritório Digital

Os agentes do escritório aparecem como funcionários pequenos em pixel-art, em pé sobre a barra de tarefas do Windows, sem fundo.

| Estado | O que o funcionário faz |
|---|---|
| Trabalhando | Sentado numa mesa, digitando no notebook |
| Ocioso | Anda pela barra, toma café ou cochila no sofá |
| Aguardando você | Balão com "!" e acenando: há trabalho pronto esperando a sua aprovação |
| Fora do ar | Dormindo no sofá (o escritório não responde) |

- **Clique** no funcionário abre o painel (detalhes, aprovar/recusar, novo trabalho, ajustes).
- **Arraste** o funcionário para a esquerda ou direita para reposicioná-lo.
- **Ícone da bandeja:** abrir painel, esconder os funcionários, sair.
- **Idiomas:** português (Brasil) e inglês, trocáveis em Ajustes.

## Equipe

Você cria os **especialistas** (nome, função, gênero, aparência e instruções) na aba Equipe do painel, ou parte de um modelo pronto (Agenda, Documentos, Peças, Revisão, Prazos). Há sempre um **Chefe**, que recebe os pedidos e entrega cada parte ao especialista certo (`clodfarm spawn --specialist <id>`). Cada especialista é um funcionário na barra, sempre presente: trabalhando, ocioso ou chamando você para aprovar. Todos trabalham sob as regras do escritório (sem dados reais, a IA rascunha, o advogado decide).

## Rodar

Requisitos: Node 20+ e o escritório (container) rodando em `http://localhost:8080`.

```bash
cd overlay
npm install
npm start
```

Na primeira execução o overlay busca sozinho a chave do escritório (`docker exec clodfarm cat /workspace/.farm/overlay.token`) e a guarda na pasta de dados do app. A chave só vale neste computador: o overlay recusa qualquer endereço que não seja `localhost`.

## Aprovação humana

Com `FARM_APPROVE_LANDING=1` no container, nada que um agente produz entra no `main` sozinho. O trabalho espera na própria branch até você aprovar no painel (ou por `POST /api/landings/<id>/approve`). Recusar descarta a branch.

## Testes

```bash
npm test
```

## Arte

Todos os personagens são desenhados por código (`renderer/sprites.js`), sem imagens. A aparência de cada um (pele, cabelo, terno, gravata) vem do id do agente, então cada agente tem a sua.
