[CmdletBinding()]
param(
    [string]$PagesOrigin = "https://icaropv01.github.io",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$serverDirectory = Join-Path $root "studio-server"
$envPath = Join-Path $serverDirectory ".env.local"

if (-not (Test-Path -LiteralPath $serverDirectory -PathType Container)) {
    throw "A pasta studio-server ainda não existe. Atualize o projeto antes de configurar o segredo."
}

if ((Test-Path -LiteralPath $envPath) -and -not $Force) {
    throw "A configuração local já existe. Use -Force somente se quiser substituí-la."
}

function ConvertFrom-SecureValue {
    param([Parameter(Mandatory)][Security.SecureString]$Value)

    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
    try {
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
}

function ConvertTo-EnvValue {
    param([Parameter(Mandatory)][string]$Value)

    if ($Value.Contains("`r") -or $Value.Contains("`n")) {
        throw "Valores de configuração não podem conter quebras de linha."
    }
    $escaped = $Value.Replace("\", "\\").Replace('"', '\"')
    return '"' + $escaped + '"'
}

function ConvertTo-ExactHttpsOrigin {
    param([Parameter(Mandatory)][string]$Value)

    $origin = $null
    if (-not [Uri]::TryCreate($Value, [UriKind]::Absolute, [ref]$origin)) {
        throw "A origem do GitHub Pages precisa ser uma URL HTTPS absoluta."
    }
    if (
        $origin.Scheme -ne "https" -or
        -not [string]::IsNullOrEmpty($origin.UserInfo) -or
        $origin.AbsolutePath -ne "/" -or
        -not [string]::IsNullOrEmpty($origin.Query) -or
        -not [string]::IsNullOrEmpty($origin.Fragment)
    ) {
        throw "Informe somente a origem HTTPS, sem caminho, credenciais, query ou fragmento."
    }
    return $origin.GetLeftPart([UriPartial]::Authority)
}

$exactPagesOrigin = ConvertTo-ExactHttpsOrigin -Value $PagesOrigin

$secureApiKey = Read-Host "Cole a chave da API Verboo (ela não será exibida)" -AsSecureString
$apiKey = ConvertFrom-SecureValue -Value $secureApiKey

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw "A chave da Verboo não pode ficar vazia."
}

if ($apiKey -notmatch '^vbk_[A-Za-z0-9_\-]+$') {
    throw "A chave não tem o formato esperado da Verboo."
}

$lines = @(
    "# Gerado por scripts/configure-studio.ps1. Nunca versionar este arquivo.",
    "STUDIO_HOST=127.0.0.1",
    "STUDIO_PORT=8787",
    "STUDIO_DATABASE_PATH=./data/studio.sqlite",
    "STUDIO_CORS_ORIGINS=$(ConvertTo-EnvValue -Value $exactPagesOrigin)",
    "STUDIO_COOKIE_SECURE=true",
    "STUDIO_COOKIE_SAME_SITE=none",
    "STUDIO_SESSION_TTL_HOURS=168",
    "STUDIO_INVITE_TTL_HOURS=24",
    "STUDIO_DEV_AUTH_ENABLED=false",
    "VERBOO_BASE_URL=https://code.verboo.ai/router/v1",
    "VERBOO_DEFAULT_MODEL=pro/deepseek-v4-flash",
    "VERBOO_API_KEY=$(ConvertTo-EnvValue -Value $apiKey)"
)

[IO.File]::WriteAllLines($envPath, $lines, [Text.UTF8Encoding]::new($false))

if ($IsWindows -or $env:OS -eq "Windows_NT") {
    & icacls.exe $envPath /inheritance:r /grant:r "$env:USERNAME`:(R,W)" | Out-Null
}

$apiKey = $null
$secureApiKey.Dispose()

Write-Host "Configuração criada em studio-server/.env.local."
Write-Host "O arquivo está ignorado pelo Git e a chave não foi impressa."
