// Comandos de MicroPanda: lista cerrada de acciones permitidas (nunca ejecuta texto libre).
// Cada intención tiene patrones en español, una confirmación opcional y una acción.
// Las acciones extra están en acciones.js; también se pueden sumar plugins en ~/.micropanda/plugins/*.js
const { execFile, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const llm = require('./ollama');
const tiempo = require('./tiempo');

let electron = null; // shell, app y clipboard se inyectan desde main.js (permite probar este módulo sin Electron)
let brain = null;    // memoria y emociones (brain.js), también inyectado
let onSetting = () => {};
const HOME = process.env.MICROPANDA_HOME || path.join(os.homedir(), '.micropanda');
const LOG = path.join(HOME, 'acciones.log');

function ps(command) {
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 120000 },
      (err, stdout, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout.trim())));
  });
}

function launch(exe, args = []) {
  spawn(exe, args, { detached: true, stdio: 'ignore', windowsHide: false }).unref();
}

// Muletillas latinas que no cambian la orden: "porfa bájale al volumen" = "bájale al volumen".
const FILLERS = /\b(por favor|porfa|porfis|plis|please|ahorita|oye|dale|che|pues|nomas|no mas)\b/g;
const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,;]/g, ' ')
  .replace(FILLERS, ' ').replace(/\s+/g, ' ').trim();
const mb = (bytes) => (bytes / 1024 ** 2).toFixed(0);
const gb = (bytes) => (bytes / 1024 ** 3).toFixed(1);

// Programas y carpetas que se pueden abrir por nombre.
const APPS = [
  { names: ['bloc de notas', 'notepad', 'notas'], label: 'el Bloc de notas', open: () => launch('notepad.exe') },
  { names: ['calculadora', 'calc'], label: 'la Calculadora', open: () => launch('calc.exe') },
  { names: ['explorador', 'archivos', 'mi pc', 'este equipo'], label: 'el Explorador', open: () => launch('explorer.exe') },
  { names: ['administrador de tareas', 'task manager', 'tareas'], label: 'el Administrador de tareas', open: () => launch('taskmgr.exe') },
  { names: ['paint'], label: 'Paint', open: () => launch('mspaint.exe') },
  { names: ['terminal', 'powershell', 'consola'], label: 'la Terminal', open: () => launch('powershell.exe') },
  { names: ['configuracion', 'ajustes', 'opciones'], label: 'la Configuración', open: () => electron.shell.openExternal('ms-settings:') },
  { names: ['navegador', 'internet', 'google', 'chrome', 'edge'], label: 'el navegador', open: () => electron.shell.openExternal('https://www.google.com') },
  { names: ['descargas'], label: 'Descargas', open: () => electron.shell.openPath(electron.app.getPath('downloads')) },
  { names: ['documentos'], label: 'Documentos', open: () => electron.shell.openPath(electron.app.getPath('documents')) },
  { names: ['escritorio'], label: 'el Escritorio', open: () => electron.shell.openPath(electron.app.getPath('desktop')) },
  { names: ['imagenes', 'fotos'], label: 'Imágenes', open: () => electron.shell.openPath(electron.app.getPath('pictures')) },
  { names: ['musica'], label: 'Música', open: () => electron.shell.openPath(electron.app.getPath('music')) },
  { names: ['videos'], label: 'Videos', open: () => electron.shell.openPath(electron.app.getPath('videos')) },
];

// Páginas web por nombre.
const WEB = {
  youtube: 'https://www.youtube.com', gmail: 'https://mail.google.com', correo: 'https://mail.google.com',
  whatsapp: 'https://web.whatsapp.com', outlook: 'https://outlook.live.com', hotmail: 'https://outlook.live.com',
  netflix: 'https://www.netflix.com', spotify: 'https://open.spotify.com', facebook: 'https://www.facebook.com',
  instagram: 'https://www.instagram.com', tiktok: 'https://www.tiktok.com', 'google maps': 'https://maps.google.com', mapas: 'https://maps.google.com',
  drive: 'https://drive.google.com', 'google docs': 'https://docs.google.com', calendario: 'https://calendar.google.com',
  traductor: 'https://translate.google.com', github: 'https://github.com', linkedin: 'https://www.linkedin.com',
  twitter: 'https://x.com', wikipedia: 'https://es.wikipedia.org', 'mercado libre': 'https://www.mercadolibre.com', amazon: 'https://www.amazon.com',
};

