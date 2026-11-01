<h1 align="center">MicroPanda 🐼</h1>

<p align="center">
  <b>Una mascota de escritorio para Windows que te ayuda con tu PC, por voz o por texto, en español latino.</b><br>
  100% open source · funciona sin internet · usa tu GPU si la tienes
</p>

<p align="center">
  <a href="LICENSE"><img alt="Licencia MIT" src="https://img.shields.io/badge/licencia-MIT-4C4BC9"></a>
  <img alt="Windows 10/11" src="https://img.shields.io/badge/Windows-10%20%7C%2011-030272">
  <img alt="Electron" src="https://img.shields.io/badge/Electron-45-2B2E3A">
  <img alt="Sin internet" src="https://img.shields.io/badge/funciona-sin%20internet-2BB673">
  <a href="CONTRIBUTING.md"><img alt="Contribuciones bienvenidas" src="https://img.shields.io/badge/contribuciones-bienvenidas-FF8FA3"></a>
</p>

<p align="center">
  <img src="docs/panda-idle.png" width="140" alt="MicroPanda tranquilo">
  <img src="docs/panda-happy.png" width="140" alt="MicroPanda feliz">
  <img src="docs/panda-love.png" width="140" alt="MicroPanda encantado">
  <img src="docs/panda-thinking.png" width="140" alt="MicroPanda pensando">
  <img src="docs/panda-surprised.png" width="140" alt="MicroPanda saludando">
</p>

> **"Panda, recuérdame mañana en la tarde llamar a mi mamá"** · **"Panda, bájale al volumen porfa"** ·
> **"Panda, explícame este error de la pantalla"** · **"según mis documentos, ¿cuántos días de vacaciones tengo?"**

---

## Índice

