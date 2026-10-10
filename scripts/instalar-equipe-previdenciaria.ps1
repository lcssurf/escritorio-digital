# Instala (ou reorganiza) o pacote "escritório previdenciário": 5 orquestradores e 16 especialistas, em equipes.
# Pode rodar de novo à vontade: quem já existe (mesmo nome e função) é atualizado, ninguém é duplicado.
#   .\scripts\instalar-equipe-previdenciaria.ps1
param([string]$Container = 'clodfarm', [string]$Url = 'http://localhost:8080')
$ErrorActionPreference = 'Stop'
$tok = (docker exec $Container cat /workspace/.farm/overlay.token).Trim()
$h = @{ 'X-Overlay-Token' = $tok; 'X-Clodfarm' = '1' }
# O PowerShell 5.1 devolve um array JSON como um único objeto: o pipeline o desmonta em itens.
function Items($x) { $x | ForEach-Object { $_ } }
function Post($p, $obj) {
  Items (Invoke-RestMethod -Method Post -Uri "$Url$p" -Headers $h -ContentType 'application/json; charset=utf-8' `
    -Body ([Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Depth 6))))
}
$packFile = Join-Path $PSScriptRoot '..\overlay\renderer\pack-previdenciario.js'
$pack = node -e "process.stdout.write(JSON.stringify(require(process.argv[1])))" (Resolve-Path $packFile) | Out-String | ConvertFrom-Json

$list = @(Items (Invoke-RestMethod "$Url/api/team" -Headers $h))
function Find($m) { $script:list | Where-Object { $_.name -eq $m.name -and ($_.title -eq $m.title) } | Select-Object -First 1 }

$chief = $list | Where-Object id -eq 'chief'
if (-not $chief.instructions) { $chief.instructions = $pack.chief; $list = @(Post '/api/team' $chief) }

$leadId = @{}
foreach ($l in $pack.leads) {
  $cur = Find $l
  $body = @{ name = $l.name; title = $l.title; gender = $l.gender; look = $l.look; instructions = $l.instructions; lead = $true; parent = 'chief' }
  if ($cur) { $body.id = $cur.id }
  $list = @(Post '/api/team' $body)
  $leadId[$l.key] = (Find $l).id
}
foreach ($m in $pack.members) {
  $cur = Find $m
  $body = @{ name = $m.name; title = $m.title; gender = $m.gender; look = $m.look; instructions = $m.instructions; lead = $false; parent = $leadId[$m.team] }
  if ($cur) { $body.id = $cur.id }
  $list = @(Post '/api/team' $body)
}
Write-Host "Equipe: $($list.Count) pessoas"
foreach ($t in $list | Where-Object { $_.lead }) {
  Write-Host ("[{0}] {1} ({2})" -f $t.id, $t.name, $t.title)
  $list | Where-Object { $_.parent -eq $t.id } | ForEach-Object { Write-Host ("    - {0}: {1}" -f $_.name, $_.title) }
}
