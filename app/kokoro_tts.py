"""Servidor de voz Kokoro-82M (Apache 2.0) para MicroPanda.

Se queda abierto con el modelo cargado. Recibe una línea JSON por stdin:
  {"id": 1, "text": "Hola", "out": "C:/.../salida.wav", "voice": "ef_dora", "speed": 1.0}
escribe el WAV y responde una línea JSON por stdout: {"id": 1, "ok": true}

MICROPANDA_LANG: pronunciación de espeak; "es-419" = español latinoamericano (seseo: "cielo" = "sielo").
MICROPANDA_DEVICE=auto|gpu|cpu: usa CUDA solo si está instalado onnxruntime-gpu; si no, la CPU.
"""
import json
import os
import sys
import wave

import numpy as np
import onnxruntime as ort
from kokoro_onnx import Kokoro

models = sys.argv[1]
default_voice = os.environ.get("MICROPANDA_VOICE", "ef_dora")
lang = os.environ.get("MICROPANDA_LANG", "es-419")
providers = ["CPUExecutionProvider"]
if os.environ.get("MICROPANDA_DEVICE", "auto") != "cpu" and "CUDAExecutionProvider" in ort.get_available_providers():
    providers.insert(0, "CUDAExecutionProvider")
sess = ort.InferenceSession(os.path.join(models, "kokoro-v1.0.onnx"), providers=providers)
kokoro = Kokoro.from_session(sess, os.path.join(models, "voices-v1.0.bin"))
device = "gpu" if sess.get_providers()[0] == "CUDAExecutionProvider" else "cpu"


def send(msg):
    sys.stdout.write(json.dumps(msg, ensure_ascii=False) + "\n")
    sys.stdout.flush()


try:
    voices = [v for v in kokoro.get_voices() if v.startswith(("ef_", "em_"))]
except Exception:
    voices = []
send({"ready": True, "voice": default_voice, "device": device, "lang": lang, "spanish_voices": voices})

for line in sys.stdin:
    if not line.strip():
        continue
    req = json.loads(line)
    try:
        samples, rate = kokoro.create(req["text"], voice=req.get("voice") or default_voice,
                                      speed=float(req.get("speed", 1.0)), lang=lang)
        pcm = (np.clip(samples, -1, 1) * 32767).astype("<i2")
        with wave.open(req["out"], "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(pcm.tobytes())
        send({"id": req["id"], "ok": True})
    except Exception as e:  # el error vuelve a la app, que usa Piper como respaldo
        send({"id": req["id"], "ok": False, "error": str(e)})
