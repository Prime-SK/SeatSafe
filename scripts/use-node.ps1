# Dot-source this file so its npm/npx aliases stay in your current terminal:
# . .\scripts\use-node.ps1
if ($MyInvocation.InvocationName -ne '.') {
    throw 'Dot-source this script: . .\scripts\use-node.ps1'
}

$bundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$nodeCandidates = @((Get-Command node.exe -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source }), $bundledNode) | ForEach-Object { $_ } | Select-Object -Unique
$selectedNode = $null

foreach ($nodeCandidate in $nodeCandidates) {
    if (-not (Test-Path -LiteralPath $nodeCandidate)) { continue }
    $candidateVersion = [version]((& $nodeCandidate --version).Trim().TrimStart('v'))
    if ($candidateVersion.Major -eq 24 -and $candidateVersion -ge [version]'24.15.0') {
        $selectedNode = $nodeCandidate
        break
    }
}

if (-not $selectedNode) {
    throw 'Install Node.js 24 LTS (24.15.0 or newer), reopen PowerShell, and try again. See docs/phases/phase-01-environment.md.'
}

$npmCommands = @(Get-Command npm.cmd -All -ErrorAction SilentlyContinue)
$projectRoot = Split-Path -Parent $PSScriptRoot
$localNpmDirectory = Join-Path $projectRoot '.tools\npm'
$npmDirectories = @($localNpmDirectory, (Split-Path -Parent $selectedNode)) + @($npmCommands | ForEach-Object { Split-Path -Parent $_.Source })
$selectedNpm = $null

foreach ($npmDirectory in ($npmDirectories | Select-Object -Unique)) {
    $npmCandidate = Join-Path $npmDirectory 'node_modules\npm\bin\npm-cli.js'
    if (Test-Path -LiteralPath $npmCandidate) {
        $selectedNpm = $npmCandidate
        break
    }
}

if (-not $selectedNpm) {
    throw 'npm was not found. Install the standard Node.js 24 LTS distribution, which includes npm.'
}

# PATH lets subprocesses started by npm use the selected Node executable too.
$env:PATH = (Split-Path -Parent $selectedNode) + [IO.Path]::PathSeparator + $env:PATH
$env:SEATSAFE_NODE_EXE = $selectedNode
$env:SEATSAFE_NPM_CLI = $selectedNpm
$env:SEATSAFE_NPX_CLI = Join-Path (Split-Path -Parent $selectedNpm) 'npx-cli.js'

# npm.cmd next to an older node.exe can still choose that older executable.
# Explicitly invoking npm's JavaScript entrypoint avoids that mismatch.
# Native command wrappers preserve npm's argument separator (`--`).
# PowerShell function wrappers can consume it before npm receives it.
Set-Alias -Name npm -Value (Join-Path $PSScriptRoot 'npm.cmd') -Scope Global
Set-Alias -Name npx -Value (Join-Path $PSScriptRoot 'npx.cmd') -Scope Global

Write-Host "SeatSafe terminal: Node $(& $selectedNode --version), npm $(& $selectedNode $selectedNpm --version)"
Write-Host 'Activation lasts for this terminal only. Use npm and npx (without .cmd).'
