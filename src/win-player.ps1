# VibeAudio Windows player: one long-lived process driving MediaPlayer. Lines on stdin:
#   play <volume 0-1> <fade-in seconds> <path to wav>
#   volume <volume 0-1> <ramp seconds>      (everything sounding now)
# End of input - a closed pipe, or the daemon dying - fades out and exits, so the
# audio can never outlive whoever started it. Run with -EncodedCommand, which no
# execution policy applies to.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore
$ci = [Globalization.CultureInfo]::InvariantCulture
$clock = [Diagnostics.Stopwatch]::StartNew()
$players = New-Object Collections.ArrayList
$gain = 1.0; $target = 1.0; $rate = 0.0   # gain slews to target at $rate per second
$closing = $false; $closeAt = 0.0
$in = New-Object IO.StreamReader([Console]::OpenStandardInput(), [Text.Encoding]::UTF8)
$pending = $null
$last = 0.0
$pump = [Action]{}
$bg = [Windows.Threading.DispatcherPriority]::Background
while ($true) {
  $now = $clock.Elapsed.TotalSeconds
  if (-not $closing) {
    if ($null -eq $pending) { $pending = $in.ReadLineAsync() }
    if ($pending.IsCompleted) {
      $line = $pending.Result
      $pending = $null
      if ($null -eq $line) {
        [Console]::Error.WriteLine('vibe: eof at ' + $now)
        $closing = $true; $closeAt = $now + 0.35
        $target = 0.0; $rate = $gain / 0.3
      } elseif ($line -match '^volume (\S+) (\S+)$') {
        $target = [double]::Parse($Matches[1], $ci)
        $ramp = [double]::Parse($Matches[2], $ci)
        $rate = if ($ramp -gt 0) { [Math]::Abs($target - $gain) / $ramp } else { 1000.0 }
      } elseif ($line -match '^play (\S+) (\S+) (.+)$') {
        $vol = [double]::Parse($Matches[1], $ci)
        $fade = [double]::Parse($Matches[2], $ci)
        $file = $Matches[3]
        $gain = $vol; $target = $vol; $rate = 0.0
        # Length from the canonical 44-byte header our generators write: byte rate at 28, data size at 40.
        $h = New-Object byte[] 44
        $fs = [IO.File]::OpenRead($file)
        try { [void]$fs.Read($h, 0, 44) } finally { $fs.Dispose() }
        $secs = [BitConverter]::ToInt32($h, 40) / [double][BitConverter]::ToInt32($h, 28)
        $p = New-Object Windows.Media.MediaPlayer
        $p.Volume = 0
        $p.Open([Uri]$file)
        $p.Play()
        [void]$players.Add([pscustomobject]@{ P = $p; Start = $now; Fade = $fade; End = $now + $secs + 0.5 })
      }
    }
  }
  $dt = $now - $last; $last = $now
  if ($gain -ne $target) {
    $step = $rate * $dt
    if ([Math]::Abs($target - $gain) -le $step) { $gain = $target } elseif ($target -gt $gain) { $gain += $step } else { $gain -= $step }
  }
  for ($i = $players.Count - 1; $i -ge 0; $i--) {
    $e = $players[$i]
    if ($now -ge $e.End) { $e.P.Close(); $players.RemoveAt($i); continue }
    $amp = if ($e.Fade -gt 0) { [Math]::Min(1.0, ($now - $e.Start) / $e.Fade) } else { 1.0 }
    $e.P.Volume = [Math]::Max(0.0, [Math]::Min(1.0, $gain * $amp))
  }
  if ($closing -and $now -ge $closeAt) { break }
  try { [Windows.Threading.Dispatcher]::CurrentDispatcher.Invoke($bg, $pump) } catch {}
  Start-Sleep -Milliseconds 20
}
[Console]::Error.WriteLine('vibe: closing players')
foreach ($e in $players) { $e.P.Close() }
[Console]::Error.WriteLine('vibe: exiting')
# Leave from here, not by running off the end of the script: WPF's media threads can keep a
# PowerShell host alive after the script is done, and this process must never outlive its pipe.
[Environment]::Exit(0)
