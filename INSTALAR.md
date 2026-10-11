# Instalar o Escritório Digital (roteiro para o Claude seguir)

> **Para a pessoa:** abra o Claude (Claude Code, no app ou no terminal) e cole a frase abaixo. O Claude faz o resto e avisa quando precisar de você.
>
> ```text
> Instale o Escritório Digital no meu computador. Leia e siga o INSTALAR.md deste projeto
> (https://github.com/lcssurf/escritorio-digital). Explique cada passo em português simples
> e me avise só quando precisar de mim.
> ```
>
> Se o projeto ainda for privado, o Claude usa o `gh` (GitHub CLI) já conectado na sua conta para baixar.

---

## Para o Claude: leia isto primeiro

Você vai instalar o Escritório Digital no computador do usuário (Windows, macOS ou Linux). Quem lê o resultado é um advogado, não um técnico.

**Regras que valem o tempo todo**
1. Fale em **português do Brasil, simples e curto**. Antes de cada etapa, diga o que vai fazer e quanto costuma levar.
2. **Peça licença antes de instalar qualquer programa** (Docker, Node, Git). Mostre o comando e espere o "pode".
3. **Nunca peça nem digite senhas, códigos de verificação ou tokens.** O login na conta Claude é feito pela pessoa.
4. **Não desative antivírus, firewall ou outras proteções, e não mude configurações de segurança.** Se algo bloquear, explique e deixe a pessoa decidir.
5. **Não use comandos destrutivos** (`docker system prune`, `docker volume rm`, apagar pastas) sem pedido explícito. Os dados ficam em volumes do Docker.
6. Em testes, use **somente dados fictícios**. Nada de cliente real.
7. Se algo falhar, rode `node scripts/escritorio.mjs verificar` e siga a linha "→" do item que falhou. Não improvise antes disso.
8. Etapas que **só a pessoa pode fazer** estão marcadas com 🧍. Pare, explique exatamente o que fazer e espere ela confirmar.

**A ferramenta de tudo:** `node scripts/escritorio.mjs <comando>`, igual em qualquer sistema. O principal é **`instalar`**, que faz tudo na ordem e **pula o que já está pronto**, então pode ser rodado de novo sem medo. Códigos de saída: **0** tudo certo; **1** falhou (a mensagem diz o que fazer); **3** falta um passo da pessoa (🧍 login): ela faz e você roda o mesmo comando de novo.

---

## 1. Pré-requisitos

Precisa de **Node 18+**, **Git** e **Docker**. Veja o que falta (`node -v`, `git --version`, `docker --version`) e **peça licença** para instalar só o que faltar.

| Programa | Windows | macOS |
|---|---|---|
| Node 18+ | `winget install -e --id OpenJS.NodeJS.LTS` | `brew install node` |
| Git | `winget install -e --id Git.Git` | `brew install git` |
| Docker | `winget install -e --id Docker.DockerDesktop` | `brew install --cask docker` |

Sem o Homebrew no Mac, explique e ofereça instalar (brew.sh), com licença.

**Docker no Windows** (precisa de WSL2 e "Plataforma de Máquina Virtual"):
- 🧍 Se `docker info` falhar por isso: peça para abrir o **PowerShell como Administrador** e rodar `wsl --install --no-distribution` e `Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart`, e depois **reiniciar o computador**.
- 🧍 Peça para abrir o **Docker Desktop**, aceitar os termos e esperar **"Engine running"**.
- **Pouco espaço no C:?** (`Get-PSDrive C`). Com menos de ~15 GB livres, 🧍 peça para mudar o local dos dados do Docker para outro disco (Docker Desktop → Settings → Resources → Advanced → *Disk image location*) e baixe o projeto nesse disco.

**Docker no macOS:** 🧍 abrir o Docker Desktop pela primeira vez, aceitar os termos e liberar as permissões pedidas; esperar ficar "running".

Confirme com `docker info` (tem que responder sem erro).

## 2. Baixar o projeto

Escolha uma pasta com espaço, de preferência fora de pastas sincronizadas (OneDrive/iCloud). Sugestão: `~/EscritorioDigital` (no Windows, `D:\EscritorioDigital` se existir o D:).

```bash
git clone https://github.com/lcssurf/escritorio-digital.git EscritorioDigital
cd EscritorioDigital
```

