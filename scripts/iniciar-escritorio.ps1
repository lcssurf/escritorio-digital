# Sobe (ou recria) o escritório digital no Docker, com a aprovação humana ligada.
#   .\scripts\iniciar-escritorio.ps1                      # imagem escritorio-digital:dev
#   .\scripts\iniciar-escritorio.ps1 -CaFile C:\ca.pem    # confia numa CA extra (antivírus que refaz o HTTPS)
# O login e o trabalho ficam nos volumes do Docker: recriar o container não perde nada.
param(
  [string]$Image = 'escritorio-digital:dev',
  [string]$Name = 'clodfarm',
  [int]$Port = 8080,
  [string]$CaFile = ''
)
$ErrorActionPreference = 'Stop'

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'O Docker não está rodando. Abra o Docker Desktop e tente de novo.' }

$extra = @()
if ($CaFile) {
  # Antivírus que inspeciona HTTPS (ex.: Kaspersky) assina com uma CA que o Windows conhece e o container não.
  # Copiamos só o certificado PÚBLICO dessa CA para o volume e apontamos o Node (Claude Code) para ele.
  $dir = Split-Path -Parent (Resolve-Path $CaFile)
  $file = Split-Path -Leaf $CaFile
  docker run --rm --entrypoint sh -v clodfarm_workspace:/workspace -v "${dir}:/in:ro" $Image -c "mkdir -p /workspace/.farm && cp /in/$file /workspace/.farm/extra-ca.pem"
  if ($LASTEXITCODE -ne 0) { throw 'Não consegui copiar o certificado para o volume.' }
  $extra += @('-e', 'NODE_EXTRA_CA_CERTS=/workspace/.farm/extra-ca.pem')
} else {
  # já copiado numa execução anterior? então continua valendo
  docker run --rm --entrypoint sh -v clodfarm_workspace:/workspace $Image -c 'test -f /workspace/.farm/extra-ca.pem' *> $null
  if ($LASTEXITCODE -eq 0) { $extra += @('-e', 'NODE_EXTRA_CA_CERTS=/workspace/.farm/extra-ca.pem') }
}

docker rm -f $Name *> $null
docker run -d --name $Name --hostname $Name --restart unless-stopped `
  -p "127.0.0.1:${Port}:8080" `
  -e "FARM_CONTAINER_NAME=$Name" -e FARM_APPROVE_LANDING=1 @extra `
  -v clodfarm_claude-home:/home/farm/.claude -v clodfarm_workspace:/workspace `
  $Image | Out-Null
Write-Host "Escritório no ar em http://localhost:$Port"
