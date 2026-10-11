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
1. Fale em **português do Brasil, simples e curto**. Antes de cada etapa grande, diga o que vai fazer e quanto tempo costuma levar.
2. **Peça licença antes de instalar qualquer programa** (Docker, Node, Git). Mostre o comando e espere o "pode".
3. **Nunca peça nem digite senhas, códigos de verificação ou tokens.** O login na conta Claude é feito pela pessoa (etapa 6).
4. **Não desative antivírus, firewall ou outras proteções, e não mude configurações de segurança.** Se algo bloquear, explique e deixe a pessoa decidir.
5. **Não use comandos destrutivos** (`docker system prune`, `docker volume rm`, apagar pastas) sem pedido explícito. Os dados do escritório ficam em volumes do Docker.
6. Em testes, use **somente dados fictícios**. Nada de cliente real.
7. Quando uma etapa falhar, rode `node scripts/escritorio.mjs verificar` e siga a linha "→" do item que falhou. Não improvise outro caminho antes disso.
8. Etapas que **só a pessoa pode fazer** estão marcadas com 🧍. Pare, explique exatamente o que fazer e espere ela confirmar.

**A ferramenta de tudo:** `node scripts/escritorio.mjs <comando>` (igual em qualquer sistema). Comandos: `verificar`, `construir`, `iniciar`, `equipe`, `abrir`, `inicio on|off`, `status`, `desinstalar`.

Cada comando é seguro de repetir. Comece sempre pela etapa 1 e pule o que `verificar` já mostrar como pronto (✔).

---

## 1. Ver o que já existe

1. Descubra o sistema (`process.platform` / `uname`) e diga à pessoa qual é.
2. Se o projeto já estiver baixado, entre na pasta dele e rode: `node scripts/escritorio.mjs verificar`. Ele lista o que está pronto (✔) e o que falta (✖, com a correção).
3. Se ainda não houver o projeto, siga a etapa 3 e volte aqui.

## 2. Pré-requisitos

Precisa de **Node 18+**, **Git** e **Docker**. Veja o que falta (`node -v`, `git --version`, `docker --version`) e **peça licença** para instalar só o que faltar.

| Programa | Windows | macOS |
|---|---|---|
| Node 18+ | `winget install -e --id OpenJS.NodeJS.LTS` | `brew install node` |
| Git | `winget install -e --id Git.Git` | `brew install git` (ou as ferramentas do Xcode) |
| Docker | `winget install -e --id Docker.DockerDesktop` | `brew install --cask docker` |

Se o macOS não tiver o Homebrew, explique e ofereça instalar (brew.sh) antes, com licença da pessoa.

**Docker no Windows:** o Docker Desktop precisa do WSL2 e de "Plataforma de Máquina Virtual".
- 🧍 Se `docker info` falhar por causa disso, peça para a pessoa abrir o **PowerShell como Administrador** e rodar `wsl --install --no-distribution` e `Enable-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform -NoRestart`, e depois **reiniciar o computador**.
- 🧍 Peça para abrir o **Docker Desktop**, aceitar os termos e esperar aparecer **"Engine running"**.
- **Pouco espaço no C:?** (`Get-PSDrive C` mostra o livre). Se tiver menos de ~15 GB, 🧍 peça para mudar o local dos dados do Docker para outro disco em Docker Desktop → Settings → Resources → Advanced → *Disk image location*, e baixe o projeto em outro disco (etapa 3).

**Docker no macOS:** 🧍 peça para abrir o Docker Desktop pela primeira vez (aceitar os termos, liberar as permissões que ele pedir) e esperar ficar "running". Em Macs com chip Apple, aceite o Rosetta se o Docker pedir.

Confirme com `docker info` (tem que responder sem erro).

## 3. Baixar o projeto

Escolha uma pasta com espaço (de preferência fora de pastas sincronizadas como OneDrive/iCloud). Sugestão: `~/EscritorioDigital` (no Windows, `D:\EscritorioDigital` se existir o D:, senão a pasta do usuário).

```bash
git clone https://github.com/lcssurf/escritorio-digital.git EscritorioDigital
cd EscritorioDigital
```

(Se for privado e o `git clone` pedir senha, use `gh repo clone lcssurf/escritorio-digital`. Se o `gh` não estiver logado, 🧍 peça para a pessoa rodar `gh auth login`.)

## 4. Montar a imagem do escritório

```bash
node scripts/escritorio.mjs construir
```

Leva de **5 a 15 minutos** na primeira vez (baixa várias coisas). Avise a pessoa e espere. O Docker guarda o que já baixou, então repetir é rápido.

### Antivírus que inspeciona HTTPS (erro de "certificate" / "self-signed")
Alguns antivírus (Kaspersky, ESET, Avast, Bitdefender...) e proxies de empresa refazem o HTTPS com um certificado próprio, que o Docker não conhece. O sintoma é o build ou o Claude do escritório falharem com *"self-signed certificate in certificate chain"*.

**Solução que não mexe em segurança:** exportar só o certificado **público** desse programa (o sistema já confia nele) e fazer o escritório confiar nele também. Peça licença e faça:

- **Windows (PowerShell):**
  ```powershell
  $c = Get-ChildItem Cert:\LocalMachine\Root, Cert:\CurrentUser\Root | Where-Object { $_.Subject -like '*Kaspersky*' } | Select-Object -First 1   # troque pelo nome do seu antivírus
  $b64 = [Convert]::ToBase64String($c.RawData, 'InsertLineBreaks')
  "-----BEGIN CERTIFICATE-----`n$b64`n-----END CERTIFICATE-----" | Set-Content -Encoding ascii "$HOME\ca-antivirus.pem"
  ```
