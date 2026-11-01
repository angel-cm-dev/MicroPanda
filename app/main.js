// MicroPanda — mascota de escritorio para Windows (Electron, MIT).
const {
  app, BrowserWindow, Menu, Notification, Tray, clipboard, desktopCapturer, globalShortcut, ipcMain, nativeImage, powerMonitor,
  safeStorage, screen, session, shell,
} = require('electron');
const path = require('node:path');
const { spawn } = require('node:child_process');
const brain = require('./brain');
const commands = require('./commands');
const voice = require('./voice');
const llm = require('./ollama');

// empaquetado (instalador): la página del panda va en resources/personaje
const ASSETS = app.isPackaged ? path.join(process.resourcesPath, 'personaje') : path.join(__dirname, '..', 'personaje');
const unpacked = (p) => p.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
const BASE = { width: 300, height: 275 };   // solo el panda (a escala 1)
const CHAT_H = 170;                          // alto extra cuando se abre el globo de diálogo
const SHORTCUT = 'CommandOrControl+Alt+P';
const VOICE_SHORTCUT = 'CommandOrControl+Alt+V';
const MUTE_SHORTCUT = 'CommandOrControl+Alt+M';
const MOODS = [
  ['idle', '😐 Tranquilo'], ['happy', '😊 Feliz'], ['love', '😍 Encantado'],
  ['surprised', '😮 Sorprendido'], ['thinking', '🤔 Pensando'], ['focused', '💻 Concentrado'],
  ['annoyed', '😤 Molesto'], ['sad', '😢 Triste'], ['sleepy', '😴 Dormido'],
];
const VOICES = [['ef_dora', 'Dora (mujer)'], ['em_alex', 'Alex (hombre)'], ['em_santa', 'Santa (hombre)']];
const DEVICES = [['auto', 'Automático (GPU si hay, si no CPU)'], ['gpu', 'GPU (tarjeta NVIDIA)'], ['cpu', 'CPU']];
const SIZES = [[0.75, 'Pequeño'], [1, 'Normal'], [1.25, 'Grande'], [1.5, 'Muy grande']];
const SENSITIVITY = [['low', 'Baja (lugares con ruido)'], ['normal', 'Normal'], ['high', 'Alta (hablas bajito)']];
const PERSONALITY = [['tierno', '🥰 Tierno'], ['gracioso', '😜 Gracioso'], ['profesional', '💼 Profesional'], ['serio', '😐 Serio']];
const RECOMMENDED_MODEL = 'qwen2.5:7b';

let win = null;
let tray = null;
let settingsWin = null;
let mics = [];          // micrófonos que reporta la página
let micActive = '';     // el que está usando ahora (nombre que da Windows)
let models = [];        // modelos de Ollama instalados
let micMuted = false;
const settings = () => brain.settings;
const scale = () => settings().scale || 1;
const size = () => ({ width: Math.round(BASE.width * scale()), height: Math.round(BASE.height * scale()) });

// cuando una orden cambia un ajuste ("ahora te llamas Bambú"), se aplica al momento
function onSetting(k, v) {
  if (k === 'wakeName') voice.setWakeName(v);
  if (k === 'model') llm.setModel(v);
  if (k === 'scale') applyScale();
  if (k === 'openAtLogin') setLogin(v);
  if (k === 'voiceSpeed') voice.setSpeed(v);
  if (/^cloud/.test(k)) applyCloud();
  if (win && !win.isDestroyed()) win.webContents.send('config', config());
}
function set(k, v) { brain.setSetting(k, v); onSetting(k, v); }

