// Cerebro de MicroPanda: decide su estado de ánimo solo y aprende con el tiempo.
//
// Lo que observa: hora del día, si estás frente a la PC (teclado y mouse), carga de CPU y RAM,
// cómo lo tratas (elogios, gracias, insultos) y qué comandos usas.
// Lo que aprende (se guarda en ~/.micropanda/memoria.json): cariño hacia ti (0-100), tu nombre,
// tus comandos favoritos, cuántos días lo has usado. El cariño cambia qué ánimos muestra.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FILE = path.join(process.env.MICROPANDA_HOME || path.join(os.homedir(), '.micropanda'), 'memoria.json');
const TICK_MS = 20000;
const MIN = 60000;

const DEFAULTS = {
  affection: 50,
  name: null,
  interactions: 0,
  daysUsed: 0,
  lastDay: null,
  commands: {},
  settings: {
    speakReplies: true, precise: true, wakeWord: true, autoMood: true, voice: 'ef_dora', device: 'auto',
    wakeName: 'panda', sensitivity: 'normal', micId: '', followUp: true, beep: true, scale: 1,
    personality: 'tierno', model: '', chatOnly: false, health: false, city: '', currency: 'PEN', birthday: '',
    openAtLogin: false, routines: {}, voiceSpeed: 1, walkAuto: false, icsUrl: '', updateRepo: 'angel-cm-dev/micropanda',
    cloudProvider: 'off', cloudUrl: '', cloudModel: '', cloudKeyEnc: '',
  },
  reminders: [],
  facts: [],       // cosas que le contaste: "mi jefe se llama Luis"
  todos: [],       // lista de tareas
};

let mem = load();
let send = () => {};
let notify = () => {};
let getIdleSeconds = () => 0;
let saveTimer = 0;
let busyUntil = 0;           // mientras conversan, el cerebro no interrumpe
let asleep = false;
let lastCpu = cpuTimes(), cpuHigh = 0;
const lastSaid = {};         // para no repetir avisos

function load() {
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const base = structuredClone(DEFAULTS);
    return { ...base, ...data, settings: { ...base.settings, ...data.settings } };
  } catch { return structuredClone(DEFAULTS); }
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(mem, null, 2));
  }, 1000);
}

const clamp = (v) => Math.max(0, Math.min(100, v));
function feel(delta) { mem.affection = clamp(mem.affection + delta); save(); }

function cpuTimes() {
  return os.cpus().reduce((a, c) => {
    const t = c.times;
    a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.idle + t.irq;
    return a;
  }, { idle: 0, total: 0 });
}

function cpuPercent() {
  const now = cpuTimes();
  const idle = now.idle - lastCpu.idle, total = now.total - lastCpu.total;
  lastCpu = now;
  return total > 0 ? Math.round(100 * (1 - idle / total)) : 0;
}

// avisa como mucho una vez cada `every` ms por tipo
function once(key, every) {
  const now = Date.now();
  if (lastSaid[key] && now - lastSaid[key] < every) return false;
  lastSaid[key] = now;
  return true;
}

const hi = () => (mem.name ? `, ${mem.name}` : '');
const hour = () => new Date().getHours();

function greeting() {
  const h = hour();
  const base = h < 6 ? `¡Hola${hi()}! Qué madrugada 🌙` : h < 12 ? `¡Buenos días${hi()}! ☀️` : h < 19 ? `¡Buenas tardes${hi()}! 🐼` : `¡Buenas noches${hi()}! 🌙`;
  if (isBirthday()) return `🎂 ¡Feliz cumpleaños${hi()}! Hoy me puse gorrito de fiesta por ti 🎉`;
  const fav = favorite();
  if (fav && fav.count >= 3) return `${base} ¿Te ayudo con lo de siempre? (${fav.label})`;
  return mem.affection > 75 ? `${base} ¡Te extrañé! 💚` : base;
}

const LABELS = {
  remind: 'los recordatorios', recycle: 'vaciar la papelera', temp: 'limpiar temporales', 'volume-up': 'subir el volumen', 'volume-down': 'bajar el volumen',
  mute: 'silenciar', screenshot: 'una captura', lock: 'bloquear la PC', time: 'la hora', date: 'la fecha', system: 'el estado de la PC', open: 'abrir apps',
};

