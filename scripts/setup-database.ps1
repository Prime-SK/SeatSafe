#Requires -Version 7.0
param([switch]$KeepOpen)

$ErrorActionPreference = 'Stop'
$seatSafeRoot = Split-Path -Parent $PSScriptRoot
$seatSafeEnvPath = Join-Path $seatSafeRoot 'api/.env'
$seatSafeStatusDirectory = Join-Path $seatSafeRoot '.tmp'
$seatSafeStatusPath = Join-Path $seatSafeStatusDirectory 'database-setup-status.json'
$seatSafePsql = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
$seatSafePreviousPgPassword = $env:PGPASSWORD
$seatSafeAdminSecret = $null
$seatSafeSecretPointer = [IntPtr]::Zero
$seatSafeStagedEnvPath = $null
$seatSafeRoleCreated = $false
$seatSafeFinished = $false
$seatSafeSetupStage = 'preflight'
$seatSafeFailureType = $null
$seatSafeFailureId = $null

function Write-SeatSafeSetupStatus([string]$state) {
    New-Item -ItemType Directory -Path $seatSafeStatusDirectory -Force | Out-Null
    @{ state = $state; database = 'seatsafe_dev'; role = 'seatsafe_app'; stage = $seatSafeSetupStage; failureType = $seatSafeFailureType; failureId = $seatSafeFailureId } |
        ConvertTo-Json | Set-Content -LiteralPath $seatSafeStatusPath
}

function Invoke-SeatSafeSql([string]$sql) {
    # SQL is sent on stdin, keeping generated passwords out of command arguments.
    $result = $sql | & $seatSafePsql -X -A -t --no-password -h localhost -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL command failed. Check the local terminal error.' }
    return ($result -join "`n").Trim()
}

try {
    if (-not (Test-Path -LiteralPath $seatSafePsql)) { throw 'PostgreSQL 18 psql was not found at the documented installation path.' }
    $seatSafeOriginalEnv = if (Test-Path -LiteralPath $seatSafeEnvPath) {
        [IO.File]::ReadAllText($seatSafeEnvPath)
    } else { '' }
    $seatSafeSettings = [ordered]@{
        DB_HOST = 'localhost'; DB_PORT = '5432'; DB_NAME = 'seatsafe_dev'; DB_USER = 'seatsafe_app'; DB_PASSWORD = ''
    }
    foreach ($key in $seatSafeSettings.Keys) {
        $existing = [regex]::Matches($seatSafeOriginalEnv, "(?m)^\s*(?:export\s+)?$key\s*=([^\r\n]*)")
        if ($existing.Count -gt 1) { throw "Multiple $key entries exist. Resolve the local configuration before setup." }
        if ($existing.Count -eq 1) {
            $value = $existing[0].Groups[1].Value.Trim().Trim('"', "'")
            if ($value.Length -gt 0 -and ($key -eq 'DB_PASSWORD' -or $value -ne $seatSafeSettings[$key])) {
                throw "$key already contains a local setting. Setup will not overwrite it."
            }
        }
    }

    $seatSafeSetupStage = 'local-password-entry'
    Write-SeatSafeSetupStatus 'waiting-for-local-password'
    Write-Host 'SeatSafe PostgreSQL setup' -ForegroundColor Cyan
    Write-Host 'Creates seatsafe_dev and seatsafe_app only if neither name already exists.'
    Write-Host 'The project password is generated locally and saved in api/.env; it is never printed.'
    $seatSafeAdminSecret = Read-Host 'Enter your local postgres administrator password' -AsSecureString
    $seatSafeSecretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seatSafeAdminSecret)
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($seatSafeSecretPointer)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($seatSafeSecretPointer)
    $seatSafeSecretPointer = [IntPtr]::Zero

    $seatSafeSetupStage = 'administrator-login-and-name-check'
    $seatSafeExistingNames = Invoke-SeatSafeSql @'