// Apps instaladas: accesos directos del menú Inicio (se leen una vez y se guardan 10 min).
let startMenu = null, startMenuAt = 0;
function installedApps() {
  if (startMenu && Date.now() - startMenuAt < 10 * 60e3) return startMenu;
  const roots = [
    path.join(process.env.ProgramData || 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
  ];
  const found = [];
  const walk = (dir, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && depth < 3) walk(p, depth + 1);
      else if (/\.(lnk|url)$/i.test(e.name) && !/uninstall|desinstalar|readme|help|ayuda/i.test(e.name)) {
        found.push({ name: normalize(e.name.replace(/\.(lnk|url)$/i, '')), label: e.name.replace(/\.(lnk|url)$/i, ''), file: p });
      }
    }
  };
  roots.forEach((r) => walk(r, 0));
  // apps de la Microsoft Store (Claude, WhatsApp…): Get-StartApps, leídas en segundo plano
  for (const a of storeApps) if (!found.some((f) => f.name === a.name)) found.push(a);
  startMenu = found;
  startMenuAt = Date.now();
  return found;
}

let storeApps = [];
function loadStoreApps() {
  ps('Get-StartApps | ForEach-Object { "$($_.Name)`t$($_.AppID)" }').then((out) => {
    storeApps = out.split(/\r?\n/).map((l) => l.split('\t')).filter(([n, id]) => n && id && /!/.test(id))
      .map(([n, id]) => ({ name: normalize(n), label: n, appId: id }));
    startMenu = null;
  }).catch(() => {});
}
const openApp = (a) => (a.appId ? launch('explorer.exe', [`shell:AppsFolder\\${a.appId}`]) : electron.shell.openPath(a.file));

// ¿Qué abrir? lista propia -> app instalada con ese nombre exacto -> páginas web -> "algo.com" -> apps parecidas
function findTarget(target) {
  const t = normalize(target).replace(/^(el|la|los|las|mi|mis|al|a)\s+/, '');
  if (!t) return null;
  const own = APPS.find((a) => a.names.some((n) => t === n || t.includes(n)));
  if (own) return own;
  const exact = installedApps().find((a) => a.name === t);
  if (exact) return { label: exact.label, open: () => openApp(exact) };
  const site = Object.keys(WEB).find((k) => t === k || t.includes(k));
  if (site) return { label: site[0].toUpperCase() + site.slice(1), open: () => electron.shell.openExternal(WEB[site]) };
  const domain = t.replace(/\s+punto\s+/g, '.').match(/\b([a-z0-9-]+\.(?:com|pe|mx|co|ar|cl|es|org|net|io|dev|ai|edu|gob)(?:\.[a-z]{2})?)\b/);
  if (domain) return { label: domain[1], open: () => electron.shell.openExternal(`https://${domain[1]}`) };
  const apps = installedApps();
  const hit = apps.find((a) => a.name === t) || apps.find((a) => a.name.startsWith(t)) || apps.find((a) => a.name.includes(t))
    || (t.length > 3 && apps.find((a) => t.includes(a.name) && a.name.length > 3));
  if (hit) return { label: hit.label, open: () => openApp(hit) };
  return null;
}

const volumeKeys = (key, times) => ps(`$w = New-Object -ComObject WScript.Shell; 1..${times} | ForEach-Object { $w.SendKeys([char]${key}) }`);

