[CmdletBinding()]
param(
    [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Read-SecretText {
    param(
        [Parameter(Mandatory = $true)][string]$Prompt,
        [switch]$AllowEmpty
    )

    $secure = Read-Host -Prompt $Prompt -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }

    if (-not $AllowEmpty -and [string]::IsNullOrWhiteSpace($value)) {
        throw "此项不能为空。请重新运行脚本。"
    }

    return $value
}

function Set-EnvLine {
    param(
        [Parameter(Mandatory = $true)][System.Collections.IList]$Lines,
        [Parameter(Mandatory = $true)][string]$Key,
        [AllowEmptyString()][string]$Value
    )

    $escapedKey = [regex]::Escape($Key)
    $replacement = "$Key=$Value"
    $found = $false
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        if ($Lines[$i] -match "^$escapedKey=") {
            $Lines[$i] = $replacement
            $found = $true
        }
    }
    if (-not $found) {
        [void]$Lines.Add($replacement)
    }
}

function New-RandomHex {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $rng.GetBytes($bytes)
    }
    finally {
        $rng.Dispose()
    }

    # Avoid newer static APIs so the script also works with Windows PowerShell 5.1.
    return (($bytes | ForEach-Object { $_.ToString("x2") }) -join "")
}

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$examplePath = Join-Path $ProjectRoot ".env.deploy.example"
$envPath = Join-Path $ProjectRoot ".env.deploy"
$secretDir = Join-Path $ProjectRoot "secrets"
$tunnelSecretPath = Join-Path $secretDir "cloudflare-tunnel-token"

if (-not (Test-Path -LiteralPath $examplePath)) {
    throw "找不到 .env.deploy.example：$examplePath"
}

if (Test-Path -LiteralPath $envPath) {
    $raw = [IO.File]::ReadAllText($envPath)
}
else {
    $raw = [IO.File]::ReadAllText($examplePath)
}

$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in ($raw -split "`r?`n")) {
    $lines.Add($line)
}

$existingPostgres = ($lines | Where-Object { $_ -match '^POSTGRES_PASSWORD=' } | Select-Object -First 1)
if ([string]::IsNullOrWhiteSpace($existingPostgres) -or $existingPostgres -match '^POSTGRES_PASSWORD=replace_with_') {
    Set-EnvLine -Lines $lines -Key "POSTGRES_PASSWORD" -Value (New-RandomHex)
}

Set-EnvLine -Lines $lines -Key "APP_ACCOUNT_URL" -Value "https://api.formomentward.com"

Write-Host "将为本机生产部署配置环境变量。输入密钥时不会显示字符，按 Enter 提交。"
$deepSeek = Read-SecretText "DeepSeek API Key（直接回车可跳过）" -AllowEmpty
if ($deepSeek) { Set-EnvLine -Lines $lines -Key "DEEPSEEK_API_KEY" -Value $deepSeek }

$volcApi = Read-SecretText "火山 TTS API Key（直接回车可跳过）" -AllowEmpty
if ($volcApi) { Set-EnvLine -Lines $lines -Key "VOLC_API_KEY" -Value $volcApi }

$volcAppId = Read-SecretText "火山 TTS App ID（直接回车可跳过）" -AllowEmpty
if ($volcAppId) { Set-EnvLine -Lines $lines -Key "VOLC_APP_ID" -Value $volcAppId }

$volcAccessToken = Read-SecretText "火山 TTS Access Token（直接回车可跳过）" -AllowEmpty
if ($volcAccessToken) { Set-EnvLine -Lines $lines -Key "VOLC_ACCESS_TOKEN" -Value $volcAccessToken }

$utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($envPath, (($lines -join "`n").TrimEnd() + "`n"), $utf8NoBom)

$tunnelToken = Read-SecretText "Cloudflare Tunnel Token（必填，输入不会显示）"
[IO.Directory]::CreateDirectory($secretDir) | Out-Null
[IO.File]::WriteAllText($tunnelSecretPath, $tunnelToken, $utf8NoBom)

Write-Host "已准备 .env.deploy 和 secrets/cloudflare-tunnel-token。"
Write-Host "密钥未打印、未提交 Git。下一步可运行 Docker Compose 部署。"