SELECT (EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'seatsafe_app') OR
        EXISTS (SELECT 1 FROM pg_database WHERE datname = 'seatsafe_dev'))::int;
'@
    if ($seatSafeExistingNames -ne '0') { throw 'The role or database name already exists. Nothing was overwritten; inspect the existing objects before continuing.' }

    $seatSafeProjectPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $seatSafeSettings['DB_PASSWORD'] = $seatSafeProjectPassword
    $seatSafeUpdatedEnv = $seatSafeOriginalEnv
    if ($seatSafeUpdatedEnv.Length -eq 0) { $seatSafeUpdatedEnv = "NODE_ENV=development`nPORT=3000`n" }
    foreach ($key in $seatSafeSettings.Keys) {
        $pattern = "(?m)^\s*(?:export\s+)?$key\s*=[^\r\n]*"
        $line = "$key=$($seatSafeSettings[$key])"
        if ([regex]::IsMatch($seatSafeUpdatedEnv, $pattern)) {
            $seatSafeUpdatedEnv = [regex]::Replace($seatSafeUpdatedEnv, $pattern, $line)
        } else {
            $seatSafeUpdatedEnv = $seatSafeUpdatedEnv.TrimEnd("`r", "`n") + "`n$line`n"
        }
    }
    $seatSafeStagedEnvPath = Join-Path (Split-Path -Parent $seatSafeEnvPath) ('.env.setup-' + [guid]::NewGuid().ToString('N') + '.tmp')
    [IO.File]::WriteAllText($seatSafeStagedEnvPath, $seatSafeUpdatedEnv, [Text.UTF8Encoding]::new($false))

    $seatSafeSetupStage = 'role-creation'
    Invoke-SeatSafeSql "CREATE ROLE seatsafe_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '$seatSafeProjectPassword';" | Out-Null
    $seatSafeRoleCreated = $true
    $seatSafeSetupStage = 'database-creation'
    Invoke-SeatSafeSql 'CREATE DATABASE seatsafe_dev OWNER seatsafe_app;' | Out-Null

    $seatSafeSetupStage = 'local-configuration-save'
    $seatSafeCurrentEnv = if (Test-Path -LiteralPath $seatSafeEnvPath) { [IO.File]::ReadAllText($seatSafeEnvPath) } else { '' }
    if ($seatSafeCurrentEnv -ne $seatSafeOriginalEnv) { throw 'api/.env changed during setup. The staged file was preserved; no local settings were overwritten.' }
    [IO.File]::Move($seatSafeStagedEnvPath, $seatSafeEnvPath, $true)
    $seatSafeStagedEnvPath = $null
    $seatSafeFinished = $true
    $seatSafeSetupStage = 'complete'
    Write-SeatSafeSetupStatus 'complete'
    Write-Host 'Created seatsafe_dev owned by seatsafe_app. Saved its generated password in api/.env.' -ForegroundColor Green
} catch {
    $seatSafeFailureType = $_.Exception.GetType().Name
    $seatSafeFailureId = $_.FullyQualifiedErrorId
    Write-SeatSafeSetupStatus 'failed'
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($seatSafeRoleCreated -and $seatSafeStagedEnvPath) {
        Write-Host 'A role was created before setup failed. Its credentials remain in the ignored .env.setup temporary file; do not delete it until you recover the configuration.'
    }
} finally {
    $env:PGPASSWORD = $seatSafePreviousPgPassword
    if ($seatSafeSecretPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($seatSafeSecretPointer) }
    if ($seatSafeAdminSecret) { $seatSafeAdminSecret.Dispose() }
    if ($seatSafeStagedEnvPath -and -not $seatSafeRoleCreated) { Remove-Item -LiteralPath $seatSafeStagedEnvPath -ErrorAction SilentlyContinue }
    if ($KeepOpen) { Read-Host 'Press Enter to close this setup window' | Out-Null }
}
if (-not $seatSafeFinished) { exit 1 }