const HELP = 'Puedo: recordatorios ⏰ ("recuérdame mañana en la tarde…", "cada lunes…"), tareas 📝 y notas 🗒️, pomodoro 🍅, '
  + 'abrir apps y páginas 📂, buscar archivos 🔎, música ⏯️, volumen 🔊, brillo 🔆, modo oscuro 🌙, ordenar Descargas 🗂️, cerrar apps, '
  + 'apagar o reiniciar la PC, clima ☀️ y dólar 💵, resumir o traducir lo que copiaste 📋, rutinas ✨ y más. Pregúntame lo que quieras.';

const REMIND_WORDS = /^(?:\s*(?:oye|hola|ey)\s*,?)?\s*(?:micro\s?)?(?:panda\s*,?\s*)?(?:por favor\s+|porfa\s+)?(?:rec[uú][eé]?rd[aá]me(?:lo)?|recordarme|ac[uú][eé]rdame|av[ií]same|despi[eé]rtame|p[oó]sp[oó]n(?:lo)?|(?:pon(?:me|er)?|programa|crea|agenda|anota)(?:\s+(?:una|un))?\s+(?:alarma|recordatorio)|(?:una\s+)?alarma|recordatorio)\s*(?:para\s+|de\s+)?/i;
const cleanTask = (rest) => rest.replace(REMIND_WORDS, '').replace(/^(?:que|de|a|para|el|la)\s+/i, '')
  .replace(/\b(?:por favor|porfa|porfis|plis)\b/gi, '').replace(/[\s,.;:!?¡¿]+$/g, '').replace(/^[\s,]+/, '').trim();