// ---------- leer la pantalla (solo cuando se lo pides) ----------
async function captureScreen() {
  const d = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const size = { width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const src = sources.find((s) => s.display_id === String(d.id)) || sources[0];
  if (!src) throw new Error('No pude ver la pantalla');
  return src.thumbnail.toPNG();
}

// ---------- caminar por la barra de tareas ----------
let walker = null;
function walk(on) {
  if (walker) { clearInterval(walker.timer); walker = null; win.webContents.send('walk', { on: false }); }
  if (!on || !win) return;
  let dir = Math.random() < 0.5 ? -1 : 1;
  win.webContents.send('walk', { on: true, dir });
  walker = {
    timer: setInterval(() => {
      if (chatOpen || win.isDestroyed()) return;
      const b = win.getBounds();
      const { workArea } = screen.getDisplayMatching(b);
      let x = b.x + dir * 2.5 * scale();
      const turn = x < workArea.x || x + b.width > workArea.x + workArea.width;
      if (turn) { dir = -dir; x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - b.width)); win.webContents.send('walk', { on: true, dir }); }
      win.setPosition(Math.round(x), workArea.y + workArea.height - b.height);
    }, 33),
  };
}
const gesture = (name) => { if (win && !win.isDestroyed()) win.webContents.send('gesture', name); };

// ---------- actualizaciones (si el proyecto está publicado en GitHub) ----------
async function checkUpdates(manual = false) {
  const repo = (settings().updateRepo || '').trim();
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return { reply: manual ? 'Para buscar actualizaciones, pon el repositorio de GitHub en Ajustes (ej. usuario/micropanda) 🔄' : '', mood: 'thinking' };
  }
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(r.status);
    const rel = await r.json();
    const latest = String(rel.tag_name || '').replace(/^v/, '');
    const [a, b] = [latest, app.getVersion()].map((v) => v.split('.').map((n) => Number(n) || 0));
    const i = [0, 1, 2].find((k) => (a[k] || 0) !== (b[k] || 0));
    if (i === undefined || (a[i] || 0) < (b[i] || 0)) return { reply: `Tienes la última versión (${app.getVersion()}) ✨`, mood: 'happy' };
    if (Notification.isSupported()) {
      const n = new Notification({ title: 'MicroPanda 🔄', body: `Hay una versión nueva: ${latest}. Clic para descargarla.`, icon: path.join(ASSETS, 'panda.png') });
      n.on('click', () => shell.openExternal(rel.html_url));
      n.show();
    }
    return { reply: `¡Hay una versión nueva: ${latest}! Te mandé una notificación para descargarla 🔄`, mood: 'surprised' };
  } catch {
    return { reply: manual ? 'No pude revisar las actualizaciones 📡' : '', mood: 'sad' };
  }
}

// ---------- modelo en la nube: la clave se guarda cifrada con la cuenta de Windows ----------
function applyCloud() {
  const s = settings();
  let key = '';
  try { if (s.cloudKeyEnc && safeStorage.isEncryptionAvailable()) key = safeStorage.decryptString(Buffer.from(s.cloudKeyEnc, 'base64')); } catch {}
  llm.setCloud({ provider: s.cloudProvider, url: s.cloudUrl, model: s.cloudModel, key });
}

commands.init({ shell, app, clipboard, brain, onSetting, captureScreen, walk, gesture, checkUpdates });
voice.setPrecise(settings().precise);
voice.setVoice(settings().voice);
voice.setSpeed(settings().voiceSpeed);
voice.setDevice(settings().device);
voice.setWakeName(settings().wakeName);
if (settings().model) llm.setModel(settings().model);

function deviceLabel(st) {
  const where = st.gpu ? `GPU${st.gpuName ? ` · ${st.gpuName.replace(/^NVIDIA (GeForce )?/, '')}` : ''}` : 'CPU';
  return `Ahora: escucha en ${where} · voz en ${st.ttsDevice.toUpperCase()}`;
}

// lo que la página necesita saber (micrófono, sensibilidad, disfraz…)
function config() {
  const s = settings();
  return {
    ...voice.status(), speakReplies: s.speakReplies, wakeWord: s.wakeWord && !micMuted, micMuted,
    sensitivity: s.sensitivity, micId: s.micId, followUp: s.followUp, beep: s.beep, birthday: brain.isBirthday(),
    wakeName: s.wakeName,
  };
}

