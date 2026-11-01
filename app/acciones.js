// Acciones extra de MicroPanda (se suman a la lista cerrada de commands.js).
// Cada una: { id, patterns, pc?, confirm?, llm?, run(m, text, target) }
//   pc: true  -> actúa sobre la PC (se bloquea en "modo solo charla" y queda en el registro)
//   llm       -> descripción para que Ollama pueda elegirla; `target` es el dato que Ollama extrajo
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tiempo = require('./tiempo');

module.exports = function acciones(ctx) {
  const { ps, launch, llm } = ctx;
  const el = () => ctx.electron();
  const brain = () => ctx.brain();
  const fold = tiempo._fold;
  // texto original (con tildes y mayúsculas) del grupo `g` de una regex aplicada al texto sin tildes
  const grab = (text, re, g = 1) => {
    const m = new RegExp(re.source, re.flags.includes('d') ? re.flags : re.flags + 'd').exec(fold(text));
    return m && m.indices[g] ? text.slice(...m.indices[g]).trim() : '';
  };
  const tidy = (s) => s.replace(/^[\s,:;]+|[\s,.;:!?¡¿]+$/g, '').replace(/\b(por favor|porfa|porfis|plis)\b/gi, '').trim();
  const sendKey = (code) => ps(`(New-Object -ComObject WScript.Shell).SendKeys([char]${code})`);
  const getJson = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`respondió ${r.status}`);
    return r.json();
  };
  const offline = (what) => ({ reply: `No pude consultar ${what} 📡 ¿Hay internet?`, mood: 'sad' });

  // ---------- energía ----------
  const POWER_WORDS = /\b(apaga|apagar|apagate|reinicia|reiniciar|suspende|suspender|hiberna|hibernar)\b.*\b(pc|computadora|compu|equipo|maquina|laptop|sistema)\b/;
  function powerPlan(text) {
    const q = fold(text);
    const kind = /reinici/.test(q) ? 'restart' : /suspend|hibern/.test(q) ? 'sleep' : 'off';
    const when = tiempo.parseWhen(text);
    const secs = when ? Math.max(10, Math.round((when.date - Date.now()) / 1000)) : 10;
    return { kind, secs, label: { off: 'apago', restart: 'reinicio', sleep: 'suspendo' }[kind], at: when ? tiempo.spokenWhen(when.date) : 'en 10 segundos' };
  }
  let sleepTimer = 0;

  // ---------- ordenar Descargas ----------
  const FOLDERS = {
    Imágenes: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'ico'],
    Documentos: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'ppt', 'pptx', 'txt', 'odt', 'rtf', 'md'],
    Instaladores: ['exe', 'msi', 'msix', 'appx'],
    Comprimidos: ['zip', 'rar', '7z', 'tar', 'gz', 'iso'],
    Videos: ['mp4', 'mkv', 'mov', 'avi', 'webm'],
    Música: ['mp3', 'wav', 'flac', 'm4a', 'ogg'],
  };

  // ---------- cerrar apps (de forma amable: como si apretaras la X) ----------
  const PROC = {
    word: 'WINWORD', excel: 'EXCEL', powerpoint: 'POWERPNT', outlook: 'OUTLOOK', edge: 'msedge', chrome: 'chrome',
    navegador: 'chrome', firefox: 'firefox', spotify: 'Spotify', discord: 'Discord', teams: 'ms-teams', zoom: 'Zoom',
    whatsapp: 'WhatsApp', telegram: 'Telegram', 'bloc de notas': 'notepad', notepad: 'notepad', calculadora: 'CalculatorApp',
    paint: 'mspaint', steam: 'steam', vlc: 'vlc', 'visual studio code': 'Code', 'vs code': 'Code',
  };
  const NEVER_CLOSE = /^(explorer|svchost|system|winlogon|csrss|lsass|services|dwm|electron|micropanda|powershell)$/i;

  // ---------- clima (Open-Meteo, gratis y sin clave) ----------
  const WEATHER = {
    0: 'despejado ☀️', 1: 'casi despejado 🌤️', 2: 'parcialmente nublado ⛅', 3: 'nublado ☁️', 45: 'con neblina 🌫️', 48: 'con neblina 🌫️',
    51: 'con llovizna 🌦️', 53: 'con llovizna 🌦️', 55: 'con llovizna 🌦️', 61: 'con lluvia 🌧️', 63: 'con lluvia 🌧️', 65: 'con lluvia fuerte 🌧️',
    71: 'con nieve ❄️', 73: 'con nieve ❄️', 75: 'con nieve ❄️', 80: 'con chubascos 🌦️', 81: 'con chubascos 🌧️', 82: 'con chubascos fuertes ⛈️',
    95: 'con tormenta ⛈️', 96: 'con tormenta ⛈️', 99: 'con tormenta ⛈️',
  };
  const CURRENCIES = {
    PEN: ['soles', /\bsol(es)?\b|peru/], MXN: ['pesos mexicanos', /mexic/], COP: ['pesos colombianos', /colombi/], ARS: ['pesos argentinos', /argentin/],
    CLP: ['pesos chilenos', /chilen/], BOB: ['bolivianos', /bolivian/], UYU: ['pesos uruguayos', /uruguay/], PYG: ['guaraníes', /guarani|paragua/],
    GTQ: ['quetzales', /quetzal|guatemal/], DOP: ['pesos dominicanos', /dominican/], EUR: ['euros', /\beuros?\b/], USD: ['dólares', /\bdolar(es)?\b/],
  };

  const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const notesFile = () => path.join(el().app.getPath('documents'), 'MicroPanda', 'notas.md');
  const runSteps = (steps) => ctx.runSteps(steps);

  return [
    // ===== energía =====
    {
      id: 'power-cancel', pc: true, llm: 'cancelar un apagado o reinicio programado',
      patterns: [/\b(cancela|cancelar|anula|ya no)\b.*\b(apagado|apagar|reinicio|reiniciar|suspender)\b/],
      run: async () => {
        clearTimeout(sleepTimer);
        await ps('shutdown /a 2>$null; $true').catch(() => {});
        return { reply: 'Listo, cancelé el apagado 👍', mood: 'happy' };
      },
    },
    {
      id: 'power', pc: true, llm: 'apagar, reiniciar o suspender la PC, ahora o en un tiempo ("en 1 hora")',
      patterns: [POWER_WORDS, /\b(apagate|apaga todo|a dormir la pc|suspende)\b/],
      confirm: (_m, text) => { const p = powerPlan(text); return `¿${p.label[0].toUpperCase() + p.label.slice(1)} la PC ${p.at}? Guarda tu trabajo primero.`; },
      run: async (_m, text) => {
        const p = powerPlan(text);
        if (p.kind === 'sleep') {
          clearTimeout(sleepTimer);
          sleepTimer = setTimeout(() => launch('rundll32.exe', ['powrprof.dll,SetSuspendState', '0,1,0']), p.secs * 1000);
        } else {
          await ps(`shutdown ${p.kind === 'restart' ? '/r' : '/s'} /t ${p.secs}`);
        }
        return { reply: `Ok, ${p.label} la PC ${p.at}. Para cancelar dime "cancela el apagado" 🌙`, mood: 'sleepy' };
      },
    },

    // ===== pantalla =====
    {
      id: 'brightness', pc: true, llm: 'subir, bajar o fijar el brillo de la pantalla (target = número)',
      patterns: [/\b(brillo)\b/, /\b(pantalla)\b.*\b(mas clara|mas oscura|muy oscura|muy clara)\b/],
      run: async (_m, text, target) => {
        const q = fold(text);
        const n = Number((target || '').match(/\d+/)?.[0] ?? q.match(/(\d{1,3})\s*(%|por ?ciento)?/)?.[1]);
        const delta = /\b(sube|subele|aumenta|mas|mas clara|muy oscura)\b/.test(q) ? 20 : /\b(baja|bajale|reduce|menos|mas oscura|muy clara)\b/.test(q) ? -20 : 0;
        try {
          const now = Number(await ps('(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness'));
          const to = Math.max(5, Math.min(100, Number.isFinite(n) && !delta ? n : now + (delta || 20)));
          await ps(`Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{Timeout=1;Brightness=${to}} | Out-Null`);
          return { reply: `Brillo al ${to}% 🔆`, mood: 'happy' };
        } catch {
          return { reply: 'Tu monitor no deja cambiar el brillo desde Windows (funciona en laptops) 😅', mood: 'sad' };
        }
      },
    },
    {
      id: 'theme', pc: true, llm: 'cambiar Windows a modo oscuro o claro',
      patterns: [/\b(modo|tema)\s+(oscuro|claro|noche|nocturno|dia|diurno)\b/],
      run: async (_m, text) => {
        const light = /\b(claro|dia|diurno)\b/.test(fold(text)) ? 1 : 0;
        const key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
        await ps(`Set-ItemProperty '${key}' AppsUseLightTheme ${light}; Set-ItemProperty '${key}' SystemUsesLightTheme ${light}`);
        return { reply: light ? 'Modo claro activado ☀️' : 'Modo oscuro activado 🌙', mood: 'happy' };
      },
    },
    {
      id: 'dnd', pc: true, llm: 'activar "no molestar" (silenciar notificaciones)',
      patterns: [/\b(no molestar|no me molesten|silencia las notificaciones|quita las notificaciones)\b/],
      run: async () => {
        await el().shell.openExternal('ms-settings:notifications');
        return { reply: 'Te abrí las notificaciones: activa "No molestar" arriba 🔕 (Windows no deja que otra app lo cambie)', mood: 'focused' };
      },
    },

    // ===== música =====
    {
      id: 'media-next', pc: true, llm: 'pasar a la siguiente canción o video',
      patterns: [/\b(siguiente|proxima|otra|salta|saltate|cambia)\b.*\b(cancion|tema|video|rola)\b/, /^(siguiente|la que sigue)$/],
      run: async () => { await sendKey(176); return { reply: 'Siguiente ⏭️', mood: 'happy' }; },
    },
    {
      id: 'media-prev', pc: true, llm: 'volver a la canción anterior',
      patterns: [/\b(anterior|la de antes|regresa|vuelve)\b.*\b(cancion|tema|video|rola)\b/],
      run: async () => { await sendKey(177); return { reply: 'Anterior ⏮️', mood: 'happy' }; },
    },
    {
      id: 'media-play', pc: true, llm: 'pausar o reanudar la música o el video',
      patterns: [/\b(pausa|pausar|pausala|deten|reanuda|reanudar|continua|reproduce|play|dale play|quita la pausa)\b.*\b(musica|cancion|video|reproduccion|spotify|tema|rola)\b/, /^(pausa|play|dale play|reanuda|pausala)$/],
      run: async () => { await sendKey(179); return { reply: 'Listo ⏯️', mood: 'happy' }; },
    },

    // ===== buscar =====
    {
      id: 'search-youtube', pc: true, llm: 'buscar o poner algo en YouTube (target = qué buscar)',
      patterns: [/\b(busca|buscar|pon|ponme|reproduce)\b\s+(.+?)\s+en youtube\b/, /\byoutube\b.*\b(busca|buscar)\b\s+(.+)/],
      run: async (_m, text, target) => {
        const what = target || grab(text, /\b(?:busca|buscar|pon|ponme|reproduce)\s+(.+?)\s+en youtube\b/) || grab(text, /\b(?:busca|buscar)\s+(.+)$/);
        await el().shell.openExternal(`https://www.youtube.com/results?search_query=${encodeURIComponent(tidy(what))}`);
        return { reply: `Buscando "${tidy(what)}" en YouTube ▶️`, mood: 'happy' };
      },
    },
    {
      id: 'search-web', pc: true, llm: 'buscar algo en internet / Google (target = qué buscar)',
      patterns: [/\b(busca|buscar|buscame)\s+en\s+(google|internet|la web)\b/, /\b(googlea|googlear)\b/],
      run: async (_m, text, target) => {
        const what = tidy(target || grab(text, /\b(?:en (?:google|internet|la web)|googlea|googlear)\s+(.+)$/));
        if (!what) return { reply: '¿Qué busco? 🔎', mood: 'thinking' };
        await el().shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(what)}`);
        return { reply: `Buscando "${what}" en Google 🔎`, mood: 'happy' };
      },
    },
    {
      id: 'search-files', pc: true, llm: 'buscar un archivo o carpeta en la PC (target = nombre)',
      patterns: [/\b(busca|buscar|buscame|encuentra|encuentrame|donde esta)\b.*\b(archivo|archivos|documento|documentos|carpeta|excel|word|pdf|foto|fotos|presentacion)\b/],
      run: async (_m, text, target) => {
        let what = tidy(target || grab(text, /\b(?:archivos?|documentos?|carpeta|excel|word|pdf|fotos?|presentacion)\b\s*(?:de |del |de la |que se llama |llamad[oa] |sobre )?(.*)$/));
        if (!what) what = fold(text).match(/\b(excel|word|pdf|foto|fotos)\b/)?.[1] || '';
        if (!what) return { reply: '¿Cómo se llama el archivo? 🔎', mood: 'thinking' };
        await el().shell.openExternal(`search-ms:query=${encodeURIComponent(what)}&crumb=location:${encodeURIComponent(os.homedir())}`);
        return { reply: `Buscando "${what}" en tus archivos 📂`, mood: 'focused' };
      },
    },

    // ===== Descargas =====
    {
      id: 'organize', pc: true, llm: 'ordenar la carpeta Descargas en subcarpetas por tipo de archivo',
      patterns: [/\b(ordena|ordenar|organiza|organizar|acomoda|acomodar|limpia|arregla)\b.*\b(descargas)\b/],
      confirm: '¿Ordeno tus Descargas en carpetas por tipo (Imágenes, Documentos, Instaladores…)? No borro nada, solo muevo.',
      run: async () => {
        const dl = el().app.getPath('downloads');
        const map = Object.entries(FOLDERS).flatMap(([dir, exts]) => exts.map((e) => `'${e}'='${dir}'`)).join(';');
        const moved = await ps(
          `$map=@{${map}}; $n=0; Get-ChildItem -LiteralPath '${dl.replace(/'/g, "''")}' -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddMinutes(-10) } | ForEach-Object { `
          + '$d = $map[$_.Extension.TrimStart(".").ToLower()]; if ($d) { $to = Join-Path $_.DirectoryName $d; New-Item -ItemType Directory -Force $to | Out-Null; '
          + '$dest = Join-Path $to $_.Name; if (-not (Test-Path -LiteralPath $dest)) { try { Move-Item -LiteralPath $_.FullName $dest -ErrorAction Stop; $n++ } catch {} } } }; $n');
        await el().shell.openPath(dl);
        return { reply: `¡Listo! Ordené ${Number(moved) || 0} archivos de Descargas en carpetas 🗂️`, mood: 'happy' };
      },
    },

    // ===== cerrar apps =====
    {
      id: 'close-app', pc: true, llm: 'cerrar una aplicación abierta (target = nombre de la app)',
      patterns: [/\b(cierra|cerrar|cierrame|mata|termina)\b\s+(?:el |la |los |las |mi |a )?(?!sesion|el globo|la ventana del panda|.*\b(?:pomodoro|concentracion|enfoque|rutina)\b)(.+)/],
      confirm: (_m, text, target) => `¿Cierro ${tidy(target || grab(text, /\b(?:cierra|cerrar|cierrame|mata|termina)\s+(?:el |la |los |las |mi |a )?(.+)$/))}? Si tiene algo sin guardar te lo preguntará.`,
      run: async (_m, text, target) => {
        const name = fold(tidy(target || grab(text, /\b(?:cierra|cerrar|cierrame|mata|termina)\s+(?:el |la |los |las |mi |a )?(.+)$/))).trim();
        const proc = PROC[name] || name.replace(/[^a-z0-9 ._-]/g, '').trim();
        if (!proc || proc.length < 2 || NEVER_CLOSE.test(proc)) return { reply: `Mejor no cierro "${name}" 🙅`, mood: 'thinking' };
        const out = await ps(`$p = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.ProcessName -notmatch '${NEVER_CLOSE.source}' -and ($_.ProcessName -like '*${proc}*' -or $_.MainWindowTitle -like '*${proc}*') }; `
          + '$p | ForEach-Object { [void]$_.CloseMainWindow() }; ($p | Select-Object -ExpandProperty ProcessName -Unique) -join ", "');
        return out ? { reply: `Cerré ${out} 👋`, mood: 'happy' } : { reply: `No encontré "${name}" abierto 🤔`, mood: 'thinking' };
      },
    },

    // ===== internet: clima y dólar =====
    {
      id: 'city', llm: 'el usuario dice en qué ciudad vive (target = ciudad)',
      patterns: [/\b(mi ciudad es|vivo en|soy de)\s+([a-zñ ]{3,40})$/],
      run: async (_m, text, target) => {
        const city = tidy(target || grab(text, /\b(?:mi ciudad es|vivo en|soy de)\s+(.+)$/));
        brain().setSetting('city', city);
        return { reply: `¡Anotado! Vives en ${city} 🏙️. Ya puedes preguntarme el clima.`, mood: 'happy' };
      },
    },
    {
      id: 'weather', llm: 'decir el clima o pronóstico (target = ciudad si la dicen); necesita internet',
      patterns: [/\b(clima|que tiempo hace|como esta el tiempo|temperatura|llover|lluvia|llueve|hace frio|hace calor|pronostico|va a hacer)\b/],
      run: async (_m, text, target) => {
        const q = fold(text);
        const said = target || grab(text, /\ben\s+([a-zñ ]{3,40}?)(?:\s+(?:hoy|manana|pasado manana|esta semana))?\s*$/);
        const city = tidy(said && !/^(la |el )?(manana|tarde|noche|semana)$/.test(fold(said)) ? said : brain().settings.city || '');
        if (!city) return { reply: '¿De qué ciudad? Dime, por ejemplo: "mi ciudad es Lima" 🏙️', mood: 'thinking' };
        const day = /\bpasado manana\b/.test(q) ? 2 : /(?<!la\s)\bmanana\b/.test(q) ? 1 : 0;
        try {
          const geo = await getJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=es`);
          const g = geo.results?.[0];
          if (!g) return { reply: `No encontré la ciudad "${city}" 🗺️`, mood: 'sad' };
          const w = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${g.latitude}&longitude=${g.longitude}&current=temperature_2m,weather_code`
            + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&timezone=auto&forecast_days=3');
          const d = w.daily;
          const rain = d.precipitation_probability_max[day];
          const when = ['Hoy', 'Mañana', 'Pasado mañana'][day];
          const now = day === 0 ? `ahora ${Math.round(w.current.temperature_2m)}°, ` : '';
          return {
            reply: `${when} en ${g.name}: ${now}${WEATHER[d.weather_code[day]] || ''}, entre ${Math.round(d.temperature_2m_min[day])}° y ${Math.round(d.temperature_2m_max[day])}°`
              + `${rain != null ? `, ${rain}% de probabilidad de lluvia${rain >= 50 ? ' ☔ lleva paraguas' : ''}` : ''}.`,
            mood: rain >= 50 ? 'sad' : 'happy',
          };
        } catch { return offline('el clima'); }
      },
    },
    {
      id: 'currency-set', llm: 'el usuario dice cuál es su moneda',
      patterns: [/\bmi moneda (es|son)\b/],
      run: async (_m, text) => {
        const q = fold(text);
        const code = Object.keys(CURRENCIES).find((c) => CURRENCIES[c][1].test(q) || q.includes(c.toLowerCase()));
        if (!code) return { reply: 'No conozco esa moneda 😅 Prueba: soles, pesos mexicanos, pesos colombianos…', mood: 'thinking' };
        brain().setSetting('currency', code);
        return { reply: `Listo, uso ${CURRENCIES[code][0]} 💱`, mood: 'happy' };
      },
    },
    {
      id: 'currency', llm: 'decir el tipo de cambio del dólar o del euro; necesita internet',
      patterns: [/\b(dolar|dolares|tipo de cambio|euro|euros)\b.*\b(cuanto|esta|precio|vale|cambio|hoy)\b|\b(cuanto|como)\s+(esta|vale)\s+el\s+(dolar|euro)\b|\btipo de cambio\b/],
      run: async (_m, text) => {
        const from = /\beuros?\b/.test(fold(text)) ? 'EUR' : 'USD';
        const to = brain().settings.currency || 'PEN';
        try {
          const r = await getJson(`https://open.er-api.com/v6/latest/${from}`);
          const rate = r.rates?.[to];
          if (!rate) throw new Error('sin dato');
          return { reply: `1 ${from === 'EUR' ? 'euro' : 'dólar'} = ${rate.toFixed(rate < 10 ? 3 : 2)} ${CURRENCIES[to]?.[0] || to} 💵 (referencial)`, mood: 'focused' };
        } catch { return offline('el tipo de cambio'); }
      },
    },

    // ===== lo que copiaste (Ctrl+C) =====
    {
      id: 'clipboard', llm: 'resumir, traducir, explicar o corregir el texto que el usuario copió',
      patterns: [/\b(resume|resumir|resumeme|resumen|traduce|traducir|traduceme|traducelo|explica|explicame|explicalo|corrige|corrigeme|mejora|mejorame)\b.*\b(copie|copiado|copiaste|portapapeles|esto|eso|lo que copie|este texto)\b/],
      run: async (_m, text) => {
        const clip = el().clipboard.readText().trim();
        if (!clip) return { reply: 'Primero copia un texto (Ctrl+C) y luego me lo pides 📋', mood: 'thinking' };
        const q = fold(text);
        const lang = q.match(/\bal\s+(ingles|espanol|portugues|frances|italiano|aleman|japones|chino)\b/)?.[1];
        const task = /tradu/.test(q) ? `Traduce este texto al ${lang ? lang.replace('espanol', 'español').replace('ingles', 'inglés').replace('frances', 'francés').replace('aleman', 'alemán').replace('japones', 'japonés').replace('portugues', 'portugués') : 'inglés (o al español si ya está en inglés)'}. Devuelve solo la traducción.`
          : /expli/.test(q) ? 'Explica este texto de forma sencilla, como a un amigo.'
            : /corrig|mejor/.test(q) ? 'Corrige la ortografía y mejora la redacción de este texto. Devuelve solo el texto corregido.'
              : 'Resume este texto en 2 o 3 oraciones.';
        try {
          const out = await llm.generate(task, clip, { personality: brain().settings.personality });
          if (/tradu|corrig|mejor/.test(q)) el().clipboard.writeText(out);
          return { reply: out.slice(0, 600) + (/tradu|corrig|mejor/.test(q) ? ' 📋 (ya está copiado)' : ''), mood: 'focused' };
        } catch { return { reply: 'Necesito Ollama para eso y no está disponible 😢', mood: 'sad' }; }
      },
    },

    // ===== tareas =====
    {
      id: 'todo-list', llm: 'decir qué tareas pendientes tiene en su lista',
      patterns: [/\b(que tengo pendiente|mis pendientes|mis tareas|mi lista de tareas|que tareas tengo|lista de pendientes|que me falta hacer)\b/],
      run: async () => {
        const t = brain().todos();
        if (!t.length) return { reply: 'No tienes tareas pendientes 🎉', mood: 'happy' };
        return { reply: `Tienes ${t.length}: ${t.slice(0, 6).map((x, i) => `${i + 1}) ${x.text}`).join(' · ')} 📝`, mood: 'focused' };
      },
    },
    {
      id: 'todo-clear', llm: 'borrar toda la lista de tareas',
      patterns: [/\b(borra|borrar|limpia|vacia)\b.*\b(lista de tareas|mis tareas|mis pendientes|la lista)\b/],
      confirm: '¿Borro toda tu lista de tareas?',
      run: async () => { const n = brain().clearTodos(); return { reply: `Listo, borré ${n} tarea${n === 1 ? '' : 's'} 🧹`, mood: 'happy' }; },
    },
    {
      id: 'todo-done', llm: 'marcar una tarea como hecha (target = la tarea)',
      patterns: [/\b(ya hice|ya termine|termine|completa|completar|marca como hecha|tacha|tachala|borra la tarea|quita la tarea)\b\s+(?:la tarea\s+|de\s+)?(.+)/],
      run: async (_m, text, target) => {
        const what = tidy(target || grab(text, /\b(?:ya hice|ya termine|termine|completa|completar|marca como hecha|tacha|tachala|borra la tarea|quita la tarea)\s+(?:la tarea\s+|de\s+)?(.+)$/));
        const t = brain().doneTodo(what);
        return t ? { reply: `¡Bien hecho! ✅ Taché "${t.text}"`, mood: 'love' } : { reply: `No encontré "${what}" en tu lista 🤔`, mood: 'thinking' };
      },
    },
    {
      id: 'todo-add', llm: 'agregar una tarea a la lista de pendientes (target = la tarea)',
      patterns: [/\b(agrega|agregar|anade|apunta|pon|anota|mete)\b\s+(.+?)\s+(?:a|en)\s+(?:mi |la )?(?:lista|lista de tareas|pendientes|tareas)\b/, /\b(nueva tarea|agrega la tarea|anota la tarea|tengo que)\s*:?\s+(.+)/],
      run: async (_m, text, target) => {
        const what = tidy(target || grab(text, /\b(?:agrega|agregar|anade|apunta|pon|anota|mete)\s+(.+?)\s+(?:a|en)\s+(?:mi |la )?(?:lista|lista de tareas|pendientes|tareas)\b/)
          || grab(text, /\b(?:nueva tarea|agrega la tarea|anota la tarea|tengo que)\s*:?\s+(.+)$/));
        if (!what) return { reply: '¿Qué tarea agrego? 📝', mood: 'thinking' };
        brain().addTodo(what);
        return { reply: `Agregado a tu lista: ${what} 📝 (tienes ${brain().todos().length})`, mood: 'happy' };
      },
    },

    // ===== notas =====
    {
      id: 'notes-open', pc: true, llm: 'abrir o leer las notas guardadas',
      patterns: [/\b(abre|abreme|muestrame|lee|leeme|ver)\b.*\b(mis notas|las notas|mis apuntes)\b/],
      run: async () => {
        const f = notesFile();
        if (!fs.existsSync(f)) return { reply: 'Aún no tienes notas. Dime "toma nota: …" 🗒️', mood: 'thinking' };
        await el().shell.openPath(f);
        return { reply: 'Abriendo tus notas 🗒️', mood: 'happy' };
      },
    },
    {
      id: 'note', llm: 'guardar una nota rápida (target = el texto de la nota)',
      patterns: [/\b(toma nota|toma una nota|anota|apunta|guarda una nota|nota rapida)\b\s*(?:que|de que|:)?\s*(.+)/],
      run: async (_m, text, target) => {
        const what = tidy(target || grab(text, /\b(?:toma nota|toma una nota|anota|apunta|guarda una nota|nota rapida)\s*(?:que |de que |:)?\s*(.+)$/));
        if (!what) return { reply: '¿Qué anoto? 🗒️', mood: 'thinking' };
        const f = notesFile();
        fs.mkdirSync(path.dirname(f), { recursive: true });
        const stamp = new Date().toLocaleString('es-419', { dateStyle: 'medium', timeStyle: 'short' });
        fs.appendFileSync(f, `${fs.existsSync(f) ? '' : '# Notas de MicroPanda\n\n'}- **${stamp}** — ${what}\n`);
        return { reply: `Anotado 🗒️ (está en Documentos › MicroPanda › notas.md)`, mood: 'happy' };
      },
    },

    // ===== concentración y salud =====
    {
      id: 'focus-stop', llm: 'detener el pomodoro o modo concentración',
      patterns: [/\b(deten|detener|para|parar|cancela|termina|quita)\b.*\b(pomodoro|concentracion|enfoque)\b/],
      run: async () => ({ reply: brain().stopFocus() ? 'Pomodoro detenido 🍅' : 'No había un pomodoro activo 🤔', mood: 'idle' }),
    },
    {
      id: 'focus', llm: 'empezar un pomodoro / modo concentración (target = minutos)',
      patterns: [/\b(pomodoro|modo concentracion|modo enfoque|quiero concentrarme|a concentrarme|necesito concentrarme)\b/],
      run: async (_m, text, target) => {
        const q = fold(text);
        if (/\bcuanto (falta|queda)\b/.test(q)) {
          const left = brain().focusLeft();
          return { reply: left == null ? 'No hay un pomodoro activo' : `Te quedan ${left} minutos 🍅`, mood: 'focused' };
        }
        const min = Number(target?.match(/\d+/)?.[0] || q.match(/(\d{1,3})\s*min/)?.[1] || 25);
        brain().startFocus(Math.max(1, Math.min(180, min)));
        return { reply: `🍅 ¡A concentrarse! ${min} minutos. Te aviso cuando toque descansar.`, mood: 'focused' };
      },
    },
    {
      id: 'health', llm: 'activar o desactivar los recordatorios de pausas activas y tomar agua',
      patterns: [/\b(pausas activas|recordatorios de agua|modo salud|recuerdame tomar agua y estirarme)\b/],
      run: async (_m, text) => {
        const on = !/\b(desactiva|apaga|quita|ya no|deten)\b/.test(fold(text));
        brain().setSetting('health', on);
        return { reply: on ? 'Pausas activas encendidas 🧘 Te aviso cada hora para estirarte y cada hora y media para tomar agua.' : 'Pausas activas apagadas', mood: on ? 'happy' : 'idle' };
      },
    },

    // ===== rutinas =====
    {
      id: 'routine-create', llm: 'crear una rutina con varios pasos ("crea la rutina trabajo: abre el navegador y baja el volumen")',
      patterns: [/\b(crea|crear|guarda|nueva|agrega)\s+(?:la |una )?rutina\s+(?:de |del |llamada )?([a-zñ ]+?)\s*(?::|que|con|para)\s*(.+)/],
      run: async (_m, text) => {
        const m = /\brutina\s+(?:de |del |llamada )?([a-zñ ]+?)\s*(?::|que|con|para)\s*(.+)$/.exec(fold(text));
        const name = m[1].trim();
        const steps = text.slice(text.length - m[2].length).split(/\s*(?:,|;|\by luego\b|\by despues\b|\by\b)\s*/i).map(tidy).filter(Boolean);
        brain().setSetting('routines', { ...brain().settings.routines, [name]: steps });
        return { reply: `Rutina "${name}" guardada con ${steps.length} pasos: ${steps.join(' → ')}. Dime "activa el modo ${name}" ✨`, mood: 'happy' };
      },
    },
    {
      id: 'routine-list', llm: 'decir qué rutinas tiene guardadas',
      patterns: [/\b(mis rutinas|que rutinas)\b/],
      run: async () => {
        const r = Object.entries(brain().settings.routines || {});
        if (!r.length) return { reply: 'No tienes rutinas. Crea una: "crea la rutina trabajo: abre el navegador y baja el volumen" ✨', mood: 'thinking' };
        return { reply: r.map(([k, v]) => `${k}: ${v.join(' → ')}`).join(' · '), mood: 'focused' };
      },
    },
    {
      id: 'routine', pc: true, llm: 'ejecutar una rutina guardada (target = nombre de la rutina)',
      patterns: [/\b(activa|inicia|ejecuta|corre|empieza|pon)\s+(?:el |la |mi )?(?:modo|rutina)\s+(?!oscuro|claro|noche|dia|concentracion|enfoque|salud|solo charla)([a-zñ ]+)/],
      run: async (_m, text, target) => {
        const name = fold(tidy(target || grab(text, /\b(?:modo|rutina)\s+([a-zñ ]+)$/)));
        const routines = brain().settings.routines || {};
        const key = Object.keys(routines).find((k) => k === name || name.includes(k));
        if (!key) return { reply: `No tengo la rutina "${name}". Créala: "crea la rutina ${name}: abre el navegador y baja el volumen" ✨`, mood: 'thinking' };
        return runSteps(routines[key]);
      },
    },

    // ===== su nombre, personalidad y modo solo charla =====
    {
      id: 'rename', llm: 'cambiar el nombre/palabra con la que se activa MicroPanda (target = nuevo nombre)',
      patterns: [/\b(cambia(?:te)? (?:tu|el) nombre a|ahora te llamas|ahora te llamaras|te voy a llamar|tu nombre sera|llamate)\s+([a-zñ]{3,15})\b/],
      run: async (_m, text, target) => {
        const said = tidy(target || grab(text, /\b(?:a|llamas|llamaras|llamar|sera|llamate)\s+([a-zñ]{3,15})\s*$/)).split(' ')[0];
        const name = fold(said).trim();
        if (!name || name.length < 3) return { reply: '¿Cómo quieres llamarme? 🐼', mood: 'thinking' };
        ctx.setSetting('wakeName', name);
        return { reply: `¡Me encanta! Ahora respondo cuando dices "${said[0].toUpperCase() + said.slice(1)}" 🐼 (y también "Panda")`, mood: 'love' };
      },
    },
    {
      id: 'personality', llm: 'cambiar la personalidad de MicroPanda (tierno, gracioso, profesional, serio)',
      patterns: [/\b(se|ponte|vuelvete|modo|personalidad|habla)\s+(?:mas\s+|en modo\s+|como\s+)?(tierno|carinoso|gracioso|chistoso|divertido|profesional|formal|serio)\b/],
      run: async (_m, text) => {
        const w = fold(text).match(/\b(tierno|carinoso|gracioso|chistoso|divertido|profesional|formal|serio)\b/)[1];
        const p = { carinoso: 'tierno', chistoso: 'gracioso', divertido: 'gracioso', formal: 'profesional' }[w] || w;
        brain().setSetting('personality', p);
        const reply = { tierno: '¡Aww, seré todo tierno contigo! 🥰', gracioso: '¡Prepárate para mis chistes malos! 😜', profesional: 'Entendido. Modo profesional activado.', serio: 'Ok.' }[p];
        return { reply, mood: p === 'serio' || p === 'profesional' ? 'focused' : 'happy' };
      },
    },
    {
      id: 'chat-only', llm: 'activar o desactivar el modo solo charla (no hace acciones en la PC)',
      patterns: [/\b(modo )?solo charla\b/],
      run: async (_m, text) => {
        const on = !/\b(desactiva|quita|sal|salir|apaga|ya no)\b/.test(fold(text));
        ctx.setSetting('chatOnly', on);
        return { reply: on ? 'Modo solo charla 💬: no haré nada en tu PC hasta que me digas "desactiva solo charla".' : 'Listo, vuelvo a ayudarte con tu PC 💻', mood: 'happy' };
      },
    },

    // ===== lo que le cuentas de ti =====
    {
      id: 'forget', llm: 'olvidar todo lo que el usuario le contó de sí mismo',
      patterns: [/\b(olvida|borra|olvidate de)\b.*\b(lo que sabes de mi|todo lo que te dije|mis datos|lo que te conte)\b/],
      confirm: '¿Olvido todo lo que me contaste de ti?',
      run: async () => { const n = brain().forgetFacts(); return { reply: `Listo, olvidé ${n} cosa${n === 1 ? '' : 's'} 🫥`, mood: 'sad' }; },
    },
    {
      id: 'fact', llm: 'el usuario le pide que recuerde un dato sobre él (target = el dato)',
      patterns: [/\b(recuerda|acuerdate|no olvides|ten en cuenta|para que sepas)\s+(?:de\s+)?que\s+(.+)/, /\bmi cumpleanos es\b/],
      run: async (_m, text, target) => {
        const what = tidy(target || grab(text, /\b(?:recuerda|acuerdate|no olvides|ten en cuenta|para que sepas)\s+(?:de\s+)?que\s+(.+)$/) || text);
        brain().addFact(what);
        const b = fold(what).match(/cumpleanos es (?:el )?(\d{1,2}) de ([a-z]+)/);
        if (b && MONTHS.includes(b[2])) brain().setSetting('birthday', `${String(MONTHS.indexOf(b[2]) + 1).padStart(2, '0')}-${b[1].padStart(2, '0')}`);
        return { reply: `¡No lo olvidaré! 💚 ${b ? 'Ese día me pondré gorrito de fiesta 🎉' : ''}`.trim(), mood: 'love' };
      },
    },

    // ===== registro =====
    {
      id: 'log', llm: 'mostrar el registro de acciones que hizo en la PC',
      patterns: [/\b(registro de acciones|historial de acciones|que hiciste|que has hecho en mi pc)\b/],
      run: async () => {
        const f = ctx.logFile;
        if (!fs.existsSync(f)) return { reply: 'Aún no he hecho nada en tu PC 🐼', mood: 'idle' };
        await el().shell.openPath(f);
        return { reply: 'Te abrí el registro de lo que hice 📜', mood: 'focused' };
      },
    },
  ];
};