const CORE = [
  {
    id: 'remind-list', llm: 'decir qué recordatorios tiene pendientes',
    patterns: [/\b(mis recordatorios|mis alarmas|que recordatorios|que alarmas|tengo (algun )?(recordatorio|alarma)s?|lista de recordatorios)\b/],
    run: async () => {
      const list = brain ? brain.reminders() : [];
      if (!list.length) return { reply: 'No tienes recordatorios pendientes 📭', mood: 'idle' };
      const lines = list.slice(0, 4).map((r) => `${tiempo.spokenWhen(r.at)}${r.repeat ? ` (${tiempo.spokenRepeat(r.repeat)})` : ''}: ${r.text}`);
      return { reply: `Tienes ${list.length}: ${lines.join(' · ')}${list.length > 4 ? '…' : ''} ⏰`, mood: 'focused' };
    },
  },
  {
    id: 'remind-clear', llm: 'borrar todos los recordatorios',
    patterns: [/\b(borra|borrar|cancela|cancelar|elimina|eliminar|quita|quitar)\b.*\b(recordatorios?|alarmas?)\b/],
    confirm: '¿Borro todos tus recordatorios?',
    run: async () => {
      const n = brain ? brain.clearReminders() : 0;
      return { reply: n ? `Listo, borré ${n} recordatorio${n === 1 ? '' : 's'} 🧹` : 'No tenías recordatorios 📭', mood: 'happy' };
    },
  },
  {
    id: 'remind', llm: 'crear un recordatorio o alarma, una vez o repetido ("mañana en la tarde", "en 10 minutos", "cada lunes a las 8", "todos los días")',
    patterns: [/\b(recuerdame|recordame|recordarme|recuerdamelo|acuerdame|avisame|despiertame|alarma|recordatorio|pospon|posponlo)\b/],
    run: async (_m, text) => {
      const rep = tiempo.parseRepeat(text);
      const when = tiempo.parseWhen(rep ? rep.text : text);
      if (!when && !rep) return { reply: '¿Para cuándo? Dime, por ejemplo: "recuérdame mañana en la tarde llamar a mi mamá" ⏰', mood: 'thinking' };
      let at = when && when.date;
      if (rep) {
        const base = at || (rep.repeat.every ? new Date(Date.now() + rep.repeat.every) : new Date(new Date().setHours(9, 0, 0, 0)));
        at = tiempo.nextRepeat(rep.repeat, base, new Date());
      }
      if (at - Date.now() < 30e3) return { reply: 'Esa hora ya pasó 😅 ¿Para cuándo lo dejo?', mood: 'thinking' };
      let task = cleanTask(when ? when.rest : rep.text);
      if (!task && /p[oó]sp[oó]n|recu[eé]rd[aá]melo|otra vez/i.test(text)) task = brain.lastReminder() || '';
      if (!task) task = /alarma|despi[eé]rt/i.test(text) ? '¡Hora de levantarse! ☀️' : 'lo que me pediste';
      brain.addReminder(at, task, rep ? rep.repeat : null);
      const how = rep ? `${tiempo.spokenRepeat(rep.repeat)}, empezando ${tiempo.spokenWhen(at)}` : tiempo.spokenWhen(at);
      return { reply: `¡Anotado! Te aviso ${how}: ${task} ⏰`, mood: 'happy' };
    },
  },
  {
    id: 'help', llm: 'explicar qué sabe hacer',
    patterns: [/\b(ayuda|que puedes hacer|que sabes hacer|comandos)\b/],
    run: async () => ({ reply: HELP, mood: 'happy' }),
  },
  {
    id: 'hello', patterns: [/^(hola|buenas|hey|buenos dias|buenas tardes|buenas noches)$/],
    run: async () => ({ reply: '¡Hola! 🐼 ¿En qué te ayudo? Escribe "ayuda" para ver lo que sé hacer.', mood: 'happy' }),
  },
  {
    id: 'thanks', patterns: [/^(gracias|muchas gracias|te quiero|buen trabajo)\b/],
    run: async () => ({ reply: '¡De nada! 💚', mood: 'love' }),
  },
  {
    id: 'about-me', patterns: [/\b(que sabes de mi|me quieres|cuanto me quieres|me recuerdas|como me llamo)\b/],
    run: async () => {
      if (!brain) return { reply: 'Aún estoy conociéndote 🐼', mood: 'love' };
      const facts = brain.facts.slice(-4);
      return { reply: `${brain.summary()}${facts.length ? ` · me contaste: ${facts.join('; ')}` : ''} 🐼`, mood: 'love' };
    },
  },
  {
    id: 'recycle', pc: true, llm: 'vaciar la papelera de reciclaje',
    patterns: [/\b(vacia|vaciar|limpia|limpiar|borra|borrar)\b.*\b(papelera|reciclaje)\b/],
    confirm: '¿Vacío la papelera de reciclaje? Esto no se puede deshacer.',
    run: async () => {
      const n = Number(await ps('(New-Object -ComObject Shell.Application).NameSpace(10).Items().Count')) || 0;
      if (!n) return { reply: 'La papelera ya estaba vacía ✨', mood: 'happy' };
      await ps('Clear-RecycleBin -Force -ErrorAction SilentlyContinue');
      return { reply: `¡Listo! Eliminé ${n} elemento${n === 1 ? '' : 's'} de la papelera 🗑️`, mood: 'happy' };
    },
  },
  {
    id: 'temp', pc: true, llm: 'borrar archivos temporales / basura del sistema',
    patterns: [/\b(limpia|limpiar|borra|borrar|elimina|eliminar)\b.*\b(temporales|temporal|temp|basura)\b/],
    confirm: '¿Borro los archivos temporales de más de 1 día? Los que estén en uso se saltan.',
    run: async () => {
      const freed = await ps(
        '$limit = (Get-Date).AddDays(-1); $sum = 0; '
        + 'Get-ChildItem $env:TEMP -Recurse -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -lt $limit } | '
        + 'ForEach-Object { try { $len = $_.Length; Remove-Item $_.FullName -Force -ErrorAction Stop; $sum += $len } catch {} }; $sum');
      return { reply: `¡Listo! Liberé ${mb(Number(freed) || 0)} MB de temporales 🧹`, mood: 'happy' };
    },
  },
  {
    id: 'volume-up', pc: true, llm: 'subir el volumen',
    patterns: [
      /\b(sube|subele|subile|subir|aumenta|aumentar|mas)\b.*\b(volumen|sonido|audio)\b/,
      /\b(mas fuerte|mas alto|no se escucha|no escucho nada|subele)\b/,
    ],
    run: async () => { await volumeKeys(175, 5); return { reply: 'Volumen arriba 🔊', mood: 'happy' }; },
  },
  {
    id: 'volume-down', pc: true, llm: 'bajar el volumen',
    patterns: [
      /\b(baja|bajale|bajar|disminuye|reduce|menos)\b.*\b(volumen|sonido|audio)\b/,
      /\b(mas bajo|mas bajito|mas despacio|muy fuerte|esta muy alto|bajale)\b/,
    ],
    run: async () => { await volumeKeys(174, 5); return { reply: 'Volumen abajo 🔉', mood: 'happy' }; },
  },
  {
    id: 'mute', pc: true, llm: 'silenciar o reactivar el sonido',
    patterns: [/\b(silencia|silenciar|mute|mutea|quita el sonido|activa el sonido|desmutea)\b/],
    run: async () => { await volumeKeys(173, 1); return { reply: 'Listo, cambié el silencio 🔇', mood: 'happy' }; },
  },
  {
    id: 'screenshot', pc: true, llm: 'hacer una captura o recorte de pantalla',
    patterns: [/\b(captura|recorte|screenshot|pantallazo|foto a la pantalla|foto de la pantalla)\b/],
    run: async () => { await electron.shell.openExternal('ms-screenclip:'); return { reply: 'Elige el área que quieres capturar ✂️', mood: 'happy' }; },
  },
  {
    id: 'lock', pc: true, llm: 'bloquear la PC / la sesión',
    patterns: [/\b(bloquea|bloquear)\b.*\b(pc|computadora|pantalla|equipo|compu|maquina|laptop|sesion)\b/],
    confirm: '¿Bloqueo la PC ahora?',
    run: async () => { launch('rundll32.exe', ['user32.dll,LockWorkStation']); return { reply: 'PC bloqueada 🔒', mood: 'sleepy' }; },
  },
  {
    id: 'time', llm: 'decir la hora',
    patterns: [/\b(que hora|hora es|la hora|que ahora es|tienes hora|me das la hora)\b/],
    run: async () => {
      const clock = tiempo.spokenClock(new Date());   // "las 3:05 de la tarde"
      return { reply: `${clock.startsWith('la ') ? 'Es' : 'Son'} ${clock} ⏰`, mood: 'happy' };
    },
  },
  {
    id: 'date', llm: 'decir la fecha o el día',
    patterns: [/\b(que dia es|que fecha|fecha de hoy|a cuanto estamos)\b/],
    run: async () => ({ reply: `Hoy es ${new Date().toLocaleDateString('es-419', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} 📅`, mood: 'happy' }),
  },
  {
    id: 'system', llm: 'mostrar el estado de la PC (memoria RAM, disco, tiempo encendida)',
    patterns: [/\b(memoria|ram)\b/, /\b(estado del sistema|como esta la pc|como esta la compu|como esta mi pc|estado de la pc)\b/],
    run: async () => {
      const used = os.totalmem() - os.freemem();
      const hours = Math.floor(os.uptime() / 3600);
      let disk = '';
      try { const s = fs.statfsSync(`${process.env.SystemDrive || 'C:'}\\`); disk = ` · disco: ${gb(s.bavail * s.bsize)} GB libres`; } catch {}
      return { reply: `RAM: ${gb(used)} de ${gb(os.totalmem())} GB en uso${disk} · encendida hace ${hours} h 💻`, mood: 'focused' };
    },
  },
];