function buildMenu() {
  const st = voice.status();
  const s = settings();
  refreshModels();
  const cap = (w) => w[0].toUpperCase() + w.slice(1);
  return Menu.buildFromTemplate([
    { label: 'Escribirle a MicroPanda', accelerator: SHORTCUT, click: openChat },
    { label: 'Hablarle (voz)', accelerator: VOICE_SHORTCUT, click: listen, enabled: st.stt },
    { label: `Escuchar cuando digo "${cap(s.wakeName || 'panda')}"`, type: 'checkbox', checked: s.wakeWord && st.stt, enabled: st.stt, click: (i) => setWake(i.checked) },
    { label: micMuted ? '🎙️ Activar micrófono' : '🔇 Silenciar micrófono', accelerator: MUTE_SHORTCUT, click: toggleMute, enabled: st.stt },
    ...(st.stt && st.tts ? [] : [{ label: '⬇️ Instalar la voz (~1 GB)…', click: installVoice }]),
    { type: 'separator' },
    {
      label: 'Voz y oído', submenu: [
        { label: 'Responder en voz alta', type: 'checkbox', checked: s.speakReplies, enabled: st.tts, click: (i) => set('speakReplies', i.checked) },
        { label: 'Seguir escuchando después de responder', type: 'checkbox', checked: s.followUp, click: (i) => set('followUp', i.checked) },
        { label: 'Sonido al oír su nombre', type: 'checkbox', checked: s.beep, click: (i) => set('beep', i.checked) },
        {
          label: st.gpu ? 'Escucha precisa (siempre activa en GPU)' : 'Escucha precisa (más lenta)',
          type: 'checkbox', checked: st.gpu || s.precise, enabled: st.canChoosePrecision,
          click: (i) => { brain.setSetting('precise', i.checked); voice.setPrecise(i.checked); },
        },
        { type: 'separator' },
        { label: 'Sensibilidad del micrófono', enabled: false },
        ...SENSITIVITY.map(([id, label]) => ({ label, type: 'radio', checked: s.sensitivity === id, click: () => set('sensitivity', id) })),
        { type: 'separator' },
        { label: `Micrófono${micActive ? ` · en uso: ${micActive}` : ''}`, enabled: false },
        { label: 'El de Windows (predeterminado)', type: 'radio', checked: !s.micId, click: () => set('micId', '') },
        ...mics.map((m) => ({ label: m.label || 'Micrófono', type: 'radio', checked: s.micId === m.id, click: () => set('micId', m.id) })),
        { type: 'separator' },
        { label: 'Voz', enabled: false },
        ...VOICES.map(([id, label]) => ({
          label, type: 'radio', checked: s.voice === id, enabled: st.ttsEngine === 'Kokoro-82M',
          click: () => { brain.setSetting('voice', id); voice.setVoice(id); },
        })),
      ],
    },
    {
      label: 'Procesador', submenu: [
        ...DEVICES.map(([id, label]) => ({
          label, type: 'radio', checked: (s.device || 'auto') === id, enabled: id !== 'gpu' || st.gpuAvailable,
          click: () => { brain.setSetting('device', id); voice.setDevice(id); },
        })),
        { type: 'separator' },
        { label: deviceLabel(st), enabled: false },
      ],
    },
    {
      label: 'Inteligencia', submenu: [
        ...PERSONALITY.map(([id, label]) => ({ label, type: 'radio', checked: s.personality === id, click: () => set('personality', id) })),
        { type: 'separator' },
        { label: 'Modelo de Ollama', enabled: false },
        { label: `Automático${llm.model ? ` (${llm.model})` : ''}`, type: 'radio', checked: !s.model, click: () => set('model', '') },
        ...models.map((m) => ({ label: m, type: 'radio', checked: s.model === m, click: () => set('model', m) })),
        ...(models.includes(RECOMMENDED_MODEL) ? [] : [{ label: `⬇️ Descargar ${RECOMMENDED_MODEL} (recomendado, 4.7 GB)`, click: () => pullModel(RECOMMENDED_MODEL) }]),
        { type: 'separator' },
        { label: `☁️ Modelo en la nube: ${llm.cloudOn ? 'activado' : 'apagado'} (en Ajustes)`, enabled: false },
        { label: '💬 Modo solo charla (no toca la PC)', type: 'checkbox', checked: s.chatOnly, click: (i) => set('chatOnly', i.checked) },
        { label: '🧘 Pausas activas y agua', type: 'checkbox', checked: s.health, click: (i) => set('health', i.checked) },
        { label: '📜 Ver registro de acciones', click: () => commands.ask('registro de acciones') },
      ],
    },
    {
      label: 'Estado de ánimo', submenu: [
        { label: 'Automático (lo decide él)', type: 'checkbox', checked: s.autoMood, click: (i) => brain.setSetting('autoMood', i.checked) },
        { type: 'separator' },
        ...MOODS.map(([id, label]) => ({ label, click: () => win.webContents.send('mood', { mood: id, manual: true }) })),
      ],
    },
    { label: brain.summary(), enabled: false },
    { type: 'separator' },
    { label: 'Tamaño', submenu: SIZES.map(([v, label]) => ({ label, type: 'radio', checked: scale() === v, click: () => set('scale', v) })) },
    { label: walker ? '🐾 Quedarse quieto' : '🐾 Pasear por la barra', click: () => walk(!walker) },
    { label: 'Pasear solo de vez en cuando', type: 'checkbox', checked: !!s.walkAuto, click: (i) => set('walkAuto', i.checked) },
    { label: 'Siempre encima', type: 'checkbox', checked: win.isAlwaysOnTop(), click: (i) => win.setAlwaysOnTop(i.checked, 'floating') },
    { label: 'Iniciar con Windows', type: 'checkbox', checked: !!s.openAtLogin, click: (i) => set('openAtLogin', i.checked) },
    { label: 'Volver a la esquina', click: placeInCorner },
    { label: '⚙️ Ajustes…', click: openSettings },
    { label: win.isVisible() ? 'Ocultar' : 'Mostrar', click: () => (win.isVisible() ? win.hide() : win.show()) },
    { type: 'separator' },
    { label: 'Salir', click: () => app.quit() },
  ]);
}