- **macOS:** `security find-certificate -a -c "Nome do antivírus" -p /Library/Keychains/System.keychain > ~/ca-antivirus.pem`

Depois use a opção `--ca` na etapa 5: `node scripts/escritorio.mjs iniciar --ca ~/ca-antivirus.pem`. (Para o **build**, se ele falhar por isso, a alternativa é a pessoa ter, temporariamente, a "verificação de conexões criptografadas" do antivírus pausada: **isso é decisão dela, você não faz**.)

## 5. Ligar o escritório

```bash
node scripts/escritorio.mjs iniciar
```

Isso liga o escritório, cria a pasta de **entregas** (`Documentos/Escritório Digital`) e mostra o endereço do painel (`http://localhost:8080`). Espere aparecer "Escritório no ar".

## 6. 🧍 Entrar com a conta Claude

O escritório usa o **plano Claude da própria pessoa** (Pro ou Max). Isto é feito por ela:

1. Peça para a pessoa rodar num terminal: `docker exec -it clodfarm clodfarm login`
   (Se você tiver um terminal do app disponível, pode abri-lo para ela, mas **quem cola o código é ela**.)
2. Ele mostra um endereço. Ela abre no navegador, aprova e **cola o código de volta**.
3. Confirme: `docker exec clodfarm clodfarm whoami` deve mostrar `loggedIn: True`.

Avise: os agentes gastam o plano dela, e o limitador do sistema para em 80% do uso semanal e 85% das 5 horas.

## 7. Instalar a equipe

```bash
node scripts/escritorio.mjs equipe
```

Instala a chefe, 5 coordenações e 16 especialistas (escritório previdenciário). Pode rodar de novo sem duplicar ninguém. A pessoa pode editar tudo depois, no painel.

## 8. Abrir os bonecos

```bash
node scripts/escritorio.mjs abrir
```

Na primeira vez ele instala o necessário (`npm install` na pasta `overlay`, 1 a 2 minutos) e abre os bonecos **sobre a barra de tarefas** (Windows) ou **o Dock** (macOS), mais um ícone perto do relógio / na barra de menu. Um tour de 3 telas aparece sozinho.

- No **macOS**, se aparecer aviso de segurança ao abrir, explique a ele e peça para permitir em Ajustes do Sistema → Privacidade e Segurança. Para abrir de novo depois, vale o duplo clique em `overlay/Escritorio-Digital.command`.
- No **Windows**, para abrir de novo depois: duplo clique em `overlay/Escritorio-Digital.vbs`.

## 9. Opcional: abrir sozinho com o computador

**Pergunte antes** (isso cria uma entrada de inicialização). Se a pessoa quiser: `node scripts/escritorio.mjs inicio on`. Para desligar: `inicio off`.

## 10. Conferir e entregar

1. Rode `node scripts/escritorio.mjs verificar`: tudo precisa estar ✔.
2. Faça **um teste curto com dados fictícios**: abra o painel (clique na Marina, a chefe) e peça algo como *"Organize um índice de documentos de um caso fictício"*. Ela mostra um plano; a pessoa clica **Começar**; ao terminar, o boneco chama com "!" e ela lê e **aprova**. Confira que o arquivo apareceu na pasta de entregas.
3. Explique em poucas linhas:
   - Os bonecos ficam sobre a barra; clique para conversar; a chefe encaminha para quem sabe.
   - **Nada é enviado a ninguém e nada entra no projeto sem a aprovação dela.**
   - Os conectores do Google (Drive, Gmail, Agenda) vêm **desligados**; dá para liberar em Ajustes, somente leitura.
   - Por enquanto, usar só com **dados fictícios**; dados reais exigem decidir sobre sigilo e LGPD.

---

## Se algo der errado

| Sintoma | O que fazer |
|---|---|
| `docker` não encontrado ou "não está rodando" | Etapa 2. Abrir o Docker Desktop e esperar "Engine running". |
| Build ou Claude falham com "certificate" / "self-signed" | Seção "Antivírus que inspeciona HTTPS" (etapa 4). |
| Painel não abre em `localhost:8080` | `docker logs clodfarm`; depois `node scripts/escritorio.mjs iniciar`. |
| `loggedIn: False` | Etapa 6. |
| Bonecos não aparecem | O ícone perto do relógio → "Mostrar bonecos". Se não houver ícone: `node scripts/escritorio.mjs abrir`. |
| Bonecos aparecem mas dão erro de conexão | `node scripts/escritorio.mjs verificar` e seguir a correção. No Mac, abrir o Docker Desktop. |
| Porta 8080 ocupada | Fechar o programa que usa a porta (ou pedir ajuda): o escritório usa `127.0.0.1:8080`. |

## Desinstalar

`node scripts/escritorio.mjs desinstalar --sim` remove o escritório do Docker e **mantém** o login e os trabalhos (dentro dos volumes). Só use `--apagar-dados` se a pessoa pedir, depois de avisar que apaga o login e os trabalhos que ainda não foram aprovados. A pasta de entregas no computador nunca é apagada.

## Limites desta versão (diga com honestidade se perguntarem)

- Testado no **Windows**. O caminho do **macOS** foi escrito com cuidado, mas ainda **não foi testado num Mac de verdade**: se algo falhar lá, conte o erro e ajuste.
- O escritório roda **dentro do Docker**; ele não enxerga o resto do computador. Arquivos chegam por conectores liberados e saem pela pasta de entregas.
- Os arquivos entregues são texto (`.md`); a entrega em Word (`.docx`) ainda não existe.
