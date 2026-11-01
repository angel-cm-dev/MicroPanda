# Licencias y avisos

El **código** de MicroPanda está bajo la licencia [MIT](LICENSE).

## Ilustración del panda

Las imágenes de `personaje/` (`panda.png`, `head.png`, `body.png`) se hicieron editando una ilustración
entregada por el autor del proyecto (`source.webp`, que **no** se publica en este repositorio). Antes de publicar:

- Confirma que tienes derecho a usar y redistribuir la ilustración original. Si viene de un banco de imágenes
  (Freepik, Shutterstock…), su licencia manda sobre la del código: puede pedir atribución o prohibir redistribuirla.
- Si no estás seguro, reemplaza esas tres imágenes por un diseño propio. El resto del proyecto no depende de ese dibujo:
  [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md) explica cómo cambiar el dibujo (solo hacen falta tres PNG y `rig.json`).

Mientras no se confirme, **la ilustración no está cubierta por la licencia MIT**.

## Componentes que se descargan aparte (no están en este repositorio)

`app/setup-voice.ps1` los baja a `%USERPROFILE%\.micropanda\voice`:

| Componente | Licencia |
|---|---|
| [whisper.cpp](https://github.com/ggml-org/whisper.cpp) y modelos Whisper | MIT |
| [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) / [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) | Apache 2.0 / MIT |
| espeak-ng (lo usa kokoro-onnx para la pronunciación) | GPL-3.0 |
| [Piper](https://github.com/rhasspy/piper) | MIT |
| Voz de Piper `es_MX-claude-high` | ver la [ficha de la voz](https://huggingface.co/rhasspy/piper-voices/tree/main/es/es_MX/claude/high) |
| [pypdf](https://github.com/py-pdf/pypdf) | BSD-3 |

Dependencias de la app (npm): [Electron](https://github.com/electron/electron) (MIT) y
[electron-builder](https://github.com/electron-userland/electron-builder) (MIT, solo para armar el instalador).

[Ollama](https://ollama.com) (MIT) y sus modelos se instalan aparte; cada modelo tiene su propia licencia.

## Servicios de internet (opcionales)

Solo se usan cuando los pides: [Open-Meteo](https://open-meteo.com) (clima, CC BY 4.0),
[ExchangeRate-API](https://www.exchangerate-api.com) (tipo de cambio), Google News RSS (noticias),
[Wikipedia](https://es.wikipedia.org) (CC BY-SA 4.0) y, si lo activas, un modelo en la nube con tu propia clave.