// abrir va al final: es la regla más general ("abre …", "pon …")
const OPEN = {
  id: 'open', pc: true, llm: 'abrir una app instalada, carpeta o página web (pon el nombre en "target")',
  patterns: [/\b(abre|abrir|abreme|abrime|inicia|iniciar|ejecuta|lanza|muestrame|prende|prendeme|ponme|pon|entra a|entrar a|vamos a)\b\s+(?:el |la |los |las |mi |mis |al |a )?(.+)/],
  run: async (m) => {
    const target = (m[2] || '').trim();
    const t = findTarget(target);
    if (!t) return { reply: `No encontré "${target}" 😅. Prueba con el nombre de una app instalada o una página (youtube, gmail…).`, mood: 'sad' };
    await t.open();
    return { reply: `Abriendo ${t.label} 📂`, mood: 'happy' };
  },
};

let INTENTS = [...CORE, OPEN];

// plugins del usuario: cada archivo exporta una lista de intenciones (mismo formato)
function loadPlugins() {
  const dir = path.join(HOME, 'plugins');
  const out = [];
  try {
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.js'))) {
      try {
        const mod = require(path.join(dir, f));
        const list = typeof mod === 'function' ? mod({ ps, launch, electron, brain, llm, tiempo }) : mod.intents || mod;
        for (const it of [].concat(list)) if (it && it.id && it.patterns && it.run) out.push({ pc: true, ...it, id: `plugin:${it.id}` });
      } catch (err) { console.warn(`Plugin ${f} no cargó:`, err.message); }
    }
  } catch {}
  return out;
}