function favorite() {
  const [id, count] = Object.entries(mem.commands).sort((a, b) => b[1] - a[1])[0] || [];
  return id && LABELS[id] ? { id, count, label: LABELS[id] } : null;
}

function emit(mood, { ms = 0, say = null, gesture = null } = {}) {
  if (mem.settings.autoMood) send({ mood, ms, say, gesture });
}

// ---------- lo que pasa en la conversación ----------
const PRAISE = /\b(gracias|te quiero|te amo|eres (genial|lindo|tierno|el mejor|increible)|buen trabajo|bien hecho|que lindo|me encantas)\b/;
const INSULT = /\b(tonto|inutil|feo|estupido|te odio|callate|no sirves|malo)\b/;

// Devuelve, si corresponde, un ánimo que mejora la respuesta (p. ej. elogio -> encantado).
function onMessage(text) {
  busyUntil = Date.now() + 2 * MIN;
  mem.interactions++;
  const q = text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // el nombre se toma del texto original para conservar tildes (Ángel, José…)
  const name = text.toLowerCase().match(/(?:me llamo|mi nombre es|ll[aá]mame)\s+([a-zñáéíóúü]{2,20})/);
  if (name && !['micropanda', 'panda', 'tu', 'yo'].includes(name[1])) {
    mem.name = name[1][0].toUpperCase() + name[1].slice(1);
    save();
    return { mood: 'love', reply: `¡Mucho gusto, ${mem.name}! Ya no lo olvidaré 💚` };
  }
  if (PRAISE.test(q)) { feel(+4); return { mood: 'love' }; }
  if (INSULT.test(q)) { feel(-6); return { mood: mem.affection < 30 ? 'annoyed' : 'sad' }; }
  save();
  return null;
}

function onResult(result) {
  if (result.intent && LABELS[result.intent]) {
    mem.commands[result.intent] = (mem.commands[result.intent] || 0) + 1;
    if (result.mood !== 'sad') feel(+1);
  }
  save();
}

function onPoke() { feel(+0.5); busyUntil = Date.now() + 10000; }
function onLock() { asleep = true; emit('sleepy'); }

// ---------- vida propia: revisa el entorno cada 20 s ----------
function tick() {
  const idle = getIdleSeconds();
  const today = new Date().toDateString();
  healthTick(idle);
  batteryTick();

  // te fuiste de la PC: se duerme; al volver se despierta y te saluda
  if (idle > 5 * 60) {
    if (!asleep) { asleep = true; emit('sleepy'); }
    return;
  }
  if (asleep) {
    asleep = false;
    if (mem.lastDay !== today) newDay(today);
    else emit('surprised', { ms: 1500, say: once('back', 30 * MIN) ? `¡Volviste${hi()}! 🐼` : null });
    return;
  }
  if (mem.lastDay !== today) { newDay(today); return; }
  if (Date.now() < busyUntil) return;

  const cpu = cpuPercent();
  const ramPct = Math.round(100 * (1 - os.freemem() / os.totalmem()));
  cpuHigh = cpu > 85 ? cpuHigh + 1 : 0;

  if (ramPct >= 90 && once('ram', 30 * MIN)) {
    return emit('annoyed', { ms: 8000, say: `Tu RAM está al ${ramPct}% 😤 Si quieres, dime "Panda, limpia los temporales".` });
  }
  if (cpuHigh >= 2 && once('cpu', 20 * MIN)) {
    return emit('focused', { ms: 10000, say: `Tu PC está trabajando duro (CPU ${cpu}%) 💻` });
  }
  const h = hour();
  if (h >= 0 && h < 5 && once('late', 3 * 60 * MIN)) {
    return emit('sleepy', { ms: 8000, say: 'Ya es muy tarde… ¿no deberías descansar? 😴' });
  }

  // momentos espontáneos, con más ánimo cuanto más cariño te tiene
  if (Math.random() < 0.12) {
    const a = mem.affection;
    const pool = a > 75 ? ['happy', 'love', 'happy', 'thinking']
      : a < 30 ? ['sad', 'annoyed', 'thinking', 'idle']
        : ['happy', 'thinking', 'focused', 'idle'];
    emit(pool[Math.floor(Math.random() * pool.length)], { ms: 4000 });
  }
}

