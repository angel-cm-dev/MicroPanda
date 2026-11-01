// Acciones de la fase 2: leer la pantalla, preguntar a tus documentos, agenda, noticias, Wikipedia,
// caminar por la barra de tareas, saludar, velocidad de la voz y actualizaciones.
// Mismo formato que acciones.js: { id, patterns, pc?, confirm?, llm?, run(m, text, target) }
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFile } = require('node:child_process');
const tiempo = require('./tiempo');

const STOP = new Set(('a al algo como con de del el ella en es esa ese eso esta este esto ha hay la las le lo los me mi mis muy no o para '
  + 'pero por que se si sin su sus te tu un una uno y ya yo cual cuales cuando donde quien que dice dicen sobre mis documentos archivos').split(' '));
const fold = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const words = (s) => fold(s).match(/[a-zñ0-9]{3,}/g)?.filter((w) => !STOP.has(w)) || [];

// ---------- leer .docx sin librerías: un .docx es un zip con word/document.xml ----------
function unzipEntry(buf, name) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) return null;
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = buf.readUInt16LE(eocd + 10); i > 0; i--) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const n = buf.readUInt16LE(p + 28), e = buf.readUInt16LE(p + 30), c = buf.readUInt16LE(p + 32), local = buf.readUInt32LE(p + 42);
    if (buf.toString('utf8', p + 46, p + 46 + n) === name) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 0 ? data : zlib.inflateRawSync(data);
    }
    p += 46 + n + e + c;
  }
  return null;
}
const xmlText = (xml) => xml.replace(/<\/w:p>|<\/a:p>|<w:br\/>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

module.exports = function masAcciones(ctx) {
  const el = () => ctx.electron();
  const brain = () => ctx.brain();
  const { llm, voiceDir } = ctx;
  const tidy = (s) => (s || '').replace(/^[\s,:;]+|[\s,.;:!?¡¿]+$/g, '').trim();
  const getText = async (url) => {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'MicroPanda/0.3 (open source desktop pet)' } });
    if (!r.ok) throw new Error(`respondió ${r.status}`);
    return r.text();
  };
  const personality = () => ({ personality: brain().settings.personality });

  // ---------- leer la pantalla ----------
  function ocr(png) {
    const file = path.join(os.tmpdir(), `micropanda-ocr-${Date.now()}.png`);
    fs.writeFileSync(file, png);
    const script = path.join(__dirname, 'ocr.ps1').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
    return new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, file], { windowsHide: true, timeout: 60000, encoding: 'utf8' },
        (err, out, errOut) => { fs.rm(file, { force: true }, () => {}); err ? reject(new Error(errOut || err.message)) : resolve(out.trim()); });
    });
  }

  // ---------- tus documentos (Documentos › MicroPanda › Biblioteca) ----------
  const library = () => path.join(el().app.getPath('documents'), 'MicroPanda', 'Biblioteca');
  let index = { key: '', chunks: [] };

  function pdfText(file) {
    // pypdf (BSD) en el Python de la voz; si no está, el PDF se salta
    const py = path.join(voiceDir, 'py', 'Scripts', 'python.exe');
    if (!fs.existsSync(py)) return Promise.resolve('');
    const code = 'import sys\nfrom pypdf import PdfReader\nr=PdfReader(sys.argv[1])\nprint("\\n".join((p.extract_text() or "") for p in r.pages[:200]))';
    return new Promise((resolve) => execFile(py, ['-I', '-c', code, file], { windowsHide: true, timeout: 60000, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } },
      (err, out) => resolve(err ? '' : out)));
  }

  async function readDoc(file) {
    const ext = path.extname(file).toLowerCase();
    if (['.txt', '.md', '.csv', '.json', '.html', '.htm'].includes(ext)) return fs.readFileSync(file, 'utf8').replace(/<[^>]+>/g, ' ');
    if (ext === '.docx') return xmlText(unzipEntry(fs.readFileSync(file), 'word/document.xml')?.toString('utf8') || '');
    if (ext === '.pptx') {
      const buf = fs.readFileSync(file);
      let out = '';
      for (let i = 1; i < 200; i++) { const s = unzipEntry(buf, `ppt/slides/slide${i}.xml`); if (!s) break; out += xmlText(s.toString('utf8')) + '\n'; }
      return out;
    }
    if (ext === '.pdf') return pdfText(file);
    return '';
  }

  async function buildIndex() {
    const dir = library();
    fs.mkdirSync(dir, { recursive: true });
    const files = [];
    const walk = (d, depth) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory() && depth < 4) walk(p, depth + 1);
        else if (/\.(txt|md|csv|json|html?|docx|pptx|pdf)$/i.test(e.name)) files.push(p);
      }
    };
    walk(dir, 0);
    const key = files.map((f) => `${f}:${fs.statSync(f).mtimeMs}`).join('|');
    if (key === index.key) return index;
    const chunks = [];
    for (const f of files.slice(0, 300)) {
      let text = '';
      try { text = await readDoc(f); } catch {}
      // trozos de ~800 letras cortados en párrafos
      let buf = '';
      for (const para of text.split(/\n\s*\n|\n/)) {
        buf += para.trim() + '\n';
        if (buf.length > 800) { chunks.push({ file: path.basename(f), text: buf.trim() }); buf = ''; }
      }
      if (buf.trim()) chunks.push({ file: path.basename(f), text: buf.trim() });
    }
    for (const c of chunks) c.words = words(c.text);
    const df = {};
    for (const c of chunks) for (const w of new Set(c.words)) df[w] = (df[w] || 0) + 1;
    index = { key, chunks, df, files: files.length };
    return index;
  }

  // BM25 sencillo: los trozos que más comparten palabras raras con la pregunta
  function search(question, k = 4) {
    const q = [...new Set(words(question))];
    const N = index.chunks.length || 1;
    const avg = index.chunks.reduce((s, c) => s + c.words.length, 0) / N || 1;
    return index.chunks.map((c) => {
      let score = 0;
      for (const w of q) {
        // misma familia de palabras: "hora" ~ "horario", "vacaciones" ~ "vacacion"
        const stem = w.length > 5 ? w.slice(0, -2) : w;
        const tf = c.words.filter((x) => x === w || (w.length >= 4 && x.startsWith(stem)) || (x.length >= 4 && w.startsWith(x))).length;
        if (!tf) continue;
        const idf = Math.log(1 + (N - (index.df[w] || 0) + 0.5) / ((index.df[w] || 0) + 0.5));
        score += idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * c.words.length / avg));
      }
      return { ...c, score };
    }).filter((c) => c.score > 0).sort((a, b) => b.score - a.score).slice(0, k);
  }

  // ---------- agenda: Outlook (si está instalado) o un calendario .ics (Google: "dirección secreta en formato iCal") ----------
  function outlookEvents(day) {
    const from = new Date(day); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const fmt = (d) => `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} 00:00`;
    const script = '$o = New-Object -ComObject Outlook.Application; $items = $o.GetNamespace("MAPI").GetDefaultFolder(9).Items; '
      + '$items.IncludeRecurrences = $true; $items.Sort("[Start]"); '
      + `$r = $items.Restrict("[Start] >= '" + ([datetime]::ParseExact('${fmt(from)}','M/d/yyyy HH:mm',$null)).ToString('g') + "' AND [Start] < '" + ([datetime]::ParseExact('${fmt(to)}','M/d/yyyy HH:mm',$null)).ToString('g') + "'"); `
      + '$r | ForEach-Object { "{0}`t{1}`t{2}" -f $_.Start.ToString("HH:mm"), $_.AllDayEvent, $_.Subject }';
    return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 30000, encoding: 'utf8' },
      (err, out) => (err ? reject(err) : resolve(out.trim().split(/\r?\n/).filter(Boolean).map((l) => {
        const [hm, allDay, title] = l.split('\t');
        return { time: allDay === 'True' ? null : hm, title };
      })))));
  }

  async function icsEvents(url, day) {
    const raw = (await getText(url.replace(/^webcal:/, 'https:'))).replace(/\r?\n[ \t]/g, '');
    const want = new Date(day); want.setHours(0, 0, 0, 0);
    const out = [];
    for (const ev of raw.split('BEGIN:VEVENT').slice(1)) {
      const start = ev.match(/\nDTSTART([^:\n]*):(\d{8})(T(\d{2})(\d{2})(\d{2})(Z?))?/);
      if (!start) continue;
      const [, , ymd, hasTime, hh, mm, , z] = start;
      const y = +ymd.slice(0, 4), mo = +ymd.slice(4, 6) - 1, d = +ymd.slice(6, 8);
      const when = hasTime ? (z ? new Date(Date.UTC(y, mo, d, +hh, +mm)) : new Date(y, mo, d, +hh, +mm)) : new Date(y, mo, d);
      const weekly = /RRULE:FREQ=WEEKLY/.test(ev) && when <= want && when.getDay() === want.getDay();
      const daily = /RRULE:FREQ=DAILY/.test(ev) && when <= want;
      const same = new Date(when).setHours(0, 0, 0, 0) === want.getTime();
      if (!same && !weekly && !daily) continue;
      const title = (ev.match(/\nSUMMARY[^:\n]*:(.*)/)?.[1] || 'Evento').replace(/\\,/g, ',').replace(/\\n/g, ' ').trim();
      out.push({ time: hasTime ? `${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}` : null, title });
    }
    return out.sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  }

  const COUNTRY = { PEN: 'PE', MXN: 'MX', COP: 'CO', ARS: 'AR', CLP: 'CL', BOB: 'BO', UYU: 'UY', GTQ: 'GT', DOP: 'DO', EUR: 'ES', USD: 'US' };

  return [
    // ===== leer la pantalla =====
    {
      id: 'screen', llm: 'leer o explicar lo que se ve en la pantalla (un error, un texto, una ventana)',
      patterns: [/\b(que dice|que hay|que ves|lee|leeme|explicame|explica|ayudame con|que significa|traduce|resume)\b.*\b(pantalla|este error|ese error|esta ventana|este mensaje|ese mensaje)\b/, /\bmira (mi |la )?pantalla\b/],
      run: async (_m, text) => {
        const png = await ctx.captureScreen();
        const q = fold(text);
        const task = /tradu/.test(q) ? 'Traduce al español el texto principal de la pantalla.'
          : /resum/.test(q) ? 'Resume en 2 o 3 oraciones lo que hay en la pantalla.'
            : /error|mensaje|significa|ayuda|expli/.test(q) ? 'Hay un error o mensaje en la pantalla: explica qué significa y cómo solucionarlo en pasos cortos.'
              : `Responde a esto sobre lo que se ve en la pantalla: "${text}"`;
        // con un modelo de visión instalado en Ollama, mira la imagen; si no, lee el texto con el OCR de Windows
        const vision = await llm.visionModel();
        try {
          if (vision) return { reply: (await llm.generate(task, '(imagen de la pantalla adjunta)', { ...personality(), images: [png.toString('base64')], model: vision })).slice(0, 700), mood: 'focused' };
          const seen = await ocr(png);
          if (!seen) return { reply: 'No encontré texto en la pantalla 🧐', mood: 'thinking' };
          return { reply: (await llm.generate(`${task} Este es el texto que se lee en la pantalla (puede tener errores de lectura):`, seen, personality())).slice(0, 700), mood: 'focused' };
        } catch (err) {
          return { reply: `No pude leer la pantalla: ${String(err.message).split('\n')[0].slice(0, 100)}`, mood: 'sad' };
        }
      },
    },

    // ===== tus documentos =====
    {
      id: 'library-open', pc: true, llm: 'abrir la carpeta Biblioteca donde se ponen los documentos para preguntarle',
      patterns: [/\b(abre|abreme|muestrame)\b.*\b(biblioteca|carpeta de documentos del panda|tus documentos)\b/],
      run: async () => {
        fs.mkdirSync(library(), { recursive: true });
        await el().shell.openPath(library());
        return { reply: 'Esta es mi Biblioteca 📚 Pon aquí tus documentos (Word, PDF, PowerPoint, texto) y pregúntame "según mis documentos, …"', mood: 'happy' };
      },
    },
    {
      id: 'library-ask', llm: 'responder una pregunta usando los documentos del usuario (target = la pregunta)',
      patterns: [/\b(segun mis documentos|en mis documentos|en mis apuntes|en mi biblioteca|segun mis apuntes|preguntale a mis documentos|busca en mis documentos|que dicen mis documentos)\b/],
      run: async (_m, text, target) => {
        const question = tidy(target || text.replace(/^(?:seg[uú]n|en|busca en|preg[uú]ntale a|qu[eé] dicen)\s+(?:mis|mi)\s+(?:documentos|apuntes|biblioteca),?\s*/i, ''));
        const idx = await buildIndex();
        if (!idx.chunks.length) return { reply: 'Tu Biblioteca está vacía 📚 Dime "abre tu biblioteca" y pon ahí tus documentos.', mood: 'thinking' };
        const hits = search(question);
        if (!hits.length) return { reply: `No encontré nada sobre eso en tus ${idx.files} documentos 🔎`, mood: 'thinking' };
        const context = hits.map((h) => `[${h.file}]\n${h.text}`).join('\n\n---\n\n');
        try {
          const answer = await llm.generate('Responde la pregunta usando SOLO estos fragmentos de los documentos del usuario y di de qué archivo sale. '
            + 'Interpreta la pregunta con sentido común: el usuario habla de sí mismo como empleado o lector del documento '
            + '(p. ej. "¿a qué hora entro?" = el horario de entrada). Solo si de verdad no está, dilo. '
            + `Pregunta: ${question}`, context, personality());
          return { reply: answer.slice(0, 700), mood: 'focused' };
        } catch {
          return { reply: `Encontré esto en ${hits[0].file}: ${hits[0].text.slice(0, 300)}…`, mood: 'focused' };
        }
      },
    },

    // ===== agenda =====
    {
      id: 'agenda', llm: 'decir qué reuniones o eventos tiene en su calendario (hoy, mañana, el viernes…)',
      patterns: [/\b(mi agenda|mis reuniones|mi calendario|que reuniones|tengo reuniones|que tengo hoy|que tengo manana|que eventos|mis eventos|mis citas)\b/],
      run: async (_m, text) => {
        const when = tiempo.parseWhen(text);
        const day = when ? when.date : new Date();
        const dayWord = tiempo.spokenDay(day);
        const ics = brain().settings.icsUrl;
        let events;
        try { events = ics ? await icsEvents(ics, day) : await outlookEvents(day); } catch {
          return { reply: 'No pude leer tu calendario 📅 Si usas Google Calendar, pega su "dirección secreta en formato iCal" en Ajustes.', mood: 'sad' };
        }
        if (!events.length) return { reply: `No tienes nada en tu calendario ${dayWord} 🎉`, mood: 'happy' };
        const list = events.slice(0, 6).map((e) => `${e.time || 'todo el día'} ${e.title}`).join(' · ');
        return { reply: `${dayWord[0].toUpperCase() + dayWord.slice(1)} tienes ${events.length}: ${list} 📅`, mood: 'focused' };
      },
    },

    // ===== noticias y Wikipedia (internet) =====
    {
      id: 'news', llm: 'leer las noticias del día, en general o de un tema (target = tema); necesita internet',
      patterns: [/\b(noticias|que hay de nuevo|titulares|que esta pasando)\b/],
      run: async (_m, text, target) => {
        const topic = tidy(target || (fold(text).match(/\bnoticias\s+(?:de|del|sobre)\s+(.+)$/)?.[1] || ''));
        const gl = COUNTRY[brain().settings.currency] || 'US';
        const url = topic
          ? `https://news.google.com/rss/search?q=${encodeURIComponent(topic)}&hl=es-419&gl=${gl}&ceid=${gl}:es-419`
          : `https://news.google.com/rss?hl=es-419&gl=${gl}&ceid=${gl}:es-419`;
        try {
          const xml = await getText(url);
          const titles = [...xml.matchAll(/<item>[\s\S]*?<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/g)].slice(0, 5)
            .map((m) => m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+-\s+[^-]+$/, ''));
          if (!titles.length) return { reply: 'No encontré noticias ahora 📰', mood: 'thinking' };
          return { reply: `📰 ${titles.map((t, i) => `${i + 1}) ${t}.`).join(' ')}`, mood: 'focused' };
        } catch { return { reply: 'No pude traer las noticias 📡 ¿Hay internet?', mood: 'sad' }; }
      },
    },
    {
      id: 'wikipedia', llm: 'buscar información en internet / Wikipedia y resumirla (target = el tema)',
      patterns: [/\b(busca en wikipedia|que dice wikipedia|wikipedia sobre|investiga sobre|investiga|busca informacion (de|sobre)|averigua sobre)\b/],
      run: async (_m, text, target) => {
        const topic = tidy(target || text.replace(/^.*?\b(?:wikipedia(?:\s+(?:de|sobre))?|investiga(?:\s+sobre)?|informaci[oó]n\s+(?:de|sobre)|averigua\s+sobre)\s+/i, ''));
        if (!topic) return { reply: '¿Sobre qué investigo? 🔎', mood: 'thinking' };
        try {
          const found = JSON.parse(await getText(`https://es.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&search=${encodeURIComponent(topic)}`));
          const title = found[1]?.[0];
          if (!title) return { reply: `No encontré "${topic}" en Wikipedia 🔎`, mood: 'thinking' };
          const page = JSON.parse(await getText(`https://es.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`));
          const extract = page.extract || '';
          let reply = extract;
          try { reply = await llm.generate('Resume esto en 2 o 3 oraciones sencillas.', extract, personality()); } catch {}
          return { reply: `${reply.slice(0, 600)} (Wikipedia: ${title})`, mood: 'focused' };
        } catch { return { reply: 'No pude consultar Wikipedia 📡 ¿Hay internet?', mood: 'sad' }; }
      },
    },

    // ===== el personaje =====
    {
      id: 'walk', llm: 'caminar o pasear por la barra de tareas, o quedarse quieto',
      patterns: [/\b(camina|caminar|pasea|pasear|da un paseo|date una vuelta|muevete|quedate quieto|deja de caminar|para de caminar|no te muevas)\b/],
      run: async (_m, text) => {
        const stop = /\b(quieto|deja de|para de|no te muevas)\b/.test(fold(text));
        ctx.walk(!stop);
        return { reply: stop ? 'Ok, me quedo aquí 🐼' : '¡A pasear! 🐾 Dime "quédate quieto" para que pare.', mood: stop ? 'idle' : 'happy' };
      },
    },
    {
      id: 'wave', llm: 'saludar con la pata',
      patterns: [/\b(saludame|saluda|di hola|haz hola|choca esos cinco)\b/],
      run: async () => { ctx.gesture('wave'); return { reply: `¡Hola${brain().name ? `, ${brain().name}` : ''}! 👋🐼`, mood: 'happy' }; },
    },
    {
      id: 'voice-speed', llm: 'hablar más rápido, más lento o normal',
      patterns: [/\bhabla\s+(mas\s+)?(rapido|lento|despacio|normal)\b/, /\b(mas rapido|mas despacio|mas lento)\b.*\bhabla/],
      run: async (_m, text) => {
        const q = fold(text);
        const now = brain().settings.voiceSpeed || 1;
        const v = /normal/.test(q) ? 1 : /rapido/.test(q) ? Math.min(1.4, now + 0.15) : Math.max(0.7, now - 0.15);
        ctx.setSetting('voiceSpeed', Math.round(v * 100) / 100);
        return { reply: v === 1 ? 'Vuelvo a mi velocidad normal 🐼' : v > now ? 'Ok, hablaré más rápido ⚡' : 'Ok, hablaré más despacio 🐢', mood: 'happy' };
      },
    },
    {
      id: 'update', llm: 'buscar si hay una versión nueva de MicroPanda',
      patterns: [/\b(busca actualizaciones|hay actualizaciones|hay una version nueva|actualizate)\b/],
      run: async () => ctx.checkUpdates(true),
    },
  ];
};
