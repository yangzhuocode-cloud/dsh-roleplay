param(
  [Parameter(Mandatory)][ValidateSet('0.2.2-rc.3','0.2.3-alpha.2')][string]$Version,
  [Parameter(Mandatory)][string]$Runtime,
  [Parameter(Mandatory)][string]$HomeDirectory,
  [string]$NodeExecutable = 'node',
  [int]$Port = 0
)
$ErrorActionPreference = 'Stop'
$runtimeRoot = [IO.Path]::GetFullPath($Runtime)
$testHome = [IO.Path]::GetFullPath($HomeDirectory)
if ($env:DSH_HOME -and $testHome -eq [IO.Path]::GetFullPath($env:DSH_HOME)) {
  throw 'Refusing the inherited DSH_HOME; select a separate test Home.'
}
$manifestPath = Join-Path $runtimeRoot 'node_modules/@deepseek-ai/dsh/package.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.version -ne $Version) { throw "Runtime version $($manifest.version) does not match requested $Version" }
$previousHome = $env:DSH_HOME
try {
  $env:DSH_HOME = $testHome
  & $NodeExecutable (Join-Path $runtimeRoot 'node_modules/@deepseek-ai/dsh/lib/bin.js') --profile web --no-open --host 127.0.0.1 --port $Port
  if ($LASTEXITCODE -ne 0) { throw "DSH exited with $LASTEXITCODE" }
} finally {
  $env:DSH_HOME = $previousHome
}