function newDay(today) {
  const gap = mem.lastDay ? Math.round((new Date(today) - new Date(mem.lastDay)) / 86400000) : 0;
  if (gap > 2) feel(-Math.min(10, gap));     // te extraña si no vienes en días
  mem.lastDay = today;
  mem.daysUsed++;
  save();
  emit(gap > 2 ? 'sad' : 'happy', { ms: 6000, gesture: gap > 2 ? null : 'wave', say: gap > 2 ? `¡${mem.name || 'Hola'}! Hace ${gap} días que no te veía 🥺` : greeting() });
}

// ---------- recordatorios ("recuérdame mañana en la tarde…", "cada lunes…") ----------
const tiempo = require('./tiempo');
let lastFired = null;   // el último aviso, para "pospónlo 10 minutos"

function addReminder(at, text, repeat = null) {
  mem.reminders.push({ id: Date.now() + Math.random(), at: at.getTime(), text, repeat });
  mem.reminders.sort((a, b) => a.at - b.at);
  save();
}
const reminders = () => mem.reminders.map((r) => ({ ...r, at: new Date(r.at) }));
function clearReminders() { const n = mem.reminders.length; mem.reminders = []; save(); return n; }

// Un aviso importante: sale siempre (aunque el ánimo automático esté apagado), con voz, globo y notificación.
function alert(say, { mood = 'surprised', ms = 12000, title = 'MicroPanda 🐼', body = say } = {}) {
  send({ mood, ms, say, alert: true });
  notify(title, body.replace(/[\p{Extended_Pictographic}\u{FE0F}]/gu, '').trim());
}

// Avisa los que ya tocan. Si la app estuvo cerrada a esa hora, avisa al abrirla.
// Los que se repiten se vuelven a programar.
function checkReminders() {
  const now = Date.now();
  const due = mem.reminders.filter((r) => r.at <= now);
  if (!due.length) return;
  mem.reminders = mem.reminders.filter((r) => r.at > now);
  for (const r of due) {
    const late = now - r.at > 2 * MIN;
    lastFired = { text: r.text, at: now };
    alert(`⏰ ${mem.name ? `¡${mem.name}! ` : ''}${late && !r.repeat ? 'Se me pasó avisarte: ' : 'Te recuerdo: '}${r.text}`,
      { title: 'MicroPanda ⏰', body: r.text });
    if (r.repeat) mem.reminders.push({ ...r, at: tiempo.nextRepeat(r.repeat, new Date(r.at), new Date(now)).getTime() });
  }
  mem.reminders.sort((a, b) => a.at - b.at);
  save();
}
// "recuérdamelo en 10 minutos" justo después de un aviso
const lastReminder = () => (lastFired && Date.now() - lastFired.at < 30 * MIN ? lastFired.text : null);

// ---------- cosas que le cuentas ----------
function addFact(text) {
  const t = text.trim().replace(/[.!]+$/, '');
  if (t && !mem.facts.includes(t)) { mem.facts.push(t); if (mem.facts.length > 60) mem.facts.shift(); save(); }
}
function forgetFacts() { const n = mem.facts.length; mem.facts = []; save(); return n; }

// ---------- lista de tareas ----------
function addTodo(text) { mem.todos.push({ text, done: false, at: Date.now() }); save(); }
const todos = () => mem.todos.filter((t) => !t.done);
function doneTodo(query) {
  const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const q = fold(query);
  const t = todos().find((x) => fold(x.text).includes(q) || q.includes(fold(x.text)));
  if (t) { t.done = true; save(); }
  return t || null;
}
function clearTodos() { const n = todos().length; mem.todos = []; save(); return n; }

