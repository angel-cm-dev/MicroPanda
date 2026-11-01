# Cómo contribuir

¡Gracias por ayudar a MicroPanda! 🐼 Toda ayuda suma: código, ideas, reportar errores, probar en otras PCs,
mejorar textos o agregar modismos de tu país.

Lee también el [código de conducta](CODE_OF_CONDUCT.md) y la [arquitectura](docs/ARQUITECTURA.md).

## Preparar el entorno

Necesitas **Windows 10/11** y **Node.js 20 o más nuevo**.

```
git clone https://github.com/angel-cm-dev/micropanda.git
cd micropanda/app
npm install
npm start          # abre la mascota
```

Opcional, para probar todo:

- **Voz** (~1 GB): `powershell -ExecutionPolicy Bypass -File setup-voice.ps1 -WhisperModel large-v3-turbo-q5_0 -Kokoro`
- **Frases libres**: instala [Ollama](https://ollama.com) y `ollama pull qwen2.5:7b`

## Antes de enviar cambios

```
npm run check      # sintaxis de todos los archivos
npm test           # pruebas
```

Las dos cosas también corren solas en GitHub Actions en cada pull request.

## Flujo de trabajo

1. Abre un issue (o comenta uno) para contar qué vas a hacer, sobre todo si es grande.
2. Haz un fork y una rama: `git checkout -b agrega-clima-por-horas`.
3. Commits pequeños con mensajes claros en español: `Agrega pronóstico por horas al clima`.
4. Abre el pull request y completa la plantilla.

¿No sabes por dónde empezar? Mira [ROADMAP.md](ROADMAP.md): las marcadas 🟢 son buenas para empezar.

## Agregar una acción nueva

Cada acción es un objeto en `app/acciones.js` o `app/mas-acciones.js`:

```js
{
  id: 'mi-accion',
  pc: true,                                   // true si cambia algo en la PC (se bloquea en "modo solo charla")
  llm: 'qué hace, para que Ollama la elija',
  patterns: [/\b(frase|otra frase)\b/],       // sobre la frase en minúsculas y sin tildes
  confirm: '¿Seguro?',                        // opcional, para acciones delicadas
  run: async (m, text, target) => ({ reply: 'Listo 🐼', mood: 'happy' }),
}
```

- `m`: lo que encontró el patrón · `text`: la frase original (con tildes) · `target`: el dato que extrajo Ollama.
- `mood`: `idle`, `happy`, `love`, `surprised`, `thinking`, `focused`, `annoyed`, `sad` o `sleepy`.
- El orden importa: las listas se revisan de arriba abajo y gana la primera que coincide.
- Agrega tus frases de ejemplo en `app/test/commands.test.js`.

También puedes hacerlo **sin tocar el código**, como plugin: mira `plugins-ejemplo/chiste.js`.

## Reglas importantes

- **Nunca** ejecutes texto del usuario como comando. Si armas un comando de PowerShell, limpia los datos
  (solo letras y números) o pásalos como números.
- Acciones que borran, cierran o apagan: siempre con `confirm`.
- Respuestas en **español latinoamericano**, cortas, con un emoji como mucho.
- Que funcione **sin internet**; si algo necesita internet, que sea opcional y lo diga cuando falle.
- Sin dependencias nuevas salvo que sea necesario (hoy la app solo usa Electron).
- Comentarios y nombres en español, como el resto del proyecto.

## Cambiar el dibujo o la animación

Abre `personaje/index.html` directamente en el navegador: muestra el panda con botones para cada ánimo,
sin necesidad de la app. Cómo están armadas las capas: [docs/ARQUITECTURA.md](docs/ARQUITECTURA.md#el-dibujo-del-panda).

## Publicar una versión (mantenedores)

1. Sube la versión en `app/package.json`.
2. Anota los cambios en `CHANGELOG.md`.
3. `git tag v0.4.0 && git push --tags`: GitHub Actions arma el instalador y lo publica en Releases.