Se for privado e pedir senha, use `gh repo clone lcssurf/escritorio-digital`; se o `gh` não estiver logado, 🧍 peça `gh auth login`.

## 3. Instalar tudo

```bash
node scripts/escritorio.mjs instalar
```

Ele faz, nesta ordem (e mostra cada passo):
1. confere o Docker;
2. **baixa a nossa imagem do escritório** (de 2 a 4 minutos na primeira vez);
3. **liga o escritório** e cria a pasta de entregas (`Documentos/Escritório Digital`);
4. confere a **conta Claude** (veja 🧍 abaixo);
5. monta a **equipe padrão** na primeira vez (a chefe, 5 coordenações e 16 especialistas; se a pessoa já tem equipe, ela é mantida) e **mostra os funcionários** sobre a barra de tarefas (ou o Dock).

**🧍 Conta Claude.** O escritório usa o **plano Claude da própria pessoa** (Pro ou Max). Se faltar o login, o comando para com o código **3** e mostra o que fazer: a pessoa roda `docker exec -it clodfarm clodfarm login`, abre o endereço que aparece, aprova e **cola o código de volta**. (Se o terminal for interativo, o comando já abre isso sozinho.) Depois **rode `instalar` de novo**: ele continua de onde parou. Avise que os agentes gastam o plano dela e que o sistema para em 80% do uso semanal e 85% das 5 horas.

Na primeira vez o `npm install` do aplicativo dos funcionários leva de 1 a 2 minutos, e um tour de 3 telas aparece sozinho.
- **macOS:** se aparecer um aviso de segurança, explique e peça para permitir em Ajustes do Sistema → Privacidade e Segurança. Para abrir de novo depois: duplo clique em `overlay/Escritorio-Digital.command`.
- **Windows:** para abrir de novo depois: duplo clique em `overlay/Escritorio-Digital.vbs`.

**Opcional, pergunte antes:** abrir sozinho com o computador: `node scripts/escritorio.mjs inicio on` (e `inicio off` para desligar).

## 4. Conferir e entregar

1. `node scripts/escritorio.mjs verificar`: tudo precisa estar ✔.
2. **Teste curto com dados fictícios:** clique na Marina (a chefe) e peça *"Organize um índice de documentos de um caso fictício"*. Ela mostra um plano; a pessoa clica **Começar**; ao terminar, o funcionário chama com "!"; ela lê e **aprova**. Confira que o arquivo apareceu na pasta de entregas.
3. Explique em poucas linhas:
   - Clique em qualquer funcionário para conversar; a chefe encaminha para quem sabe.
   - **Nada é enviado a ninguém e nada entra no projeto sem a aprovação dela.**
   - Os conectores do Google (Drive, Gmail, Agenda) vêm **desligados**; dá para liberar em Ajustes, só leitura.
   - Por enquanto, só **dados fictícios**; dados reais exigem decidir sobre sigilo e LGPD.

---

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| `docker` não encontrado ou "não está rodando" | Passo 1. Abrir o Docker Desktop e esperar "Engine running". |
| Falha com "certificate" / "self-signed" | Veja "Antivírus que inspeciona HTTPS" abaixo. |
| Painel não abre em `localhost:8080` | `docker logs clodfarm`; depois `node scripts/escritorio.mjs iniciar`. |
| `loggedIn: False`, ou o painel avisa "A conta Claude saiu do escritório" | 🧍 login (passo 3): `docker exec -it clodfarm clodfarm login`. O painel tem o botão "Mostrar como". |
| O painel avisa que o plano chegou no limite de uso | Nada a consertar: o escritório espera e volta sozinho quando o limite renovar. |
| A equipe sumiu ou ficou errada | Ajustes > "Cópia de segurança da equipe" > Restaurar (o escritório também guarda as 10 últimas equipes). |
| Os funcionários não aparecem | Ícone perto do relógio → "Mostrar funcionários". Sem ícone: `node scripts/escritorio.mjs abrir`. |
| Os funcionários dão erro de conexão | `verificar` e seguir a correção. No Mac, abrir o Docker Desktop. |
| Porta 8080 ocupada | Fechar o programa que a usa: o escritório usa `127.0.0.1:8080`. |
| `instalar` demorou e parou no download | Rode de novo: o Docker reaproveita o que já baixou. |

