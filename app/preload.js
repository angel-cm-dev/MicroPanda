// Puente seguro entre la página del panda (y la de ajustes) y la app.
const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => ipcRenderer.on(channel, (_e, data) => cb(data));

contextBridge.exposeInMainWorld('micropanda', {
  onCursor: on('cursor'),
  onMood: on('mood'),               // { mood, ms, say, manual, alert }
  onOpenChat: on('open-chat'),
  onListen: on('listen'),
  onConfig: on('config'),           // micrófono, sensibilidad, silencio, disfraz…
  onWalk: on('walk'),               // { on, dir }: pasea por la barra de tareas
  onGesture: on('gesture'),         // 'wave', 'nod'…
  onMicInfo: on('mic-info'),        // ajustes: { mics, micActive }
  move: (dx, dy) => ipcRenderer.send('move', { dx, dy }),
  menu: () => ipcRenderer.send('menu'),
  poke: () => ipcRenderer.send('poke'),
  setChatOpen: (open) => ipcRenderer.send('chat', open),
  reportMics: (data) => ipcRenderer.send('mics', data),   // { list, active }
  ask: (text) => ipcRenderer.invoke('ask', text),
  confirm: (yes) => ipcRenderer.invoke('confirm', yes),
  voiceStatus: () => ipcRenderer.invoke('voice-status'),
  transcribe: (wav) => ipcRenderer.invoke('transcribe', wav),
  wake: (wav) => ipcRenderer.invoke('wake', wav),
  speak: (text) => ipcRenderer.invoke('speak', text),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSetting: (k, v) => ipcRenderer.invoke('set-setting', k, v),
});
