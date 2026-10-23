param([ValidateSet('encrypt','decrypt')] [string]$Operation)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$bytes = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
$scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
if ($Operation -eq 'encrypt') {
    $result = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, $scope)
} else {
    $result = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, $scope)
}
[Console]::Out.Write([Convert]::ToBase64String($result))
