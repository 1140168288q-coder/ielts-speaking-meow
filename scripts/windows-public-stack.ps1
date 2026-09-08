[CmdletBinding()]
param(
    [ValidateSet('Install', 'Ensure', 'Watch', 'Uninstall')]
    [string] $Mode = 'Install',
    [int] $PollSeconds = 30
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $ProjectRoot '.env.deploy'
$ComposeFile = Join-Path $ProjectRoot 'compose.yaml'
$CloudflareComposeFile = Join-Path $ProjectRoot 'compose.cloudflare.yaml'
$TunnelSecret = Join-Path $ProjectRoot 'secrets\cloudflare-tunnel-token'
$LogDirectory = Join-Path $ProjectRoot 'runtime'
$LogFile = Join-Path $LogDirectory 'public-stack-watch.log'
$TaskName = 'IeltsSpeakingMeow-PublicStack'
$WatchScript = $MyInvocation.MyCommand.Path

function Write-Log {
    param([Parameter(Mandatory = $true)][string] $Message)

    New-Item -ItemType Directory -Force -Path $LogDirectory | Out-Null
    $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
    Write-Output $line
}

function Assert-DeploymentFiles {
    foreach ($path in @($EnvFile, $ComposeFile, $CloudflareComposeFile, $TunnelSecret)) {
        if (-not (Test-Path -LiteralPath $path)) {
            throw "缺少部署文件：$path"
        }
    }
}

function Get-DockerDesktopPath {
    $running = Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if ($running -and $running.Path) {
        return $running.Path
    }

    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DockerDesktop\Docker Desktop.exe'),
        (Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe')
    )
    return $candidates |
        Where-Object { Test-Path -LiteralPath $_ } |
        Select-Object -First 1
}

function Test-DockerEngine {
    & docker.exe info --format '{{.ServerVersion}}' *> $null
    return $LASTEXITCODE -eq 0
}

function Start-DockerDesktopIfNeeded {
    if (Test-DockerEngine) {
        return
    }

    $desktopPath = Get-DockerDesktopPath
    if ($desktopPath -and -not (Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue)) {
        Write-Log 'Docker Desktop 未运行，正在启动。'
        Start-Process -FilePath $desktopPath | Out-Null
    }
}

function Wait-DockerEngine {
    param([int] $TimeoutSeconds = 180)

    Start-DockerDesktopIfNeeded
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-DockerEngine) {
            return $true
        }
        Start-Sleep -Seconds 5
    }
    return $false
}

function Invoke-Compose {
    param([Parameter(Mandatory = $true)][string[]] $Arguments)

    $common = @(
        '--env-file', $EnvFile,
        '-f', $ComposeFile,
        '-f', $CloudflareComposeFile
    )
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & docker.exe compose @common @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    foreach ($line in $output) {
        Write-Log ([string] $line)
    }
    return $exitCode -eq 0
}

function Ensure-PublicStack {
    if (-not (Wait-DockerEngine)) {
        Write-Log 'Docker 引擎在等待时间内未就绪，稍后重试。'
        return $false
    }

    Write-Log '确保 PostgreSQL、Backend 和 Cloudflare Tunnel 正在运行。'
    return Invoke-Compose -Arguments @('up', '-d')
}

function Get-PublicHealthUrl {
    $accountUrlLine = Get-Content -LiteralPath $EnvFile |
        Where-Object { $_ -match '^APP_ACCOUNT_URL=' } |
        Select-Object -First 1
    if (-not $accountUrlLine) {
        throw ' .env.deploy 缺少 APP_ACCOUNT_URL。'
    }

    $baseUrl = ($accountUrlLine -replace '^APP_ACCOUNT_URL=', '').Trim().TrimEnd('/')
    if (-not $baseUrl.StartsWith('https://')) {
        throw 'APP_ACCOUNT_URL 必须是 HTTPS 公网地址。'
    }
    return "$baseUrl/health"
}

function Test-PublicHealth {
    try {
        $healthUrl = Get-PublicHealthUrl
        $response = & curl.exe --silent --show-error --fail --max-time 12 $healthUrl 2>$null
        if ($LASTEXITCODE -ne 0) {
            return $false
        }
        return ([string] $response) -match '"status"\s*:\s*"ok"'
    }
    catch {
        return $false
    }
}

function Register-PublicStackTask {
    $powershell = Join-Path $PSHOME 'powershell.exe'
    # 计划任务必须脱离创建它的交互式控制台，否则调用方退出时
    # Windows 可能向监控进程发送 Ctrl+C（0xC000013A），导致监控立即停止。
    $arguments = "-NoProfile -NoLogo -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$WatchScript`" -Mode Watch"
    $action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
    $settings = New-ScheduledTaskSettingsSet `
        -StartWhenAvailable `
        -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries `
        -RestartCount 3 `
        -RestartInterval (New-TimeSpan -Minutes 1)
    $principal = New-ScheduledTaskPrincipal `
        -UserId "$env:USERDOMAIN\$env:USERNAME" `
        -LogonType Interactive `
        -RunLevel Limited

    Register-ScheduledTask `
        -TaskName $TaskName `
        -Action $action `
        -Trigger $trigger `
        -Settings $settings `
        -Principal $principal `
        -Description 'Keep IELTS Speaking Meow public Backend and Cloudflare Tunnel available after network changes.' `
        -Force | Out-Null
    Write-Log "已注册 Windows 登录启动任务：$TaskName"
}

function Unregister-PublicStackTask {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Log "已移除 Windows 登录启动任务：$TaskName"
}

function Invoke-Watch {
    if ($PollSeconds -lt 15) {
        throw 'PollSeconds 不能小于 15。'
    }

    $consecutiveFailures = 0
    $lastTunnelRestart = [datetime]::MinValue
    Write-Log '公网服务监控已启动；校园网恢复或 USB/热点接入后将等待 Tunnel 自动重连。'

    while ($true) {
        if (-not (Test-DockerEngine)) {
            [void] (Ensure-PublicStack)
        }
        elseif (Test-PublicHealth) {
            if ($consecutiveFailures -gt 0) {
                Write-Log '公网健康检查已恢复。'
            }
            $consecutiveFailures = 0
        }
        else {
            $consecutiveFailures++
            Write-Log "公网健康检查失败（连续 $consecutiveFailures 次）。"

            $restartAllowed = ((Get-Date) - $lastTunnelRestart).TotalMinutes -ge 5
            if ($consecutiveFailures -ge 3 -and $restartAllowed -and (Test-DockerEngine)) {
                Write-Log '连续失败超过阈值，重启 Cloudflare Tunnel 以重新选择当前网络线路。'
                [void] (Invoke-Compose -Arguments @('restart', 'cloudflared'))
                $lastTunnelRestart = Get-Date
                $consecutiveFailures = 0
            }
        }
        Start-Sleep -Seconds $PollSeconds
    }
}

Assert-DeploymentFiles

switch ($Mode) {
    'Install' {
        Register-PublicStackTask
        if (-not (Ensure-PublicStack)) {
            throw '生产服务未能启动；请查看 runtime/public-stack-watch.log。'
        }
        Start-ScheduledTask -TaskName $TaskName
        Write-Log '已启动后台监控任务。'
    }
    'Ensure' {
        if (-not (Ensure-PublicStack)) {
            throw '生产服务未能启动；请查看 runtime/public-stack-watch.log。'
        }
    }
    'Watch' {
        Invoke-Watch
    }
    'Uninstall' {
        Unregister-PublicStackTask
    }
}