function refreshModels() { llm.listModels().then((m) => { models = m; }).catch(() => {}); }

async function pullModel(name) {
  const say = (text) => win.webContents.send('mood', { mood: 'focused', ms: 6000, say: text, alert: false });
  say(`Descargando ${name}… te aviso cuando termine ⬇️`);
  try {
    await llm.pull(name, (pct) => say(`Descargando ${name}: ${pct}`));
    set('model', name);
    brain.alert(`¡Listo! Ahora uso ${name} y te entiendo mejor 🧠`, { mood: 'happy' });
  } catch (err) { brain.alert(`No pude descargar ${name}: ${err.message}`, { mood: 'sad' }); }
}

// Abre una ventana de PowerShell con el instalador de voz (setup-voice.ps1).
function installVoice() {
  const script = unpacked(path.join(__dirname, 'setup-voice.ps1'));
  spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-NoExit', '-File', script, '-WhisperModel', 'large-v3-turbo-q5_0', '-Kokoro'],
    { detached: true, stdio: 'ignore', windowsHide: false }).unref();
  brain.alert('Abrí el instalador de la voz. Cuando termine, reinicia MicroPanda 🎙️', { mood: 'focused' });
}

function setLogin(on) {
  const opts = { openAtLogin: !!on };
  if (!app.isPackaged) Object.assign(opts, { path: process.execPath, args: [path.resolve(__dirname)] });
  app.setLoginItemSettings(opts);
}

// esquina inferior derecha de la pantalla donde está el mouse (sirve con varios monitores)
function placeInCorner() {
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const { width, height } = win.getBounds();
  win.setPosition(workArea.x + workArea.width - width - 24, workArea.y + workArea.height - height);
}

