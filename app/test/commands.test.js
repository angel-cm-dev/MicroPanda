// node --test   (qué acción elige para cada frase; no ejecuta nada en la PC)
const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

process.env.MICROPANDA_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-test-'));
const brain = require('../brain');
const c = require('../commands');
c._llm.start = async () => false;   // sin Ollama en las pruebas
c.init({ shell: {}, app: { getPath: () => os.tmpdir() }, clipboard: { readText: () => '' }, brain });

const pick = (text) => {
  const q = c._normalize(text);
  return c._intents.find((i) => i.patterns.some((re) => re.test(q)))?.id || null;
};

test('elige la acción correcta', () => {
  const cases = {
    'recuérdame mañana en la tarde llamar a mi mamá': 'remind',
    'pon una alarma pasado mañana a las 7': 'remind',
    '¿qué recordatorios tengo?': 'remind-list',
    'bájale al volumen porfa': 'volume-down',
    'súbele': 'volume-up',
    'prende la calculadora': 'open',
    'abre gmail': 'open',
    'apaga la compu en una hora': 'power',
    'cancela el apagado': 'power-cancel',
    'sube el brillo': 'brightness',
    'pon el modo oscuro': 'theme',
    'pausa la música': 'media-play',
    'siguiente canción': 'media-next',
    'busca el archivo de ventas': 'search-files',
    'busca en google recetas de ceviche': 'search-web',
    'pon despacito en youtube': 'search-youtube',
    'ordena mis descargas': 'organize',
    'cierra chrome': 'close-app',
    '¿cómo está el clima en Lima?': 'weather',
    '¿va a llover mañana?': 'weather',
    '¿cuánto está el dólar?': 'currency',
    'resume lo que copié': 'clipboard',
    'traduce esto al inglés': 'clipboard',
    'agrega comprar pan a mi lista': 'todo-add',
    '¿qué tengo pendiente?': 'todo-list',
    'ya hice comprar pan': 'todo-done',
    'toma nota que el wifi es Panda123': 'note',
    'pomodoro de 25 minutos': 'focus',
    'detén el pomodoro': 'focus-stop',
    'crea la rutina trabajo: abre el navegador y baja el volumen': 'routine-create',
    'activa el modo trabajo': 'routine',
    'ahora te llamas Bambú': 'rename',
    'ponte más gracioso': 'personality',
    'recuerda que mi jefe se llama Luis': 'fact',
    'modo solo charla': 'chat-only',
    'vacía la papelera': 'recycle',
    'qué hora es': 'time',
    // fase 2
    'explícame este error de la pantalla': 'screen',
    '¿qué dice la pantalla?': 'screen',
    'según mis documentos, ¿cuántos días de vacaciones tengo?': 'library-ask',
    'abre tu biblioteca': 'library-open',
    '¿qué tengo mañana en mi agenda?': 'agenda',
    'noticias de tecnología': 'news',
    'investiga sobre Machu Picchu': 'wikipedia',
    'camina un rato': 'walk',
    'quédate quieto': 'walk',
    'salúdame': 'wave',
    'habla más despacio': 'voice-speed',
    'busca actualizaciones': 'update',
  };
  for (const [text, id] of Object.entries(cases)) assert.equal(pick(text), id, text);
});

test('recordatorios repetidos y posponer', async () => {
  const r = await c.ask('recuérdame todos los días a las 8 de la mañana tomar la pastilla');
  assert.match(r.reply, /todos los días/);
  assert.match(r.reply, /tomar la pastilla/);
  assert.equal(brain.reminders().at(-1).repeat.days.length, 7);
});

test('comandos encadenados piden confirmación cuando hace falta', async () => {
  const r = await c.ask('ordena mis descargas y vacía la papelera');
  assert.equal(r.confirm, true);
  await c.confirm(false);
});

test('tareas y datos', async () => {
  await c.ask('agrega comprar pan a mi lista');
  assert.equal(brain.todos().at(-1).text, 'comprar pan');
  await c.ask('ya hice comprar pan');
  assert.equal(brain.todos().length, 0);
  await c.ask('recuerda que mi cumpleaños es el 5 de marzo');
  assert.equal(brain.settings.birthday, '03-05');
});

test('modo solo charla bloquea acciones en la PC', async () => {
  await c.ask('modo solo charla');
  const r = await c.ask('vacía la papelera');
  assert.match(r.reply, /solo charla/);
  await c.ask('desactiva solo charla');
  assert.equal(brain.settings.chatOnly, false);
});

test.after(() => setTimeout(() => process.exit(0), 50));