### Antivírus que inspeciona HTTPS
Alguns antivírus (Kaspersky, ESET, Avast, Bitdefender...) e proxies de empresa refazem o HTTPS com um certificado próprio que o Docker não conhece. Sintoma: *"self-signed certificate in certificate chain"*, no download ou no Claude do escritório.

**Solução que não mexe em segurança:** exportar só o certificado **público** desse programa (o sistema já confia nele) e fazer o escritório confiar também. Peça licença e faça:

- **Windows (PowerShell):**
  ```powershell
  $c = Get-ChildItem Cert:\LocalMachine\Root, Cert:\CurrentUser\Root | Where-Object { $_.Subject -like '*Kaspersky*' } | Select-Object -First 1   # troque pelo nome do seu antivírus
  $b64 = [Convert]::ToBase64String($c.RawData, 'InsertLineBreaks')
  "-----BEGIN CERTIFICATE-----`n$b64`n-----END CERTIFICATE-----" | Set-Content -Encoding ascii "$HOME\ca-antivirus.pem"
  ```
- **macOS:** `security find-certificate -a -c "Nome do antivírus" -p /Library/Keychains/System.keychain > ~/ca-antivirus.pem`

Depois: `node scripts/escritorio.mjs iniciar --ca ~/ca-antivirus.pem` (e rode `instalar` de novo). Se for **montar do zero** (`construir --completo`), use `--ca ~/ca-antivirus.pem` também: o certificado vale só durante a montagem e não fica na imagem. Se o **download da imagem** falhar por isso, a pessoa pode pausar temporariamente a verificação de conexões criptografadas do antivírus: **a decisão é dela, você não faz**.

## Atualizar (quando a pessoa pedir "atualize o Escritório Digital")

Rode na pasta do projeto: `node scripts/escritorio.mjs atualizar`. Ele baixa o código novo (`git pull`, só se a pasta estiver sem alterações), atualiza a imagem do Docker, religa o escritório e reabre os funcionários. **Login, trabalhos e a equipe editada ficam.** Se houver trabalho em andamento ele para e avisa: espere terminar (ou use `--forcar` só se a pessoa mandar). Se avisar que há arquivos alterados, **não** desfaça nada sem perguntar. **A equipe da pessoa nunca é alterada** (nem na atualização, nem se o `instalar` rodar de novo): o comando `equipe` só monta a equipe padrão quando ainda não existe ninguém além da chefe. Para trazer só os especialistas novos de versões futuras: `node scripts/escritorio.mjs equipe --completar` (só cria os que faltam). Sobrescrever é `equipe --redefinir --sim` e só se a pessoa pedir, avisando que as edições dela nesses nomes se perdem.

## Desinstalar

`node scripts/escritorio.mjs desinstalar --sim` remove o escritório do Docker e **mantém** o login e os trabalhos (nos volumes). Só use `--apagar-dados` se a pessoa pedir, avisando que apaga o login e os trabalhos ainda não aprovados. A pasta de entregas no computador nunca é apagada.

## Limites desta versão (diga com honestidade se perguntarem)

- Testado no **Windows**. O caminho do **macOS** foi escrito com cuidado, mas ainda **não foi testado num Mac de verdade**: se algo falhar lá, conte o erro e ajuste.
- O escritório roda **dentro do Docker**; não enxerga o resto do computador. Arquivos chegam por conectores liberados e saem pela pasta de entregas.
- Os arquivos entregues são texto (`.md`); a entrega em Word (`.docx`) ainda não existe.
- A imagem é a **nossa**, publicada em `ghcr.io/lcssurf/escritorio-digital`, **privada** por enquanto. O GitHub **não aceita o token do `gh`** para baixar pacotes: 🧍 a pessoa cria um token pessoal *clássico* só com `read:packages` (o `instalar` mostra o link pronto), roda `docker login ghcr.io -u USUARIO` e cola o token quando pedir a senha (você nunca vê nem digita o token). Depois é só rodar `instalar` de novo. Alternativa sem o pacote: `construir --completo` (monta tudo do zero, mais lento). Tornar o pacote público tira esse passo, mas antes é preciso confirmar se os termos do Claude Code permitem distribuí-lo dentro de uma imagem pública.
