<#
.SYNOPSIS
  Starts the Employee Management System: MySQL + Spring Boot backend + React/Vite UI.

.EXAMPLES
  .\run.ps1              Start anything that is not already running.
  .\run.ps1 -Build       Rebuild the backend jar before starting.
  .\run.ps1 -Stop        Stop the backend and UI (MySQL stays running).
  .\run.ps1 -StopAll     Stop backend, UI, and MySQL gracefully.
#>
param(
    [switch]$Stop,
    [switch]$Build,
    [switch]$StopAll
)

$ErrorActionPreference = 'Stop'

$root      = $PSScriptRoot
$devTools  = 'D:\dev-tools'
$java      = Join-Path $devTools 'jdk-21.0.13.1+2\bin\java.exe'
$mysqlBase = Join-Path $devTools 'mysql-8.4.9-winx64'
$mysqld    = Join-Path $mysqlBase 'bin\mysqld.exe'
$mysqlAdmin = Join-Path $mysqlBase 'bin\mysqladmin.exe'
$mysqlData = Join-Path $mysqlBase 'data'
$jar       = Join-Path $root 'target\management-0.0.1-SNAPSHOT.jar'
$uiDir     = Join-Path $root 'employee-management-ui'
$vite      = Join-Path $uiDir 'node_modules\vite\bin\vite.js'
$logDir    = $devTools

# Use the portable JDK and load secrets from a gitignored local env file.
$env:JAVA_HOME = Split-Path (Split-Path $java -Parent) -Parent
$env:PATH      = "$($env:JAVA_HOME)\bin;$env:PATH"

$envFile = Join-Path $root '.env.local'
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if (-not $line -or $line.StartsWith('#')) { return }

        $key, $value = $line -split '=', 2
        $key = $key.Trim()
        $value = $value.Trim().Trim('"', "'")

        if ($key -and -not [Environment]::GetEnvironmentVariable($key)) {
            [Environment]::SetEnvironmentVariable($key, $value)
        }
    }
}

foreach ($requiredVar in @('DB_PASSWORD', 'JWT_SECRET')) {
    if (-not [Environment]::GetEnvironmentVariable($requiredVar)) {
        throw "$requiredVar is not set. Copy .env.example to .env.local and fill it in."
    }
}