function applyScale() {
  if (!win) return;
  const b = win.getBounds();
  const { width, height } = size();
  const h = height + (chatOpen ? Math.round(CHAT_H * scale()) : 0);
  win.setResizable(true);
  win.setBounds({ x: b.x + b.width - width, y: b.y + b.height - h, width, height: h });
  win.setResizable(false);
  win.webContents.setZoomFactor(scale());
}

function openChat() {
  win.show();
  win.focus();
  win.webContents.send('open-chat');
}

function listen() {
  if (!voice.status().stt) return openChat();
  win.show();
  win.focus();
  win.webContents.send('listen');
}

function setWake(on) {
  brain.setSetting('wakeWord', on);
  if (on) micMuted = false;
  voice.setWakeEnabled(on);
  win.webContents.send('config', config());
}

// Ctrl+Alt+M: apaga el micrófono al instante (y lo vuelve a prender)
function toggleMute() {
  micMuted = !micMuted;
  voice.setWakeEnabled(!micMuted && settings().wakeWord);
  win.webContents.send('config', config());
  win.webContents.send('mood', { mood: micMuted ? 'sleepy' : 'happy', ms: 2500, say: micMuted ? '🔇 Micrófono apagado' : '🎙️ Te escucho de nuevo', alert: false });
}

// El globo aparece encima del panda: la ventana crece hacia arriba y el panda no se mueve.
let chatOpen = false;
function setChatOpen(open) {
  chatOpen = open;
  const b = win.getBounds();
  const height = size().height + (open ? Math.round(CHAT_H * scale()) : 0);
  if (b.height === height) return;
  win.setResizable(true);
  win.setBounds({ x: b.x, y: b.y + b.height - height, width: size().width, height });
  win.setResizable(false);
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    width: 460, height: 640, title: 'Ajustes de MicroPanda', autoHideMenuBar: true, resizable: true,
    icon: path.join(ASSETS, 'panda.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false },
  });
  settingsWin.loadFile(path.join(ASSETS, 'ajustes.html'));
}

function createWindow() {
  win = new BrowserWindow({
    ...size(),
    transparent: true,
    frame: false,
    resizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), spellcheck: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  placeInCorner();
  win.loadFile(path.join(ASSETS, 'index.html'), { query: { desktop: '1' } });
  win.webContents.on('did-finish-load', () => win.webContents.setZoomFactor(scale()));

  // posición del cursor relativa a la ventana: solo se envía si el mouse se movió
  let last = '';
  const timer = setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return;
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const key = `${p.x - b.x},${p.y - b.y}`;
    if (key === last) return;
    last = key;
    const z = scale();
    win.webContents.send('cursor', { x: (p.x - b.x) / z, y: (p.y - b.y) / z });
  }, 50);
  win.on('closed', () => clearInterval(timer));

  const icon = nativeImage.createFromPath(path.join(ASSETS, 'panda.png')).resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip('MicroPanda');
  tray.on('click', () => buildMenu().popup());
  tray.on('right-click', () => tray.popUpContextMenu(buildMenu()));

  brain.start({
    send: (msg) => {
      if (win.isDestroyed()) return;
      if (msg.alert) win.show();   // un recordatorio aparece aunque el panda esté oculto
      win.webContents.send('mood', msg);
    },
    notify: (title, body) => { if (Notification.isSupported()) new Notification({ title, body, icon: path.join(ASSETS, 'panda.png') }).show(); },
    getIdleSeconds: () => powerMonitor.getSystemIdleTime(),
  });
  powerMonitor.on('lock-screen', () => brain.onLock());
  powerMonitor.on('unlock-screen', () => brain.tick());
}

async function handle(promise) {
  const result = await promise;
  brain.onResult(result);
  return result;
}

