# =============================================================
# SETUP RADIO PAMPA AR - Correr en 192.168.1.42 como Admin
# =============================================================

$PROJECT_DIR = "C:\radiolocal"
$GIT_REPO    = "https://github.com/datawebgames-jpg/radiolocal.git"
$RELAY_URL   = "https://radio-pampa-ar-production.up.railway.app"
$RELAY_SECRET = "pampa-secret-2025"

Write-Host "=== RADIO PAMPA AR - SETUP ===" -ForegroundColor Cyan

# 1. Verificar Node.js
Write-Host "`n[1/6] Verificando Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version 2>&1
    Write-Host "  Node.js OK: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  Node.js NO encontrado. Instalando..." -ForegroundColor Red
    winget install OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH","User")
}

# 2. Clonar o actualizar el proyecto
Write-Host "`n[2/6] Configurando proyecto en $PROJECT_DIR..." -ForegroundColor Yellow
if (Test-Path "$PROJECT_DIR\.git") {
    Write-Host "  Repo existe, haciendo pull..." -ForegroundColor Green
    Set-Location $PROJECT_DIR
    git pull origin main 2>&1
} else {
    Write-Host "  Clonando repo..." -ForegroundColor Green
    git clone $GIT_REPO $PROJECT_DIR 2>&1
    Set-Location $PROJECT_DIR
}

# 3. Instalar dependencias
Write-Host "`n[3/6] Instalando dependencias npm..." -ForegroundColor Yellow
Set-Location $PROJECT_DIR
npm install 2>&1 | Tail -5
Write-Host "  npm install completado" -ForegroundColor Green

# 4. Crear carpetas necesarias
Write-Host "`n[4/6] Creando carpetas..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force "$PROJECT_DIR\public\uploads" | Out-Null
New-Item -ItemType Directory -Force "$PROJECT_DIR\public\ads" | Out-Null
Write-Host "  Carpetas OK" -ForegroundColor Green

# 5. Crear archivo .env con configuracion
Write-Host "`n[5/6] Configurando variables de entorno..." -ForegroundColor Yellow
$envContent = @"
PORT=8001
RELAY_URL=$RELAY_URL
RELAY_SECRET=$RELAY_SECRET
"@
$envContent | Out-File -FilePath "$PROJECT_DIR\.env" -Encoding utf8
Write-Host "  .env creado" -ForegroundColor Green

# 6. Crear tarea programada para arrancar al iniciar Windows
Write-Host "`n[6/6] Creando tarea de inicio automatico..." -ForegroundColor Yellow
$action = New-ScheduledTaskAction -Execute "node" -Argument "server.js" -WorkingDirectory $PROJECT_DIR
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 5 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "RadioPampaAR" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Write-Host "  Tarea de inicio creada" -ForegroundColor Green

# ARRANCAR AHORA
Write-Host "`n=== ARRANCANDO SERVIDOR ===" -ForegroundColor Cyan
Set-Location $PROJECT_DIR

# Matar proceso node anterior si existe
Get-Process -Name "node" -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2

# Verificar yt-dlp y ffmpeg
Write-Host "Buscando yt-dlp..." -ForegroundColor Yellow
$ytdlp = Get-Command yt-dlp -ErrorAction SilentlyContinue
if ($ytdlp) {
    Write-Host "  yt-dlp: $($ytdlp.Source)" -ForegroundColor Green
} else {
    Write-Host "  yt-dlp no encontrado, buscando en PATH..." -ForegroundColor Red
    $ytdlpPaths = @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\yt-dlp*\yt-dlp.exe",
        "C:\yt-dlp\yt-dlp.exe",
        "$PROJECT_DIR\yt-dlp.exe"
    )
    foreach ($p in $ytdlpPaths) {
        $found = Get-Item $p -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { Write-Host "  Encontrado: $($found.FullName)" -ForegroundColor Green; break }
    }
}

$ffmpeg = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ffmpeg) {
    Write-Host "  ffmpeg: $($ffmpeg.Source)" -ForegroundColor Green
} else {
    Write-Host "  ffmpeg no en PATH, buscando..." -ForegroundColor Red
    $ffmpegPaths = Get-ChildItem "C:\Users\*\AppData\Local\Microsoft\WinGet\Packages\*FFmpeg*\bin\ffmpeg.exe" -ErrorAction SilentlyContinue
    if ($ffmpegPaths) {
        Write-Host "  Encontrado: $($ffmpegPaths[0].FullName)" -ForegroundColor Green
        # Agregar al .env
        Add-Content "$PROJECT_DIR\.env" "FFMPEG_PATH=$($ffmpegPaths[0].FullName)"
    }
    $ytdlpExePaths = Get-ChildItem "C:\Users\*\AppData\Local\Microsoft\WinGet\Packages\yt-dlp*\yt-dlp.exe" -ErrorAction SilentlyContinue
    if ($ytdlpExePaths) {
        Write-Host "  yt-dlp Encontrado: $($ytdlpExePaths[0].FullName)" -ForegroundColor Green
        Add-Content "$PROJECT_DIR\.env" "YT_DLP_PATH=$($ytdlpExePaths[0].FullName)"
    }
}

# Arrancar en background y abrir firewall
Write-Host "`nAbriendo puerto 8001 en firewall..." -ForegroundColor Yellow
netsh advfirewall firewall delete rule name="RadioPampaAR" 2>&1 | Out-Null
netsh advfirewall firewall add rule name="RadioPampaAR" dir=in action=allow protocol=TCP localport=8001

Write-Host "`nArrancando node server.js..." -ForegroundColor Cyan
$proc = Start-Process -FilePath "node" -ArgumentList "server.js" -WorkingDirectory $PROJECT_DIR -PassThru -WindowStyle Normal
Start-Sleep -Seconds 4

if ($proc -and !$proc.HasExited) {
    Write-Host "`n✅ SERVIDOR ARRANCADO - PID $($proc.Id)" -ForegroundColor Green
    Write-Host "   Admin:    http://192.168.1.42:8001/admin.html" -ForegroundColor Cyan
    Write-Host "   Oyentes:  https://radio-pampa-ar-production.up.railway.app/" -ForegroundColor Cyan
} else {
    Write-Host "`n❌ El servidor no arrancó. Corriendo en consola para ver error..." -ForegroundColor Red
    Set-Location $PROJECT_DIR
    node server.js
}
