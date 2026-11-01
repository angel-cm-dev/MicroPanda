# Hoja de ruta

Ideas para seguir mejorando MicroPanda. Si quieres tomar una, abre un issue para avisar y coordinar.
🟢 buena para empezar · 🟡 media · 🔴 grande

## Personaje
- 🟢 Más gorritos de temporada (Fiestas Patrias, Año Nuevo, Día del Niño).
- 🟡 Un GIF del panda en el escritorio para el README.
- 🟡 Más poses del cuerpo (brazos al escribir en la laptop).
- 🔴 Un dibujo 100% propio del proyecto, para no depender de la ilustración actual (ver [NOTICE.md](NOTICE.md)).

## Voz
- 🟢 Más modismos por país (México, Colombia, Argentina, Chile…) en `commands.js` y `tiempo.js`.
- 🟡 Filtro de voz con Silero VAD para gastar menos CPU en PCs sin tarjeta NVIDIA.
- 🟡 Kokoro en GPU con `onnxruntime-gpu` (DirectML falla con la capa `ConvTranspose`).
- 🔴 Detector propio de la palabra "Panda" con openWakeWord.
- 🔴 Reconocer solo la voz de su dueño.

## Inteligencia y acciones
- 🟢 Nuevas acciones como plugins (ver `plugins-ejemplo/`).
- 🟡 Respuestas de Ollama en streaming, para empezar a hablar antes.
- 🟡 Agenda de Google Calendar con inicio de sesión (hoy usa el enlace `.ics`).
- 🟡 Repeticiones de calendario más completas (RRULE).

## Plataforma
- 🟡 Firmar el instalador para evitar "Editor desconocido" en Windows.
- 🟡 Actualización automática con `electron-updater`.
- 🔴 macOS y Linux: separar las acciones de Windows (PowerShell) detrás de una capa por sistema.
- 🔴 Traducir la app a otros idiomas.