let pending = null; // acción esperando confirmación
const SAFE_REPLY = { reply: 'Estoy en modo solo charla 💬: no hago cambios en tu PC. Dime "desactiva solo charla" para volver.', mood: 'idle' };

async function ask(text) {
  const q = normalize(text || '');
  if (!q) return { reply: '¿Qué necesitas? 🐼', mood: 'thinking' };
  // el cerebro reacciona primero: aprende tu nombre, se alegra con elogios, se entristece con insultos
  const feeling = brain ? brain.onMessage(text) : null;
  if (feeling && feeling.reply) return feeling;
  const result = (await chained(text, q)) || (await route(text, q));
  if (result.intent === 'chat' || !result.intent) llm.remember(text, result.reply);
  return feeling && feeling.mood && result.mood !== 'sad' ? { ...result, mood: feeling.mood } : result;
}

// "baja el volumen y abre YouTube": si cada parte se entiende sola, las hace en orden.
async function chained(text, q) {
  if (matchIntent(q)?.intent.id.startsWith('remind') || /\b(rutina|lista|nota|anota|recuerda que)\b/.test(q)) return null;
  const parts = text.split(/\s*(?:,\s*)?\b(?:y luego|y despues|y después|luego|después|despues|y también|y tambien|y)\b\s*/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 4 || !parts.every((p) => matchIntent(normalize(p)))) return null;
  return runSteps(parts);
}

async function runSteps(steps) {
  const replies = [];
  let last = null;
  for (const s of steps) {
    last = await route(s, normalize(s));
    replies.push(last.reply);
    if (last.confirm) break;   // si un paso pide confirmación, se detiene ahí
    await new Promise((r) => setTimeout(r, 400));
  }
  return { ...last, reply: replies.join(' · ') };
}

function matchIntent(q) {
  for (const intent of INTENTS) {
    for (const re of intent.patterns) {
      const m = q.match(re);
      if (m) return { intent, m };
    }
  }
  return null;
}

async function route(text, q, target) {
  const hit = matchIntent(q);
  if (!hit) return understand(text);
  return prepare(hit.intent, hit.m, text, target);
}

function prepare(intent, m, text, target) {
  if (intent.pc && brain && brain.settings.chatOnly) return SAFE_REPLY;
  const question = typeof intent.confirm === 'function' ? intent.confirm(m, text, target) : intent.confirm;
  if (question) {
    pending = { intent, m, text, target };
    return { reply: question, mood: 'thinking', confirm: true };
  }
  return execute(intent, m, text, target);
}

const FALLBACK = { reply: 'Aún no sé hacer eso 😅. Escribe "ayuda" para ver lo que puedo hacer.', mood: 'sad' };

