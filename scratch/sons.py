"""Bruitages rétro synthétisés pour Pong.sb3 (WAV mono 16 bits, 22 050 Hz)."""
import io
import math
import random
import struct
import wave

RATE = 22050


def _wav(samples):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32000)) for s in samples))
    return buf.getvalue(), len(samples)


def _n(duration):
    return int(RATE * duration)


def _square(phase):
    return 1.0 if math.sin(phase) >= 0 else -1.0


def pong():
    """Bip court et carré, façon Pong d'origine."""
    n = _n(0.07)
    return _wav([0.35 * _square(2 * math.pi * 490 * i / RATE) * (1 - i / n) ** 0.5 for i in range(n)])


def missile():
    """Souffle qui monte : bruit + sifflement de 300 à 1400 Hz."""
    rnd = random.Random(1)
    n, phase, out, low = _n(0.4), 0.0, [], 0.0
    for i in range(n):
        t = i / n
        phase += 2 * math.pi * (300 + 1100 * t ** 0.7) / RATE
        low += 0.25 * (rnd.uniform(-1, 1) - low)
        env = min(1, t * 20) * (1 - t) ** 0.8
        out.append(env * (0.25 * math.sin(phase) + 0.35 * low))
    return _wav(out)


def explosion():
    """Bruit grave qui s'éteint, avec un grondement."""
    rnd = random.Random(2)
    n, out, low = _n(0.8), [], 0.0
    for i in range(n):
        t = i / n
        cutoff = 0.35 * (1 - t) + 0.03              # le bruit s'assourdit
        low += cutoff * (rnd.uniform(-1, 1) - low)
        rumble = math.sin(2 * math.pi * (70 - 30 * t) * i / RATE)
        env = min(1, t * 60) * math.exp(-4.5 * t)
        out.append(env * (0.9 * low * 2.2 + 0.35 * rumble))
    return _wav(out)


def flop():
    """« Pfouu » : son qui descend et s'étouffe (missile perdu)."""
    n, phase, out = _n(0.45), 0.0, []
    for i in range(n):
        t = i / n
        freq = 380 * (1 - t) ** 1.5 + 90 + 15 * math.sin(2 * math.pi * 9 * t)
        phase += 2 * math.pi * freq / RATE
        env = min(1, t * 30) * (1 - t) ** 1.2
        out.append(0.4 * env * (math.sin(phase) + 0.3 * math.sin(2 * phase)))
    return _wav(out)


def bonus():
    """Deux notes montantes quand on attrape un cadeau."""
    out = []
    for freq, dur in ((880, 0.06), (1320, 0.1)):
        n = _n(dur)
        out += [0.3 * math.sin(2 * math.pi * freq * i / RATE) * (1 - i / n) for i in range(n)]
    return _wav(out)


def fin():
    """Petite fanfare de fin de partie : do mi sol do."""
    out = []
    for freq, dur in ((523, 0.13), (659, 0.13), (784, 0.13), (1047, 0.5)):
        n = _n(dur)
        for i in range(n):
            t = i / n
            env = min(1, t * 40) * (1 - t) ** (0.6 if dur > 0.2 else 0.3)
            ph = 2 * math.pi * freq * i / RATE
            out.append(0.3 * env * (0.7 * _square(ph) * 0.5 + 0.6 * math.sin(ph)))
    return _wav(out)


SOUNDS = {'pong': pong, 'missile': missile, 'explosion': explosion,
          'flop': flop, 'bonus': bonus, 'fin': fin}