ipcMain.on('move', (_e, { dx, dy }) => {
  const [x, y] = win.getPosition();
  win.setPosition(Math.round(x + dx), Math.round(y + dy));
});
ipcMain.on('menu', () => buildMenu().popup({ window: win }));
ipcMain.on('chat', (_e, open) => setChatOpen(!!open));
ipcMain.on('poke', () => brain.onPoke());
ipcMain.on('mics', (_e, data) => {
  mics = Array.isArray(data?.list) ? data.list.slice(0, 12) : [];
  if (data?.active) micActive = String(data.active).slice(0, 120);
  if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send('mic-info', { mics, micActive });
});
ipcMain.handle('ask', (_e, text) => handle(commands.ask(String(text).slice(0, 300))));
ipcMain.handle('confirm', (_e, yes) => handle(commands.confirm(!!yes)));
ipcMain.handle('voice-status', () => config());
ipcMain.handle('transcribe', (_e, wav) => voice.transcribe(wav));
ipcMain.handle('wake', (_e, wav) => voice.wake(wav, commands.recognizes));
ipcMain.handle('speak', (_e, text) => (settings().speakReplies ? voice.speak(String(text).slice(0, 600)) : null));
// ventana de ajustes
const EDITABLE = ['wakeName', 'city', 'currency', 'personality', 'sensitivity', 'scale', 'voice', 'device', 'speakReplies', 'followUp', 'beep',
  'wakeWord', 'autoMood', 'chatOnly', 'health', 'openAtLogin', 'precise', 'model', 'voiceSpeed', 'walkAuto', 'icsUrl', 'updateRepo',
  'cloudProvider', 'cloudUrl', 'cloudModel', 'cloudKey', 'micId'];
ipcMain.handle('get-settings', () => {
  const { cloudKeyEnc, ...rest } = settings();   // la clave nunca vuelve a la página
  return { settings: { ...rest, cloudKeySet: !!cloudKeyEnc }, models, mics, micActive, status: voice.status(), version: app.getVersion() };
});
ipcMain.handle('set-setting', (_e, k, v) => {
  if (!EDITABLE.includes(k)) return false;
  if (k === 'cloudKey') {
    if (!safeStorage.isEncryptionAvailable()) return false;
    set('cloudKeyEnc', v ? safeStorage.encryptString(String(v)).toString('base64') : '');
    applyCloud();
    return true;
  }
  if (k === 'voice') voice.setVoice(v);
  if (k === 'device') voice.setDevice(v);
  if (k === 'precise') voice.setPrecise(v);
  if (k === 'wakeWord') return setWake(!!v), true;
  set(k, v);
  return true;
});

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // las páginas del panda nunca abren ventanas ni navegan a otro sitio (los enlaces se abren en tu navegador)
  app.on('web-contents-created', (_e, wc) => {
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('will-navigate', (ev, url) => { if (!url.startsWith('file://')) ev.preventDefault(); });
  });
  app.whenReady().then(() => {
    // solo se concede el micrófono (para escuchar); cualquier otro permiso se niega
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'));
    createWindow();
    globalShortcut.register(SHORTCUT, openChat);
    globalShortcut.register(VOICE_SHORTCUT, listen);
    globalShortcut.register(MUTE_SHORTCUT, toggleMute);
    voice.warmup({ wakeWord: settings().wakeWord && voice.status().stt });
    refreshModels();
    applyCloud();
    // de vez en cuando sale a pasear unos segundos (si lo activas)
    setInterval(() => {
      if (!settings().walkAuto || chatOpen || walker || Math.random() < 0.5 || powerMonitor.getSystemIdleTime() > 300) return;
      walk(true);
      setTimeout(() => walk(false), 6000 + Math.random() * 8000);
    }, 150000);
    // busca versiones nuevas una vez al iniciar (solo si pusiste el repositorio en Ajustes)
    setTimeout(() => checkUpdates(false).catch(() => {}), 30000);
  });
  app.on('second-instance', () => { if (win) { win.show(); placeInCorner(); } });
  app.on('will-quit', () => { globalShortcut.unregisterAll(); voice.stop(); });
  app.on('window-all-closed', () => app.quit());
}
