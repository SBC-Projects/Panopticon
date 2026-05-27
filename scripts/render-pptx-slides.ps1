<#
.SYNOPSIS
  Render every slide of a .pptx to PNG via PowerPoint COM.

.DESCRIPTION
  Driven by server/src/pptx-render.ts. Opens the file read-only, exports
  each slide as `slide-001.png`, `slide-002.png`, ... into -OutputDir at
  -Width pixels wide (height inferred from the deck's native aspect, so
  16:9 / 4:3 / custom decks all look right). On success prints a single
  JSON line to stdout — { ok, slide_count, width, height } — and exits 0.
  On failure $ErrorActionPreference = Stop bubbles a non-zero exit code
  and the message lands on stderr; Node reads both.

.NOTES
  - Requires PowerPoint installed on the machine. There is no headless
    fallback: this script is one of two pptx paths, the other (pure JS)
    handles text excerpts and slide titles so the cards still work
    when COM isn't available.
  - Presentations.Open uses WithWindow=$true because modern PowerPoint
    rejects Slide.Export from a WithWindow=$false workbook (silent fail
    in some builds, COMException in others). Brief window flash is the
    cost.
  - We only $ppt.Quit() if our session is the empty one — if the
    teacher already had PowerPoint open with their own decks we
    attached to that instance and must leave it alone.
#>

param(
  [Parameter(Mandatory=$true)][string]$InputPath,
  [Parameter(Mandatory=$true)][string]$OutputDir,
  [int]$Width = 1600
)

$ErrorActionPreference = "Stop"

$InputPath = (Resolve-Path -LiteralPath $InputPath).Path
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$OutputDir = (Resolve-Path -LiteralPath $OutputDir).Path

$ppt = New-Object -ComObject PowerPoint.Application
try {
  # ReadOnly=$true, Untitled=$false, WithWindow=$true.
  $deck = $ppt.Presentations.Open($InputPath, $true, $false, $true)
  try {
    $aspect = $deck.PageSetup.SlideHeight / $deck.PageSetup.SlideWidth
    $height = [int]($Width * $aspect)
    $count = $deck.Slides.Count
    for ($i = 1; $i -le $count; $i++) {
      $path = Join-Path $OutputDir ("slide-{0:D3}.png" -f $i)
      $deck.Slides.Item($i).Export($path, "PNG", $Width, $height)
    }
    $result = [ordered]@{
      ok = $true
      slide_count = $count
      width = $Width
      height = $height
    }
    Write-Output (ConvertTo-Json -Compress $result)
  } finally {
    $deck.Close()
  }
} finally {
  if ($ppt.Presentations.Count -eq 0) {
    $ppt.Quit()
  }
}
