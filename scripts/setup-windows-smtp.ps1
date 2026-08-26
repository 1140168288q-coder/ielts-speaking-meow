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

function Read-OptionalText {
    param(
        [Parameter(Mandatory = $true)][string]$Prompt,
        [Parameter(Mandatory = $true)][string]$Default
    )

    $value = Read-Host -Prompt "$Prompt [$Default]"
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $Default
    }
    return $value.Trim()
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

$ProjectRoot = (Resolve-Path $ProjectRoot).Path
$envPath = Join-Path $ProjectRoot ".env.deploy"
if (-not (Test-Path -LiteralPath $envPath)) {
    throw "找不到 .env.deploy：$envPath。请先运行 setup-windows-deploy.ps1。"
}

$raw = [IO.File]::ReadAllText($envPath)
$lines = [System.Collections.Generic.List[string]]::new()
foreach ($line in ($raw -split "`r?`n")) {
    $lines.Add($line)
}

$hasExistingPassword = $false
foreach ($line in $lines) {
    if ($line -match '^SMTP_PASSWORD=(.+)$' -and -not [string]::IsNullOrWhiteSpace($matches[1])) {
        $hasExistingPassword = $true
        break
    }
}

Write-Host "将配置 Resend SMTP。密码/API Key 只在本机隐藏输入，不会显示或打印。"
$smtpHost = Read-OptionalText "SMTP 主机" "smtp.resend.com"
$smtpPortText = Read-OptionalText "SMTP 端口" "465"
$smtpUser = Read-OptionalText "SMTP 用户名" "resend"
$smtpFrom = Read-OptionalText "发件地址" "noreply@formomentward.com"
$smtpTlsMode = (Read-OptionalText "TLS 模式（ssl 或 starttls）" "ssl").ToLowerInvariant()

$smtpPort = 0
if (-not [int]::TryParse($smtpPortText, [ref]$smtpPort) -or $smtpPort -lt 1 -or $smtpPort -gt 65535) {
    throw "SMTP 端口必须是 1-65535 的整数。"
}
if ($smtpTlsMode -notin @("ssl", "starttls")) {
    throw "TLS 模式只能是 ssl 或 starttls。"
}

$smtpPassword = Read-SecretText "SMTP 密码（输入新的 Resend API Key，不会显示）" -AllowEmpty
if ($smtpPassword) {
    Set-EnvLine -Lines $lines -Key "SMTP_PASSWORD" -Value $smtpPassword
}
elseif (-not $hasExistingPassword) {
    throw "SMTP_PASSWORD 尚未配置。请重新运行并输入新的 Resend API Key。"
}

Set-EnvLine -Lines $lines -Key "SMTP_HOST" -Value $smtpHost
Set-EnvLine -Lines $lines -Key "SMTP_PORT" -Value ([string]$smtpPort)
Set-EnvLine -Lines $lines -Key "SMTP_USER" -Value $smtpUser
Set-EnvLine -Lines $lines -Key "SMTP_FROM" -Value $smtpFrom
Set-EnvLine -Lines $lines -Key "SMTP_TLS_MODE" -Value $smtpTlsMode

$utf8NoBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText($envPath, (($lines -join "`n").TrimEnd() + "`n"), $utf8NoBom)

Write-Host "SMTP 配置已写入 .env.deploy，密钥未打印、未提交 Git。"
Write-Host "下一步将重启 Backend 并发送测试邮件。"