- [¿Qué es?](#qué-es)
- [Lo más destacado](#lo-más-destacado)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
- [Cómo se usa](#cómo-se-usa)
- [Todo lo que sabe hacer](#todo-lo-que-sabe-hacer)
- [Voz, GPU y español latino](#voz-gpu-y-español-latino)
- [Su cerebro: ánimo y memoria](#su-cerebro-ánimo-y-memoria)
- [Privacidad y seguridad](#privacidad-y-seguridad)
- [Plugins](#plugins)
- [Desarrollo](#desarrollo)
- [Problemas frecuentes](#problemas-frecuentes)
- [Contribuir](#contribuir)
- [Licencia y créditos](#licencia-y-créditos)

## ¿Qué es?

MicroPanda es un panda con capucha y laptop que vive en una esquina de tu pantalla. Te sigue con la mirada,
cambia de ánimo según lo que pasa en tu PC y hace cosas por ti cuando se lo pides: recordatorios, abrir apps,
controlar el volumen o la música, leer un error de la pantalla, responder sobre tus documentos, contarte el
clima y mucho más.

Está pensado para **hispanohablantes de Latinoamérica**: entiende "bájale", "porfa", "al rato" o
"mañana en la tarde", y habla con acento latino.

Todo funciona **en tu PC**: escucha con [whisper.cpp](https://github.com/ggml-org/whisper.cpp), habla con
[Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) y entiende frases libres con [Ollama](https://ollama.com).
Internet solo se usa si lo pides (clima, noticias…).

## Lo más destacado

- 🎙️ **Palabra de activación**: di "Panda" (o el nombre que le pongas) y te escucha. Puedes interrumpirlo con "Panda, para".
- ⚡ **Rápido con GPU**: con una tarjeta NVIDIA entiende cada frase en ~0.2 s. Sin GPU funciona igual con la CPU.
- 🇵🇪🇲🇽🇨🇴 **Español latino**: acento latino al hablar, modismos y expresiones de tiempo naturales.
- 🧠 **Aprende**: tu nombre, lo que le cuentas, tus comandos favoritos; su cariño cambia cómo se comporta.
- ⏰ **Recordatorios de verdad**: "cada lunes a las 9", "en media hora", "pasado mañana en la mañana".
- 🖥️ **Lee tu pantalla** con el OCR de Windows y te explica errores.
- 📚 **Responde sobre tus documentos** (Word, PowerPoint, PDF, texto) sin subirlos a ningún lado.
- 🔒 **Seguro**: solo hace acciones de una lista cerrada, pide confirmación para lo delicado y tiene "modo solo charla".
- 🧩 **Extensible**: agrega acciones con plugins de pocas líneas.

## Requisitos

| | Mínimo | Recomendado |
|---|---|---|
| Sistema | Windows 10 u 11 (64 bits) | Windows 11 |
| Memoria | 8 GB de RAM | 16 GB |
| Disco | ~1.5 GB (app + voz) | +5 GB para un modelo de Ollama |
| Tarjeta de video | No hace falta | NVIDIA con 4 GB o más (escucha en ~0.2 s) |
| Para frases libres | — | [Ollama](https://ollama.com) con `qwen2.5:7b` |
| Para compilar | Node.js 20+ | — |

## Instalación

### Opción 1: instalador

1. Descarga `MicroPanda Setup x.y.z.exe` desde **[Releases](../../releases)** e instálalo.
   Windows puede mostrar "Editor desconocido" porque el instalador no está firmado: elige **Más información → Ejecutar de todas formas**.
2. Clic derecho sobre el panda → **⬇️ Instalar la voz** (~1 GB, una sola vez). Detecta tu tarjeta NVIDIA y baja la versión con GPU si corresponde.
3. Opcional: instala [Ollama](https://ollama.com) y, desde el menú **Inteligencia**, descarga `qwen2.5:7b` para que entienda frases libres.

### Opción 2: desde el código

```
git clone https://github.com/angel-cm-dev/micropanda.git
cd micropanda/app
npm install
npm start
```

Voz (desde `app/`):

```
powershell -ExecutionPolicy Bypass -File setup-voice.ps1 -WhisperModel large-v3-turbo-q5_0 -Kokoro
```

Se instala en `%USERPROFILE%\.micropanda\voice`, una ruta corta a propósito porque algunas librerías fallan con rutas largas.

| Componente | Modelo | Licencia |
|---|---|---|
| Escuchar | whisper.cpp + `large-v3-turbo` (preciso) y `base` (rápido); con CUDA si hay NVIDIA | MIT |
| Hablar | Kokoro-82M, voces `ef_dora`, `em_alex`, `em_santa` con pronunciación latina | Apache 2.0 |
| Hablar (respaldo) | Piper, voz `es_MX-claude-high` | MIT |

## Cómo se usa

| Acción | Cómo |
|---|---|
| Hablarle | Di **"Panda, …"** · o **Ctrl+Alt+V** · o el botón 🎤 del globo |
| Escribirle | Doble clic sobre el panda · o **Ctrl+Alt+P** |
| Apagar el micrófono | **Ctrl+Alt+M** |
| Moverlo | Arrástralo (un clic lo pone feliz) |
| Menú | Clic derecho sobre el panda o en el ícono de la bandeja |
| Ajustes | Menú → **⚙️ Ajustes…** |

**Conversación por voz:**

- Di "Panda" solo y te responde "¿Sí?", o dilo todo junto: "Panda, abre la calculadora".
- Después de responder sigue escuchando unos segundos, así no tienes que repetir "Panda".
- Si te pide confirmación, contesta "sí" o "no".
- "Panda, para" lo calla; "gracias" o "eso es todo" terminan la charla.

El punto en la esquina del panda indica el micrófono: 🟢 esperando su nombre · 🔴 grabando · ⚪ apagado.

**Ajustes** (todo se guarda solo):

- **Micrófono**: cuál está en uso, elegir otro y un medidor para probarlo.
- **Voz**: sensibilidad, voz, velocidad, procesador (GPU o CPU).
- **Él**: nombre, personalidad, tamaño, ánimo automático, pasear solo.
- **Inteligencia**: modelo de Ollama, modelo en la nube opcional, modo solo charla.
- **Tú**: ciudad, moneda, pausas activas, calendario, iniciar con Windows y repositorio para buscar actualizaciones.

## Todo lo que sabe hacer

### Productividad
| Ejemplos | Qué hace |
|---|---|
| "recuérdame mañana en la tarde llamar a mi mamá" · "avísame en 10 minutos" · "cada lunes a las 9 reunión" · "todos los días a las 8 la pastilla" · "pospónlo 10 minutos" | Recordatorios con voz, globo y notificación de Windows (también si estaba oculto) |
| "agrega comprar pan a mi lista" · "¿qué tengo pendiente?" · "ya hice comprar pan" | Lista de tareas |
| "toma nota: la reunión es el jueves" · "abre mis notas" | Notas en Documentos › MicroPanda › notas.md |
| "pomodoro de 25 minutos" · "detén el pomodoro" | Modo concentración con descansos |
| "activa las pausas activas" | Te recuerda estirarte cada hora y tomar agua |
| "crea la rutina trabajo: abre el navegador y baja el volumen" → "activa el modo trabajo" | Rutinas de varios pasos |
| "¿qué tengo mañana en mi agenda?" | Outlook o Google Calendar (enlace `.ics`) |

### Tu PC
| Ejemplos | Qué hace |
|---|---|
| "abre WhatsApp" · "abre gmail" · "abre wikipedia.org" · "prende la calculadora" | Apps instaladas (también de la Microsoft Store), carpetas y páginas web |
| "bájale al volumen" · "súbele" · "silencia" | Volumen |
| "pausa la música" · "siguiente canción" | Música y videos |
| "sube el brillo" · "pon el modo oscuro" · "no molestar" | Pantalla y Windows |
| "busca el archivo de ventas" · "busca en google…" · "pon … en youtube" | Búsquedas |
| "ordena mis descargas" · "vacía la papelera" · "borra los temporales" | Limpieza (con confirmación) |
| "cierra Chrome" · "apaga la compu en una hora" · "cancela el apagado" · "bloquea la PC" | Apps y energía (con confirmación) |
| "¿cómo está la PC?" · "¿qué hora es?" · "¿qué día es?" | Estado y hora ("son las 3 y media de la tarde") |
| "baja el volumen y pausa la música" | Varias cosas a la vez |

### Inteligencia
| Ejemplos | Qué hace |
|---|---|
| "explícame este error de la pantalla" · "¿qué dice la pantalla?" | Lee la pantalla con el OCR de Windows (o un modelo de visión de Ollama) |
| "según mis documentos, …" · "abre tu biblioteca" | Responde con tus archivos de Documentos › MicroPanda › Biblioteca, citando el archivo |
| "resume lo que copié" · "traduce esto al inglés" · "corrige esto" | Trabaja con lo que copiaste (Ctrl+C) |
| "¿cuál es la capital de Francia?" → "¿y la de Perú?" | Charla con memoria de la conversación |
| "recuerda que mi jefe se llama Luis" · "mi cumpleaños es el 5 de marzo" | Datos que recuerda (ese día se pone gorrito de fiesta 🎉) |

### Internet (opcional)
| Ejemplos | Qué hace |
|---|---|
| "¿va a llover mañana en Lima?" · "mi ciudad es Arequipa" | Clima (Open-Meteo) |
| "¿cuánto está el dólar?" · "mi moneda son pesos mexicanos" | Tipo de cambio |
| "noticias" · "noticias de tecnología" | Titulares de tu país (Google News) |
| "investiga sobre Machu Picchu" | Resumen de Wikipedia |

### Él
| Ejemplos | Qué hace |
|---|---|
| "ahora te llamas Bambú" | Responde a ese nombre (y a "Panda") |
| "ponte más gracioso" · "sé profesional" | Personalidad: tierno, gracioso, profesional, serio |
| "camina" · "quédate quieto" · "salúdame" | Pasea por la barra de tareas, saluda con la pata |
| "habla más despacio" | Velocidad de la voz |
| "modo solo charla" | No toca nada de la PC |
| "¿qué sabes de mí?" · "olvida lo que sabes de mí" | Lo que recuerda de ti |

Además: asiente, niega, salta, se estira y bosteza; se pone gorrito en Navidad, Halloween y tu cumpleaños;
tiene 4 tamaños y aparece en el monitor donde está el mouse.

## Voz, GPU y español latino

| PC | Escuchar | Hablar |
|---|---|---|
| Con tarjeta NVIDIA | whisper `large-v3-turbo` en GPU (CUDA): ~0.2 s por frase | Kokoro en CPU: ~1–1.8 s, empieza a hablar en la primera frase |
| Sin NVIDIA | `base` para "Panda" (~0.5 s) y `turbo` si hace falta (~5 s) | Kokoro en CPU |

- Elige **GPU, CPU o automático** en el menú **Procesador**; si la GPU falla, vuelve sola a la CPU.
- La palabra "Panda" solo cuenta **al inicio** de la frase: "el panda es un animal" no lo activa.
- Pronuncia en **español latinoamericano** (`es-419`, con seseo) y entiende modismos ("bájale", "porfa", "la compu").
- Entiende el tiempo como se habla: "mañana" (el día) vs. "en la mañana" (antes del mediodía), "al rato",
  "a las 8 menos cuarto", "el viernes al mediodía", "cada 30 minutos".
- La boca sigue las sílabas: abierta en "a/e", redonda en "o/u".

## Su cerebro: ánimo y memoria

Decide su estado de ánimo solo (se puede apagar):

| Situación | Reacción |
|---|---|
| Te alejas 5 minutos o bloqueas la PC | Se duerme 😴 |
| Vuelves | Se sorprende y te dice "¡Volviste!" |
| Primer uso del día | Te saluda con la pata, según la hora y con tu nombre |
| RAM casi llena · CPU al máximo · batería baja · disco lleno | Molesto o concentrado, con un aviso útil |
| Madrugada | Te sugiere descansar |
| Elogios / insultos | Encantado / triste |
| Charla con Ollama | El modelo elige la emoción de cada respuesta |

Aprende tu nombre, lo que le cuentas, tus comandos favoritos y su **cariño** hacia ti (0–100), que cambia los
gestos que hace. Todo se guarda en `%USERPROFILE%\.micropanda\memoria.json`.

## Privacidad y seguridad

- **Todo se procesa en tu PC.** El audio no se guarda. La pantalla solo se captura cuando se lo pides.
- Internet solo para lo que pides: clima, tipo de cambio, noticias, Wikipedia, buscar actualizaciones y, si lo activas, un modelo en la nube con tu clave (guardada cifrada con tu cuenta de Windows).
- **Lista cerrada de acciones:** nunca ejecuta texto libre como comando; Ollama solo puede elegir de la lista.
- Lo delicado pide confirmación; "modo solo charla" bloquea todo lo que toca la PC.
- Registro de todo lo que hizo en `%USERPROFILE%\.micropanda\acciones.log` ("¿qué hiciste?").

Detalles en [SECURITY.md](SECURITY.md).

## Plugins

Copia un archivo `.js` en `%USERPROFILE%\.micropanda\plugins\` y reinicia la app:

```js
module.exports = [{
  id: 'chiste',
  pc: false,                                   // no toca la PC
  llm: 'contar un chiste',                     // para que Ollama también la elija
  patterns: [/\b(cuentame un chiste)\b/],      // frase en minúsculas y sin tildes
  run: async () => ({ reply: '¿Qué le dice un panda a otro? ¡Nada, los pandas no hablan! 🐼', mood: 'happy' }),
}];
```

Ejemplo completo en [plugins-ejemplo/chiste.js](plugins-ejemplo/chiste.js). Los plugins corren con los permisos
de la app: instala solo los que entiendas o vengan de alguien de confianza.

## Desarrollo

```
cd app
npm install
npm start          # abre la app
npm run check      # sintaxis de todos los archivos
npm test           # pruebas (tiempo en español y elección de acciones)
npm run dist       # instalador en app/dist/
```

Para ver solo el dibujo y las animaciones, abre `personaje/index.html` en el navegador.

### Estructura

```
├── app/                    # La app (Electron)
│   ├── main.js             # Ventana, menú, bandeja, atajos, ajustes, pantalla, pasear, actualizaciones
│   ├── preload.js          # Puente seguro con las páginas
│   ├── commands.js         # Router: lista cerrada de acciones, encadenar, registro, plugins, Ollama
│   ├── acciones.js         # PC, internet, tareas, notas, rutinas, personalidad…
│   ├── mas-acciones.js     # Pantalla, documentos, agenda, noticias, Wikipedia, pasear
│   ├── tiempo.js           # "mañana en la tarde", "cada lunes"… y la hora en voz natural
│   ├── brain.js            # Ánimo, memoria, recordatorios, tareas, pomodoro, avisos
│   ├── ollama.js           # Ollama local y modelo en la nube opcional
│   ├── voice.js            # Escuchar (whisper.cpp, GPU o CPU) y hablar (Kokoro, Piper)
│   ├── kokoro_tts.py       # Servidor de voz Kokoro-82M
│   ├── ocr.ps1             # OCR de Windows
│   ├── setup-voice.ps1     # Instalador de la voz
│   ├── scripts/check.js    # npm run check
│   └── test/               # Pruebas
├── personaje/              # El panda: capas PNG, animación, escritorio, ajustes
├── plugins-ejemplo/        # Plugin de ejemplo
├── docs/                   # Arquitectura e imágenes
└── .github/                # Pruebas automáticas, publicar versiones, plantillas
```

Cómo encaja todo (con diagramas): **[docs/ARQUITECTURA.md](docs/ARQUITECTURA.md)**.

### Publicar una versión

Sube la versión en `app/package.json`, anota los cambios en [CHANGELOG.md](CHANGELOG.md) y ejecuta
`git tag v0.4.0 && git push --tags`. GitHub Actions arma el instalador y lo publica en Releases; la app avisa
de la versión nueva a quien ponga el repositorio en Ajustes.

> Si compilas el instalador en tu PC y la carpeta del proyecto tiene una ruta muy larga, NSIS falla
> (límite de 260 caracteres). Compila desde una ruta corta como `C:\dev\micropanda`.

## Problemas frecuentes

| Problema | Solución |
|---|---|
| No me escucha | Ajustes → **Micrófono**: revisa cuál está en uso y prueba el medidor. Revisa también Configuración de Windows → Privacidad → Micrófono. Si hay ruido, baja la sensibilidad; si hablas bajito, súbela |
| Se activa solo | Baja la sensibilidad o cámbiale el nombre por uno menos común ("ahora te llamas Bambú") |
| No habla | Menú → **Instalar la voz**, y revisa que "Responder en voz alta" esté activo |
| "Aún no sé hacer eso" con frases libres | Instala Ollama y descarga `qwen2.5:7b` desde el menú **Inteligencia** |
| No usa la GPU | Solo NVIDIA con drivers actualizados; mira el menú **Procesador** |
| El brillo no cambia | Windows solo lo permite en laptops, no en monitores externos |
| La agenda no carga | Con Google Calendar pega la "dirección secreta en formato iCal" en Ajustes; con el Outlook nuevo no funciona (solo el clásico) |

¿Otro problema? [Abre un issue](../../issues/new/choose).

## Contribuir

¡Se necesitan manos! Lee **[CONTRIBUTING.md](CONTRIBUTING.md)**: agregar una acción son ~10 líneas.
Ideas pendientes en **[ROADMAP.md](ROADMAP.md)** (las 🟢 son buenas para empezar) y cambios de cada versión en
[CHANGELOG.md](CHANGELOG.md). Participar implica respetar el [código de conducta](CODE_OF_CONDUCT.md).

## Licencia y créditos

El código está bajo la licencia **[MIT](LICENSE)**. La ilustración del panda tiene su propio aviso y los
componentes de terceros sus licencias: ver **[NOTICE.md](NOTICE.md)**.

Gracias a los proyectos que lo hacen posible: [Electron](https://www.electronjs.org),
[whisper.cpp](https://github.com/ggml-org/whisper.cpp), [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M),
[kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx), [Piper](https://github.com/rhasspy/piper),
[Ollama](https://ollama.com), [Open-Meteo](https://open-meteo.com) y [Wikipedia](https://es.wikipedia.org).
