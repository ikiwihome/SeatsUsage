@echo off
setlocal EnableExtensions
rem ===========================================================================
rem  list-running-seats.bat
rem
rem  List every ARK enterprise seat (Coding Plan Team / Agent Plan Team) whose
rem  BillingStatus = Running(2), and print the bound sub-user name + seat API Key.
rem
rem  Data source : arkcli api trade.list_seat_infos   (read-only raw action,
rem                the only path that returns the seat ApiKey field)
rem
rem  Usage:
rem      list-running-seats.bat            -> print table on screen
rem      list-running-seats.bat csv        -> also export seats-running.csv
rem                                           next to this .bat file
rem ===========================================================================

if /i "%~1"=="csv" set "SEAT_CSV=%~dp0seats-running.csv"

rem NOTE: the marker is assembled at runtime so that this very line does not
rem       contain the marker literal (otherwise IndexOf matches it first).
powershell -NoProfile -ExecutionPolicy Bypass -Command "$m = '#' + 'PS1-BEGIN'; $src = Get-Content -LiteralPath '%~f0' -Raw -Encoding UTF8; $i = $src.IndexOf($m); if ($i -lt 0) { Write-Host '[error] PowerShell block not found'; exit 9 }; iex $src.Substring($i)"
exit /b %errorlevel%

#PS1-BEGIN
# ---------------------------------------------------------------------------
# PowerShell part (invoked by the batch wrapper above; never parsed by cmd.exe)
# ---------------------------------------------------------------------------
$ErrorActionPreference = 'Continue'
$env:ARKCLI_NO_UPDATE_NOTIFIER = '1'
$env:ARKCLI_CALLER_TYPE        = 'ai_agent'
$env:ARKCLI_CALLER_NAME        = 'copilot'
$env:ARKCLI_SKILL_NAME         = 'arkcli-api-explorer'

# --- fetch one page of seats -------------------------------------------------
# NOTE: --params must be a backslash-escaped JSON literal here, because
#       PowerShell 5.1 strips bare double quotes when handing args to native
#       commands.  '{\"A\":1}' survives, '{"A":1}' does not.
function Get-SeatPage {
    param([string]$Scene, [int]$Page)
    $body = '{\"Filter\":{},\"ProjectName\":\"default\",\"PageNumber\":' + $Page + ',\"PageSize\":100'
    if ($Scene -ne '') { $body = $body + ',\"Scene\":\"' + $Scene + '\"' }
    $body = $body + '}'

    $raw = ''
    try { $raw = (arkcli api trade.list_seat_infos --params $body 2>&1 | Out-String) } catch { return $null }

    $start = $raw.IndexOf('{')
    if ($start -lt 0) { return $null }
    try { return ($raw.Substring($start) | ConvertFrom-Json) } catch { return $null }
}

# --- collect all seats from both scene families ------------------------------
$all = @()
foreach ($scene in @('coding_plan_enterprise', 'agent_plan_enterprise')) {
    $page = 1
    $got  = 0
    while ($page -le 20) {
        $resp = Get-SeatPage -Scene $scene -Page $page
        if ($null -eq $resp -or $null -eq $resp.Result) { break }

        $items = @($resp.Result.Data)
        if ($items.Count -eq 0) { break }

        $all = $all + $items
        $got = $got + $items.Count

        $total = 0
        if ($resp.Result.Total) { $total = [int]$resp.Result.Total }

        if ($items.Count -lt 100) { break }
        if ($total -gt 0 -and $got -ge $total) { break }
        $page = $page + 1
    }
}

if ($all.Count -eq 0) {
    Write-Host ''
    Write-Host '[error] no seat data returned - check arkcli login (arkcli auth status).'
    exit 1
}

# --- keep only BillingStatus = 2 (Running), de-duplicated by SeatID ----------
$seen = @{}
$running = @()
foreach ($s in ($all | Sort-Object IdentityDetail, SeatID)) {
    if ([int]$s.BillingStatus -ne 2) { continue }
    if ($seen.ContainsKey([string]$s.SeatID)) { continue }
    $seen[[string]$s.SeatID] = $true
    $running = $running + $s
}

# --- print -------------------------------------------------------------------
Write-Host ''
Write-Host ('=== Running seats : ' + $running.Count + ' / total seats : ' + $all.Count + ' ===')
Write-Host ''

if ($running.Count -eq 0) {
    Write-Host 'No seat with BillingStatus=Running.'
} else {
    $fmt = '{0,-10} {1,-56} {2,-28} {3}'
    Write-Host ($fmt -f 'USER', 'API_KEY', 'SEAT_ID', 'PLAN/TIER')
    Write-Host ('-' * 108)
    foreach ($s in $running) {
        $plan = 'coding-plan-team'
        if ($s.Scene -eq 'agent_plan_enterprise') { $plan = 'agent-plan-team' }
        $user = [string]$s.IdentityDetail
        if ($user -eq '') { $user = '(unbound)' }
        Write-Host ($fmt -f $user, $s.ApiKey, $s.SeatID, ($plan + '/' + $s.BizInfo))
    }
}
Write-Host ''

# --- optional CSV ------------------------------------------------------------
if ($env:SEAT_CSV) {
    $rows = @()
    foreach ($s in $running) {
        $plan = 'coding-plan-team'
        if ($s.Scene -eq 'agent_plan_enterprise') { $plan = 'agent-plan-team' }

        $exp = ''
        if ([int64]$s.ExpiredTime -gt 0) {
            $exp = ([DateTimeOffset]::FromUnixTimeSeconds([int64]$s.ExpiredTime)).ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss')
        }

        $rows = $rows + [pscustomobject]@{
            SeatID   = $s.SeatID
            UserName = $s.IdentityDetail
            ApiKey   = $s.ApiKey
            Plan     = $plan
            Tier     = $s.BizInfo
            ExpireAt = $exp
        }
    }
    try {
        $rows | Export-Csv -LiteralPath $env:SEAT_CSV -NoTypeInformation -Encoding UTF8
        Write-Host ('CSV exported -> ' + $env:SEAT_CSV)
    } catch {
        Write-Host ('[warn] CSV export failed: ' + $_.Exception.Message)
    }
}
