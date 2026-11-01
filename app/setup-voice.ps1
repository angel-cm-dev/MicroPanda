# Descarga los componentes de voz de MicroPanda (todo open source, funciona sin internet después).
#   whisper.cpp (MIT)  -> escuchar: voz a texto
#   Piper (MIT)        -> hablar: texto a voz
#   Kokoro-82M (Apache 2.0, opcional) -> voz más natural, con Python aislado en voice/py
# Uso:  powershell -ExecutionPolicy Bypass -File setup-voice.ps1 [-WhisperModel base|small|large-v3-turbo-q5_0] [-Kokoro] [-Gpu auto|cpu]
# Recomendado: -WhisperModel large-v3-turbo-q5_0 -Kokoro   (~930 MB)
# -Gpu auto (por defecto): con tarjeta NVIDIA baja también whisper con CUDA (~670 MB).
#   La app elige GPU o CPU al iniciar (y vuelve a la CPU si la GPU falla).
param(
    [ValidateSet('base', 'small', 'large-v3-turbo-q5_0')][string]$WhisperModel = 'base',
    [switch]$Kokoro,
    [ValidateSet('auto', 'cpu')][string]$Gpu = 'auto'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
# Ruta corta a propósito: onnxruntime (Kokoro) no carga en rutas de más de 260 caracteres.
$dir = if ($env:MICROPANDA_VOICE_DIR) { $env:MICROPANDA_VOICE_DIR } else { Join-Path $env:USERPROFILE '.micropanda\voice' }
$models = Join-Path $dir 'models'
New-Item -ItemType Directory -Force $dir, $models | Out-Null

function Get-File($url, $out) {
    if (Test-Path $out) { Write-Host "  ya existe: $(Split-Path $out -Leaf)"; return }
    Write-Host "  descargando: $(Split-Path $out -Leaf)"
    Invoke-WebRequest $url -OutFile "$out.part" -UseBasicParsing
    Move-Item "$out.part" $out -Force
}

Write-Host 'whisper.cpp (escuchar)'
if (-not (Test-Path (Join-Path $dir 'whisper'))) {
    $zip = Join-Path $dir 'whisper-bin-x64.zip'
    Get-File 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-bin-x64.zip' $zip
    Expand-Archive $zip (Join-Path $dir 'whisper') -Force
}
Get-File "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$WhisperModel.bin" (Join-Path $models "ggml-$WhisperModel.bin")

$nvidia = @(Get-CimInstance Win32_VideoController | Where-Object { $_.Name -match 'NVIDIA' } | ForEach-Object Name)
if ($Gpu -eq 'auto' -and $nvidia.Count -and (Get-Command nvidia-smi -ErrorAction SilentlyContinue) -and -not (Test-Path (Join-Path $dir 'whisper-cuda'))) {
    Write-Host "whisper.cpp con CUDA ($($nvidia[0]))"
    $zip = Join-Path $dir 'whisper-cublas-12.4.0-bin-x64.zip'
    Get-File 'https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.2/whisper-cublas-12.4.0-bin-x64.zip' $zip
    Expand-Archive $zip (Join-Path $dir 'whisper-cuda') -Force
}

Write-Host 'Piper (hablar)'
if (-not (Test-Path (Join-Path $dir 'piper\piper.exe'))) {
    $zip = Join-Path $dir 'piper_windows_amd64.zip'
    Get-File 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip' $zip
    Expand-Archive $zip $dir -Force
}
$voice = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_MX/claude/high/es_MX-claude-high.onnx'
Get-File $voice (Join-Path $models 'es_MX-claude-high.onnx')
Get-File "$voice.json" (Join-Path $models 'es_MX-claude-high.onnx.json')

if ($Kokoro) {
    Write-Host 'Kokoro-82M (voz natural)'
    $base = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0'
    Get-File "$base/kokoro-v1.0.onnx" (Join-Path $models 'kokoro-v1.0.onnx')
    Get-File "$base/voices-v1.0.bin" (Join-Path $models 'voices-v1.0.bin')
    $py = Join-Path $dir 'py'
    if (-not (Test-Path (Join-Path $py 'Scripts\python.exe'))) {
        Write-Host '  creando Python aislado'
        python -m venv $py
    }
    Write-Host '  instalando kokoro-onnx'
    & (Join-Path $py 'Scripts\python.exe') -m pip install --quiet --disable-pip-version-check kokoro-onnx pypdf
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo instalar kokoro-onnx' }
    # Kokoro queda en CPU (~1.5 s por frase): DirectML no soporta su capa ConvTranspose y
    # onnxruntime-gpu (CUDA + cuDNN) pesa más de 2 GB. Si alguien instala onnxruntime-gpu, se usa solo.
}

Remove-Item (Join-Path $dir '*.zip') -ErrorAction SilentlyContinue
$cli = Get-ChildItem $dir -Recurse -Include whisper-cli.exe, main.exe | Select-Object -First 1
$piper = Get-ChildItem $dir -Recurse -Filter piper.exe | Select-Object -First 1
Write-Host ''
Write-Host "Listo. whisper: $($cli.FullName)"
Write-Host "       piper:   $($piper.FullName)"
