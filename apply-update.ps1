# Run from your project folder (where package.json is):
#   powershell -ExecutionPolicy Bypass -File .\apply-update.ps1
# Removes the old ENS files (their copies now live in legacy\ens) and clears Next's cache.
$old = @(
  "src\server\identity\ens.ts",
  "src\lib\subdomain.ts",
  "src\lib\resolver.ts",
  "src\lib\contract.ts",
  "src\app\api\subdomain\check\route.ts",
  "scripts\test-ens.ts"
)
foreach ($f in $old) { if (Test-Path $f) { Remove-Item $f -Force; Write-Host "Removed $f" } }
foreach ($d in @("src\server\identity", "src\app\api\subdomain\check", "src\app\api\subdomain")) {
  if ((Test-Path $d) -and -not (Get-ChildItem $d -Recurse -File)) { Remove-Item $d -Recurse -Force }
}
if (Test-Path ".next") { Remove-Item ".next" -Recurse -Force; Write-Host "Cleared .next cache" }
Write-Host "Done. Now run: npm install; npm run dev"
