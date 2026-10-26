# Invoked by the Node seed command. Never run with password arguments or save its output.
$ErrorActionPreference = 'Stop'
if ([Console]::IsInputRedirected -or -not [Console]::IsOutputRedirected -or $args.Count -ne 0) { exit 3 }
$passwordPointer = [IntPtr]::Zero
$confirmationPointer = [IntPtr]::Zero
$securePassword = $null
$secureConfirmation = $null
try {
    [Console]::Error.Write('Display name: ')
    $displayName = Read-Host
    [Console]::Error.Write('Email: ')
    $email = Read-Host
    [Console]::Error.Write('Password (hidden): ')
    $securePassword = Read-Host -AsSecureString
    [Console]::Error.Write('Confirm password (hidden): ')
    $secureConfirmation = Read-Host -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    $confirmationPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureConfirmation)
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $confirmation = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($confirmationPointer)
    if (-not [string]::Equals($password, $confirmation, [StringComparison]::Ordinal)) { exit 2 }
    @{ displayName = $displayName; email = $email; password = $password } | ConvertTo-Json -Compress
} catch {
    # No raw PowerShell error records or submitted values leave this helper.
    exit 3
} finally {
    if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
    if ($confirmationPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($confirmationPointer) }
    if ($null -ne $securePassword) { $securePassword.Dispose() }
    if ($null -ne $secureConfirmation) { $secureConfirmation.Dispose() }
    $password = $null
    $confirmation = $null
}
