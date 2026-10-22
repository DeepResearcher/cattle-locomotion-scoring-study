param([Parameter(Mandatory=$true)][switch]$SharingPermissionConfirmed)
$ErrorActionPreference='Stop'
if (!$SharingPermissionConfirmed) { throw 'Confirm restricted sharing permission before uploading.' }
$env:NODE_TLS_REJECT_UNAUTHORIZED='1'
$study=Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$private=Join-Path $study 'private'
$verification=Get-Content -LiteralPath (Join-Path $study 'reports\Rating_Context_Verification.json') -Raw | ConvertFrom-Json
if (!$verification.completed -or $verification.rating_clips -ne 76) { throw 'The full rating clip export has not passed verification.' }
$manifest=Get-Content -LiteralPath (Join-Path $private 'rating_manifest.json') -Raw | ConvertFrom-Json
$ledgerFile=Join-Path $private 'r2_upload_ledger.local.json'
$ledger=@{}
if (Test-Path -LiteralPath $ledgerFile) {
  $saved=Get-Content -LiteralPath $ledgerFile -Raw | ConvertFrom-Json
  foreach ($property in $saved.PSObject.Properties) { $ledger[$property.Name]=$property.Value }
}
foreach ($clip in $manifest.clips) {
  foreach ($extension in @('mp4','jpg')) {
    $key=$clip.id+'.'+$extension
    $file=Join-Path (Join-Path $private 'rating_web_media') $key
    $hash=(Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash
    if ($ledger.ContainsKey($key) -and $ledger[$key] -eq $hash) { continue }
    $contentType=if ($extension -eq 'mp4') { 'video/mp4' } else { 'image/jpeg' }
    $result=& cf r2 objects put $key --bucket-name paper3-lcs-private-20261022 --cf-r2-jurisdiction eu --content-type $contentType --file $file -q 2>&1
    if ($LASTEXITCODE -ne 0) { throw ($result -join "`n") }
    $ledger[$key]=$hash
    $ledger | ConvertTo-Json | Set-Content -LiteralPath $ledgerFile -Encoding UTF8
    Write-Output ('Uploaded private object '+$key+' ('+$ledger.Count+'/152)')
  }
}
Write-Output 'All 152 private media objects uploaded. No public bucket access was enabled.'