// ---------- modo concentración (pomodoro) ----------
let focus = null;
function startFocus(minutes = 25, rest = 5) {
  stopFocus();
  const timer = setTimeout(() => {
    alert(`🍅 ¡Terminaste ${minutes} minutos de concentración! Descansa ${rest} minutos, estírate y toma agua 💧`, { mood: 'happy' });
    focus.timer = setTimeout(() => { alert('⏱️ Se acabó el descanso. ¿Otra ronda? Dime "Panda, pomodoro".', { mood: 'focused' }); focus = null; }, rest * MIN);
  }, minutes * MIN);
  focus = { timer, until: Date.now() + minutes * MIN };
  send({ mood: 'focused', ms: 4000, manual: true });
}
function stopFocus() { if (!focus) return false; clearTimeout(focus.timer); focus = null; return true; }
const focusLeft = () => (focus ? Math.max(0, Math.round((focus.until - Date.now()) / MIN)) : null);

// ---------- pausas activas, agua, batería y disco ----------
let activeMs = 0, waterMs = 0, lastBattery = 0;
function healthTick(idle) {
  if (!mem.settings.health || idle > 120) return;
  activeMs += TICK_MS; waterMs += TICK_MS;
  if (activeMs >= 60 * MIN) { activeMs = 0; alert('🧘 Llevas una hora frente a la compu. Párate un ratito y estira la espalda.', { mood: 'sleepy', ms: 8000 }); }
  else if (waterMs >= 90 * MIN) { waterMs = 0; alert('💧 ¡Hora de tomar agua!', { mood: 'happy', ms: 6000 }); }
}

function batteryTick() {
  if (Date.now() - lastBattery < 5 * MIN) return;
  lastBattery = Date.now();
  require('node:child_process').execFile('powershell.exe', ['-NoProfile', '-Command',
    '$b = Get-CimInstance Win32_Battery | Select-Object -First 1; if ($b) { "$($b.EstimatedChargeRemaining) $($b.BatteryStatus)" }'],
  { windowsHide: true, timeout: 15000 }, (err, out) => {
    const [pct, st] = String(out || '').trim().split(' ').map(Number);
    if (err || !pct) return;
    if (pct <= 15 && st !== 2 && once('battery', 30 * MIN)) alert(`🔋 Te queda ${pct}% de batería. ¡Conecta el cargador!`, { mood: 'annoyed' });
  });
  try {
    const s = fs.statfsSync(process.env.SystemDrive ? `${process.env.SystemDrive}\\` : 'C:\\');
    const free = s.bavail / s.blocks;
    if (free < 0.08 && once('disk', 24 * 60 * MIN)) {
      alert(`💾 Tu disco tiene solo ${Math.round(free * 100)}% libre. Dime "Panda, limpia los temporales" o "vacía la papelera".`, { mood: 'annoyed' });
    }
  } catch {}
}

function start(opts) {
  send = opts.send;
  notify = opts.notify || notify;
  getIdleSeconds = opts.getIdleSeconds;
  setTimeout(tick, 5000);
  setInterval(tick, TICK_MS);
  setTimeout(checkReminders, 6000);
  setInterval(checkReminders, 5000);
}

function summary() {
  const fav = favorite();
  return `Cariño: ${Math.round(mem.affection)}/100 · ${mem.interactions} charlas · ${mem.daysUsed} días juntos`
    + (mem.name ? ` · te llamas ${mem.name}` : '') + (fav ? ` · lo que más usas: ${fav.label}` : '');
}

// ¿Hoy es tu cumpleaños? (settings.birthday = "MM-DD")
function isBirthday(d = new Date()) {
  return mem.settings.birthday === `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

module.exports = {
  start, tick, onMessage, onResult, onPoke, onLock, summary, favorite, isBirthday, alert,
  addReminder, reminders, clearReminders, checkReminders, lastReminder,
  addFact, forgetFacts, get facts() { return mem.facts; },
  addTodo, todos, doneTodo, clearTodos,
  startFocus, stopFocus, focusLeft,
  get settings() { return mem.settings; },
  setSetting(k, v) { mem.settings[k] = v; save(); },
  get name() { return mem.name; },
};
