# Seguridad y privacidad

## Qué hace MicroPanda en tu PC

- **Solo ejecuta acciones de una lista cerrada** (`app/commands.js`, `app/acciones.js`, `app/mas-acciones.js`).
  Nunca ejecuta texto libre como comando. Ollama (o el modelo en la nube) solo puede **elegir** una acción de esa lista.
- Las acciones delicadas piden confirmación: vaciar la papelera, borrar temporales, bloquear, apagar o reiniciar,
  cerrar apps, ordenar Descargas, borrar recordatorios o tareas, olvidar tus datos.
- **Modo solo charla** bloquea todo lo que toca la PC.
- Todo lo que hizo queda en `%USERPROFILE%\.micropanda\acciones.log`.
- Los **plugins** (`%USERPROFILE%\.micropanda\plugins\*.js`) son código que corre con los permisos de la app:
  instala solo plugins que entiendas o que vengan de alguien de confianza.

## Qué datos guarda y dónde

Todo queda en tu PC, en `%USERPROFILE%\.micropanda\`:

| Archivo | Contenido |
|---|---|
| `memoria.json` | Ajustes, tu nombre, lo que le contaste, recordatorios, tareas, cariño |
| `acciones.log` | Registro de acciones en la PC |
| `voice\` | Modelos de voz |

La clave del modelo en la nube se guarda **cifrada** con tu cuenta de Windows (Electron `safeStorage`) y nunca se
muestra de vuelta.

## Micrófono y pantalla

- El micrófono solo se usa para escuchar su nombre y tus órdenes. El audio se procesa **en tu PC** con whisper.cpp
  y no se guarda. Windows muestra el ícono de micrófono en uso mientras escucha; **Ctrl+Alt+M** lo apaga al instante.
- La pantalla **solo se captura cuando se lo pides** ("explícame este error de la pantalla") y se lee en tu PC
  (OCR de Windows u Ollama). Si activaste el modelo en la nube, el **texto** leído puede enviarse a ese servicio.

## Qué sale a internet

Nada, salvo lo que pides: clima, tipo de cambio, noticias, Wikipedia, buscar actualizaciones (si pusiste el
repositorio) y el modelo en la nube (si lo activaste con tu clave).

## Reportar un problema de seguridad

No abras un issue público: escribe al autor del repositorio por mensaje privado o usa
**Security › Report a vulnerability** en GitHub.
