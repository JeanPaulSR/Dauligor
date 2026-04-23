param(
  [int]$Port = 3000,
  [string]$HostName = "127.0.0.1"
)

$moduleRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$samplePath = Join-Path $moduleRoot "data\sample-character.json"

if (-not (Test-Path $samplePath)) {
  Write-Error "Could not find sample file at $samplePath"
  exit 1
}

$listener = [System.Net.HttpListener]::new()
$prefix = "http://${HostName}:${Port}/"
$listener.Prefixes.Add($prefix)

try {
  $listener.Start()
} catch {
  Write-Error "Failed to start listener on $prefix. $_"
  exit 1
}

Write-Host "Dauligor sample server running at $prefix"
Write-Host "Serving:"
Write-Host "  ${prefix}sample-character.json"
Write-Host ""
Write-Host "Press Ctrl+C to stop."

while ($listener.IsListening) {
  try {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response

    $response.Headers["Access-Control-Allow-Origin"] = "*"
    $response.Headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    $response.Headers["Access-Control-Allow-Headers"] = "Content-Type"

    if ($request.HttpMethod -eq "OPTIONS") {
      $response.StatusCode = 204
      $response.Close()
      continue
    }

    $path = $request.Url.AbsolutePath.TrimStart("/")

    if ($path -eq "" -or $path -eq "sample-character.json") {
      $json = Get-Content -Raw $samplePath
      $buffer = [System.Text.Encoding]::UTF8.GetBytes($json)
      $response.ContentType = "application/json; charset=utf-8"
      $response.ContentLength64 = $buffer.Length
      $response.OutputStream.Write($buffer, 0, $buffer.Length)
      $response.StatusCode = 200
      Write-Host "200 GET /sample-character.json"
    } else {
      $message = "{`"error`":`"Not found`"}"
      $buffer = [System.Text.Encoding]::UTF8.GetBytes($message)
      $response.ContentType = "application/json; charset=utf-8"
      $response.ContentLength64 = $buffer.Length
      $response.OutputStream.Write($buffer, 0, $buffer.Length)
      $response.StatusCode = 404
      Write-Host "404 $($request.HttpMethod) /$path"
    }

    $response.Close()
  } catch [System.Net.HttpListenerException] {
    break
  } catch {
    Write-Warning $_
  }
}

if ($listener.IsListening) {
  $listener.Stop()
}

$listener.Close()
