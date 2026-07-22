param(
  [switch]$NoBrowser
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$url = "http://127.0.0.1:5173"
$serverArgs = @("run", "dev", "--", "--port", "5173", "--strictPort")

function Test-StudyJournalServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
    return $response.StatusCode -eq 200 -and $response.Content -match 'src="/src/main\.tsx"'
  } catch {
    return $false
  }
}

try {
  if (-not (Test-StudyJournalServer)) {
    $listener = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue
    if ($listener) {
      throw "端口 5173 已被其他程序占用，无法启动学习日志。请关闭该程序后重试。"
    }

    Start-Process -FilePath "npm.cmd" -ArgumentList $serverArgs -WorkingDirectory $projectRoot -WindowStyle Hidden

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
      Start-Sleep -Milliseconds 300
      if (Test-StudyJournalServer) {
        $ready = $true
        break
      }
    }

    if (-not $ready) {
      throw "学习日志 Web 服务未能在 10 秒内启动。请确认 Node.js 已安装，并在项目目录执行 npm ci 后重试。"
    }
  }

  if (-not $NoBrowser) {
    Start-Process $url
  }
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($_.Exception.Message, "学习日志 Web 启动失败", "OK", "Error") | Out-Null
  exit 1
}
