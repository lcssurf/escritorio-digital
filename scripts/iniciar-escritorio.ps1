# Sobe (ou recria) o escritorio digital no Docker, com a aprovacao humana ligada.
#   .\scripts\iniciar-escritorio.ps1                      # imagem escritorio-digital:dev
#   .\scripts\iniciar-escritorio.ps1 -CaFile C:\ca.pem    # confia numa CA extra (antivirus que refaz o HTTPS)
# O login e o trabalho ficam nos volumes do Docker: recriar o container nao perde nada.
# O que o advogado aprova tambem e copiado para a pasta  Documentos\Escritorio Digital  (com acento), no Windows.
param(
  [string]$Image = 'escritorio-digital:dev',
  [string]$Name = 'clodfarm',
  [int]$Port = 8080,
  [string]$CaFile = '',
  [string]$ExportDir = ''
)
$ErrorActionPreference = 'Stop'

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'O Docker nao esta rodando. Abra o Docker Desktop e tente de novo.' }

if (-not $ExportDir) {
  # "Escritorio Digital" com o o acentuado, montado por codigo para nao depender da codificacao deste arquivo
  $folder = 'Escrit' + [char]0x00F3 + 'rio Digital'
  $ExportDir = Join-Path ([Environment]::GetFolderPath('MyDocuments')) $folder
}
New-Item -ItemType Directory -Force $ExportDir | Out-Null

$extra = @()
if ($CaFile) {
  # Antivirus que inspeciona HTTPS (ex.: Kaspersky) assina com uma CA que o Windows conhece e o container nao.
  # Copiamos so o certificado PUBLICO dessa CA para o volume e apontamos o Node (Claude Code) para ele.
  $dir = Split-Path -Parent (Resolve-Path $CaFile)
  $file = Split-Path -Leaf $CaFile
  docker run --rm --entrypoint sh -v clodfarm_workspace:/workspace -v "${dir}:/in:ro" $Image -c "mkdir -p /workspace/.farm && cp /in/$file /workspace/.farm/extra-ca.pem"
  if ($LASTEXITCODE -ne 0) { throw 'Nao consegui copiar o certificado para o volume.' }
  $extra += @('-e', 'NODE_EXTRA_CA_CERTS=/workspace/.farm/extra-ca.pem')
} else {
  # ja copiado numa execucao anterior? entao continua valendo
  docker run --rm --entrypoint sh -v clodfarm_workspace:/workspace $Image -c 'test -f /workspace/.farm/extra-ca.pem' *> $null
  if ($LASTEXITCODE -eq 0) { $extra += @('-e', 'NODE_EXTRA_CA_CERTS=/workspace/.farm/extra-ca.pem') }
}

docker rm -f $Name *> $null
docker run -d --name $Name --hostname $Name --restart unless-stopped `
  -p "127.0.0.1:${Port}:8080" `
  -e "FARM_CONTAINER_NAME=$Name" -e FARM_APPROVE_LANDING=1 -e FARM_EXPORT_DIR=/export @extra `
  -v clodfarm_claude-home:/home/farm/.claude -v clodfarm_workspace:/workspace -v "${ExportDir}:/export" `
  $Image | Out-Null
Write-Host "Escritorio no ar em http://localhost:$Port"
Write-Host "Entregas aprovadas: $ExportDir"