function Test-Port {
    param(
        [int]$Port,
        [string]$Url
    )
    if ($Url) {
        # A real HTTP response is the most reliable "is it up?" check.
        # curl -s keeps connection failures off stderr so ErrorActionPreference stays calm.
        $previous = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        try {
            & curl.exe -s -o NUL --max-time 3 $Url 2>$null | Out-Null
            return ($LASTEXITCODE -eq 0)
        } finally {
            $ErrorActionPreference = $previous
        }
    }
    return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Wait-Port {
    param(
        [int]$Port,
        [int]$Seconds,
        [string]$Label,
        [string]$Url
    )
    for ($i = 0; $i -lt $Seconds; $i++) {
        if (Test-Port -Port $Port -Url $Url) {
            Write-Host "$Label is ready on port $Port"
            return
        }
        Start-Sleep -Seconds 1
    }
    throw "$Label did not start within $Seconds seconds. Check the logs in $logDir."
}

function Stop-StaleProcess {
    param(
        [string]$Name,
        [string]$CommandLike
    )
    Get-CimInstance Win32_Process -Filter "name='$Name'" -ErrorAction SilentlyContinue |
        Where-Object { $_.CommandLine -like "*$CommandLike*" } |
        ForEach-Object {
            Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
            Write-Host "Stopped $Name (PID $($_.ProcessId))."
        }
}

function Stop-Port {
    param(
        [int]$Port,
        [string]$Label
    )
    $pids = @(
        Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique
    )
    if ($pids.Count -eq 0) {
        Write-Host "$Label was not running."
        return
    }
    foreach ($procId in $pids) {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-Host "Stopped $Label (PID $procId)."
    }
}

if ($Stop -or $StopAll) {
    # Match on the command line first (reliable), then fall back to the port table.
    Stop-StaleProcess -Name 'java.exe' -CommandLike $jar
    Stop-StaleProcess -Name 'node.exe' -CommandLike 'vite.js'
    Stop-Port 8080 'Backend'
    Stop-Port 5173 'Frontend'
    if ($StopAll) {
        if (Test-Path $mysqlAdmin) {
            & $mysqlAdmin -u root "-p$env:DB_PASSWORD" shutdown 2>$null
            Write-Host 'MySQL shutdown requested.'
        } else {
            Write-Host 'mysqladmin.exe not found; MySQL was left running.'
        }
    } else {
        Write-Host 'MySQL was left running (safe).'
    }
    return
}

# ---------- Preflight ----------
foreach ($required in @(
    @{ Path = $java;      Name = 'JDK 21' },
    @{ Path = $mysqld;    Name = 'MySQL server' },
    @{ Path = $mysqlData; Name = 'MySQL data folder' }
)) {
    if (-not (Test-Path $required.Path)) {
        throw "$($required.Name) not found at $($required.Path). Restore D:\dev-tools before running this script."
    }
}

# ---------- MySQL ----------
if (Test-Port 3306) {
    Write-Host 'MySQL is already running on port 3306.'
} else {
    Write-Host 'Starting MySQL...'
    Start-Process -FilePath $mysqld `
        -ArgumentList "--basedir=$mysqlBase", "--datadir=$mysqlData", '--port=3306', '--bind-address=127.0.0.1', '--console' `
        -WorkingDirectory $mysqlBase -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir 'mysql.log') `
        -RedirectStandardError (Join-Path $logDir 'mysql.err') | Out-Null
    Wait-Port 3306 90 'MySQL'
}

# ---------- Backend ----------
if ($Build -or -not (Test-Path $jar)) {
    Write-Host 'Building backend jar (this can take a minute)...'
    Push-Location $root
    try {
        & (Join-Path $root 'mvnw.cmd') package -DskipTests -q
        if ($LASTEXITCODE -ne 0) { throw 'Maven build failed.' }
    } finally {
        Pop-Location
    }
}

$apiUrl = 'http://localhost:8080/api/auth/login'
if (Test-Port -Port 8080 -Url $apiUrl) {
    Write-Host 'Backend is already running on port 8080.'
} else {
    Stop-StaleProcess -Name 'java.exe' -CommandLike $jar
    Write-Host 'Starting Spring Boot backend...'
    Start-Process -FilePath $java `
        -ArgumentList '-jar', $jar `
        -WorkingDirectory $root -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir 'backend.log') `
        -RedirectStandardError (Join-Path $logDir 'backend.err') | Out-Null
    Wait-Port -Port 8080 -Seconds 180 -Label 'Backend' -Url $apiUrl
}

# ---------- Frontend ----------
if (-not (Test-Path $vite)) {
    Write-Host 'Installing frontend dependencies...'
    Push-Location $uiDir
    try {
        npm install
        if ($LASTEXITCODE -ne 0) { throw 'npm install failed.' }
    } finally {
        Pop-Location
    }
}

$uiUrl = 'http://localhost:5173/'
if (Test-Port -Port 5173 -Url $uiUrl) {
    Write-Host 'Frontend is already running on port 5173.'
} else {
    Stop-StaleProcess -Name 'node.exe' -CommandLike 'vite.js'
    Write-Host 'Starting React/Vite frontend...'
    Start-Process -FilePath 'node.exe' `
        -ArgumentList $vite, '--host', '127.0.0.1' `
        -WorkingDirectory $uiDir -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir 'vite.log') `
        -RedirectStandardError (Join-Path $logDir 'vite.err') | Out-Null
    Wait-Port -Port 5173 -Seconds 60 -Label 'Frontend' -Url $uiUrl
}

Write-Host ''
Write-Host '============================================'
Write-Host ' Employee Management System is ready'
Write-Host '============================================'
Write-Host ' App:      http://localhost:5173'
Write-Host ' API:      http://localhost:8080/api'
Write-Host ' Admin:    admin@company.com / Admin@123'
Write-Host ' Employee: jane@company.com / Jane@123'
Write-Host " Logs:     $logDir"
Write-Host ' Stop:     .\run.ps1 -Stop'
Write-Host '============================================'