// Si las reglas no entienden la frase, Ollama elige una acción de la MISMA lista (o charla).
async function understand(text) {
  let out;
  try {
    out = await llm.interpret(text, {
      appNames: APPS.flatMap((a) => a.names).concat(Object.keys(WEB)),
      userName: brain && brain.name, facts: brain ? brain.facts : [], personality: brain && brain.settings.personality,
    });
  } catch {
    return FALLBACK;
  }
  if (out.intent === 'chat') return { reply: out.reply || '🐼', mood: out.mood, intent: 'chat' };
  const intent = INTENTS.find((i) => i.id === out.intent);
  if (!intent) return { reply: out.reply || FALLBACK.reply, mood: 'sad' };
  // si el modelo no llenó "target", se busca el nombre de la app en su respuesta
  const target = out.target || '';
  if (intent.id === 'open') {
    const name = findTarget(target) ? target : findTarget(normalize(out.reply)) ? normalize(out.reply) : '';
    if (!name) return { reply: `No encontré "${target || 'eso'}" 😅`, mood: 'sad' };
    return prepare(intent, [null, null, name], text, name);
  }
  return prepare(intent, [null, null, target], text, target || undefined);
}

async function confirm(yes) {
  const p = pending;
  pending = null;
  if (!p) return { reply: 'No había nada pendiente 🤔', mood: 'thinking' };
  if (!yes) return { reply: 'Ok, no hice nada 👍', mood: 'idle' };
  return execute(p.intent, p.m, p.text, p.target);
}

async function execute(intent, m, text = '', target) {
  let result;
  try {
    result = { ...(await intent.run(m, text, target)), intent: intent.id };
  } catch (err) {
    result = { reply: `Ups, algo falló: ${err.message.split('\n')[0].slice(0, 120)}`, mood: 'sad', intent: intent.id };
  }
  if (intent.pc) log(intent.id, text, result.reply);
  return result;
}

// registro de todo lo que hizo en la PC (~/.micropanda/acciones.log)
function log(intent, text, reply) {
  try {
    fs.mkdirSync(HOME, { recursive: true });
    fs.appendFileSync(LOG, `${new Date().toISOString()}  ${intent.padEnd(14)}  "${text}"  ->  ${reply}\n`);
  } catch {}
}

// ¿Las reglas rápidas ya entienden esta frase? (sin ejecutar nada)
function recognizes(text) {
  return !!matchIntent(normalize(text || ''));
}

function init(e) {
  electron = e;
  brain = e.brain || null;
  onSetting = e.onSetting || onSetting;
  const ctx = {
    ps, launch, llm, logFile: LOG, runSteps,
    electron: () => electron, brain: () => brain,
    setSetting: (k, v) => { brain.setSetting(k, v); onSetting(k, v); },
    // los da main.js (en las pruebas no existen)
    captureScreen: e.captureScreen || (async () => { throw new Error('sin pantalla'); }),
    walk: e.walk || (() => {}), gesture: e.gesture || (() => {}),
    checkUpdates: e.checkUpdates || (async () => ({ reply: 'No puedo buscar actualizaciones aquí', mood: 'idle' })),
    voiceDir: process.env.MICROPANDA_VOICE_DIR || path.join(HOME, 'voice'),
  };
  const fase2 = require('./mas-acciones')(ctx);
  const extra = require('./acciones')(ctx);
  INTENTS = [...CORE.slice(0, 3), ...fase2, ...extra, ...CORE.slice(3), ...loadPlugins(), OPEN];
  llm.addActions(Object.fromEntries(INTENTS.filter((i) => i.llm).map((i) => [i.id, i.llm])));
  llm.start();
  if (process.platform === 'win32') loadStoreApps();
}

module.exports = {
  ask, confirm, recognizes, init, runSteps,
  _normalize: normalize, get _intents() { return INTENTS; }, _llm: llm, _apps: APPS, _cleanTask: cleanTask, _findTarget: findTarget,
};
