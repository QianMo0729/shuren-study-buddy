"""树仁搭子宣传片的音效（可选配乐）：只用 numpy 合成，没有采样、没有人声。

python3 audio.py build/events.json build/score.wav [时长] [--music]
默认只有音效；加 --music 才叠上和弦铺底、低音和节拍。
场景时间与 film.html 一致：S2 6.9 · S3 12.8 · S4 19.2 · S5 25.9 · S6 38.3 · S7 44.6
"""
import json, sys, wave
import numpy as np

SR = 48000
MUSIC = '--music' in sys.argv
argv = [a for a in sys.argv[1:] if a != '--music']
ev_path, out_path = argv[0], argv[1]
DUR = float(argv[2]) if len(argv) > 2 else 52.0
N = int(SR * DUR)
rng = np.random.default_rng(11)
S2, S3, S4, S5, S6, S7 = 6.9, 12.8, 19.2, 25.9, 38.3, 44.6

mix_pad = np.zeros((N, 2)); mix_fx = np.zeros((N, 2)); mix_dry = np.zeros((N, 2))

def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)

def env_adsr(n, a, r, sus=1.0):
    t = np.arange(n) / SR
    e = np.minimum(1, t / max(a, 1e-4)) * sus
    rel = np.clip((t[-1] - t) / max(r, 1e-4), 0, 1)
    return e * np.minimum(1, rel)

def place(buf, x, t0, gain=1.0, pan=0.0):
    i0 = int(t0 * SR)
    if i0 >= N: return
    if i0 < 0: x = x[-i0:]; i0 = 0
    n = min(len(x), N - i0)
    l = np.cos((pan + 1) * np.pi / 4); r = np.sin((pan + 1) * np.pi / 4)
    buf[i0:i0 + n, 0] += x[:n] * gain * l * 1.414
    buf[i0:i0 + n, 1] += x[:n] * gain * r * 1.414

def fft_filter(x, lo, hi, soft=0.15):
    X = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / SR)
    m = 1 / (1 + np.exp(-(f - lo) / (lo * soft + 1))) * 1 / (1 + np.exp((f - hi) / (hi * soft + 1)))
    return np.fft.irfft(X * m, len(x))

# ---------------- 铺底：加法合成的柔和和弦 ----------------
def pad_note(freq, n, bright=0.35):
    t = np.arange(n) / SR
    y = np.zeros(n)
    for det in (-0.003, 0.003):
        f = freq * (1 + det)
        for k in range(1, 8):
            if f * k > 8000: break
            y += np.sin(2 * np.pi * f * k * t + rng.uniform(0, 6.28)) * (1 / k) * np.exp(-k * (1 - bright) * 0.6)
    y *= 1 + 0.07 * np.sin(2 * np.pi * 0.21 * t + rng.uniform(0, 6))
    return y / 6

CH = {  # F 大调
    'Fmaj9': [41, 53, 57, 60, 64, 67],
    'Fmaj7': [41, 53, 57, 60, 64],
    'Am7':   [45, 52, 55, 60, 64],
    'Bbmaj9':[46, 53, 57, 60, 62, 65],
    'Csus':  [48, 55, 60, 62, 65, 67],
    'Dm9':   [50, 57, 60, 64, 65, 69],
    'Gm9':   [43, 50, 53, 57, 58, 62],
    'Bbmaj7':[46, 53, 57, 60, 65],
    'Fadd9': [41, 48, 57, 60, 65, 67, 72],
}
plan = [
    (0.2, S2 - 0.2, 'Fmaj9', 0.25),
    (S2 - 0.1, 3.0, 'Fmaj7', 0.35), (S2 + 2.85, S3 - S2 - 2.85, 'Am7', 0.35),
    (S3 - 0.1, 3.3, 'Bbmaj9', 0.38), (S3 + 3.15, S4 - S3 - 3.15, 'Csus', 0.42),
    (S4 - 0.1, 3.4, 'Dm9', 0.35), (S4 + 3.25, S5 - S4 - 3.25, 'Bbmaj7', 0.38),
    (S5 - 0.1, 3.2, 'Fmaj7', 0.38), (S5 + 3.05, 3.0, 'Am7', 0.38), (S5 + 5.9, 3.6, 'Gm9', 0.4), (S5 + 9.4, S6 - S5 - 9.4, 'Csus', 0.48),
    (S6 - 0.1, 3.2, 'Fmaj7', 0.4), (S6 + 3.05, S7 - S6 - 3.05, 'Dm9', 0.4),
    (S7 - 0.1, 1.7, 'Bbmaj9', 0.42), (S7 + 1.45, DUR - S7 - 1.45, 'Fadd9', 0.5),
]
for (t0, dur, name, br) in (plan if MUSIC else []):
    n = int(dur * SR) + int(1.6 * SR)
    y = np.zeros(n)
    for j, m in enumerate(CH[name]):
        y += pad_note(mtof(m), n, br) * (0.9 if j else 1.1)
    e = env_adsr(n, 0.8 if t0 > 1 else 2.2, 1.6)
    place(mix_pad, y * e, t0, 0.16, 0)
    # 低音
    root = CH[name][0]
    nb = int(dur * SR); tb = np.arange(nb) / SR
    if t0 > S2 - 0.5:
        place(mix_dry, np.sin(2 * np.pi * mtof(root) * tb) * env_adsr(nb, 0.06, 0.5), t0 + 0.1, 0.05)

# ---------------- 节拍：96 bpm，安静的底鼓与沙沙的镲 ----------------
BEAT = 60 / 96
def kick():
    n = int(0.35 * SR); t = np.arange(n) / SR
    f = 50 + 85 * np.exp(-t * 36)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 9)
def hat():
    n = int(0.06 * SR); x = rng.standard_normal(n)
    return fft_filter(x, 7000, 15000) * np.exp(-np.arange(n) / SR * 70)
def rim():
    n = int(0.08 * SR); t = np.arange(n) / SR
    return (np.sin(2 * np.pi * 1700 * t) * 0.5 + fft_filter(rng.standard_normal(n), 2500, 6000)) * np.exp(-t * 60)
K, H, R = kick(), hat(), rim()
t = S2
while MUSIC and t < S7 - 0.3:
    b = round((t - S2) / BEAT)
    soft = 0.55 if S3 <= t < S4 else 1.0           # 共同空闲那段收一点
    if b % 2 == 0: place(mix_dry, K, t, 0.2 * soft)
    if b % 4 == 2: place(mix_dry, R, t, 0.05 * soft, 0.1)
    place(mix_dry, H, t + BEAT / 2, 0.05 * soft, 0.35 if b % 2 else -0.35)
    t += BEAT

# ---------------- 音效 ----------------
def blip(f, d=0.12, dec=40, harm=(1, 2.0), amps=(1, 0.25)):
    n = int(d * SR); t = np.arange(n) / SR
    y = sum(a * np.sin(2 * np.pi * f * h * t) for h, a in zip(harm, amps))
    return y * np.exp(-t * dec) * np.minimum(1, t / 0.002)
def bell(f, d=2.4):
    n = int(d * SR); t = np.arange(n) / SR
    parts = [(1, 1, 2.2), (2.0, .4, 3.5), (2.76, .3, 4.5), (5.4, .1, 7), (8.9, .04, 10)]
    y = sum(a * np.sin(2 * np.pi * f * p * t) * np.exp(-t * dc) for p, a, dc in parts)
    return y * np.minimum(1, t / 0.003)
def whoosh(d=0.6, lo=300, hi=5000, rise=True):
    n = int(d * SR); x = rng.standard_normal(n)
    segs = 12; y = np.zeros(n); L = n // segs
    for s in range(segs):
        p = s / (segs - 1); p = p if rise else 1 - p
        fc = lo * (hi / lo) ** p
        seg = fft_filter(x[s * L:(s + 1) * L + 256], fc * 0.6, fc * 1.6)[:L]
        y[s * L:s * L + len(seg)] += seg
    return y * np.sin(np.pi * np.linspace(0, 1, n)) ** 2
def thud(g=1.0):
    n = int(0.9 * SR); t = np.arange(n) / SR
    f = 45 + 70 * np.exp(-t * 20)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 4.5)
    y[:int(0.01 * SR)] += fft_filter(rng.standard_normal(int(0.01 * SR)), 800, 4000) * 0.3
    return y * g
def click(lo=2000, hi=9000, dec=180):
    n = int(0.03 * SR); t = np.arange(n) / SR
    return fft_filter(rng.standard_normal(n), lo, hi) * np.exp(-t * dec) + np.sin(2 * np.pi * 320 * t) * np.exp(-t * 120) * 0.4
def stamp_hit(g=1.0):
    # 印章落下：低频的闷响 + 纸面的一下“啪”
    y = thud(0.9 * g)
    n = int(0.12 * SR); t = np.arange(n) / SR
    slap = fft_filter(rng.standard_normal(n), 500, 3500) * np.exp(-t * 45) * 0.6 * g
    y[:n] += slap
    return y
def shutter():
    a = click(1500, 8000, 120); b = click(1200, 6000, 90)
    y = np.zeros(int(0.16 * SR)); y[:len(a)] += a; y[int(0.07 * SR):int(0.07 * SR) + len(b)] += b * 0.8
    return y
def pencil(d=1.3):
    n = int(d * SR); x = rng.standard_normal(n)
    y = fft_filter(x, 2500, 9000) * (0.4 + 0.6 * np.abs(np.sin(np.linspace(0, 9 * np.pi, n))))
    return y * np.sin(np.pi * np.linspace(0, 1, n)) ** 1.5

pops = [mtof(m) for m in (72, 74, 77, 79, 81, 84, 86, 89, 91)]
steps = [mtof(m) for m in (77, 81, 84, 86, 89, 93)]
evs = json.load(open(ev_path))
pc = 0
for e in evs:
    t0, ty, v = e['t'], e['type'], e.get('v', 1.0)
    pan = float(rng.uniform(-0.3, 0.3))
    if ty == 'pop':
        place(mix_fx, blip(pops[pc % 9], 0.16, 30, (1, 3.0), (1, .12)), t0, 0.08 * v, pan); pc += 1
    elif ty == 'whoosh':
        place(mix_fx, whoosh(0.7, 250, 3500, True), t0 - 0.2, 0.045 * v, 0.2)
    elif ty == 'land':
        place(mix_fx, bell(mtof(81)), t0, 0.06); place(mix_fx, bell(mtof(88)), t0 + 0.03, 0.03, 0.3)
    elif ty == 'thud':
        place(mix_dry, thud(), t0, 0.32 * v)
    elif ty == 'brand':
        for j, m in enumerate((65, 72, 77, 81)):
            place(mix_fx, bell(mtof(m), 3.0), t0 + 0.04 * j, 0.035, -0.3 + 0.2 * j)
    elif ty == 'tap':
        place(mix_dry, click(), t0, 0.1, pan)
    elif ty == 'swipe':
        place(mix_fx, whoosh(0.32, 900, 5000, False), t0, 0.05 * v, -0.4)
    elif ty == 'chime':
        place(mix_fx, bell(mtof(84), 1.6), t0, 0.04, 0.2); place(mix_fx, bell(mtof(91), 1.6), t0 + 0.08, 0.025, -0.2)
    elif ty == 'shimmer':
        for j in range(8):
            place(mix_fx, blip(mtof(84 + (0, 2, 5, 7, 9, 12, 14, 17)[j]), 0.2, 22, (1, 2), (1, .1)), t0 + 0.07 * j, 0.025, -0.5 + j / 7)
    elif ty == 'step':
        place(mix_fx, blip(steps[int(v) % 6], 0.4, 9, (1, 2, 3), (1, .3, .08)), t0, 0.06, -0.3 + 0.12 * int(v))
    elif ty == 'stamp':
        place(mix_dry, stamp_hit(v), t0, 0.36)
    elif ty == 'notif':
        place(mix_fx, blip(mtof(88), 0.3, 14, (1, 2), (1, .2)), t0, 0.05)
        place(mix_fx, blip(mtof(93), 0.4, 10, (1, 2), (1, .2)), t0 + 0.09, 0.04)
    elif ty == 'msg':
        place(mix_fx, blip(mtof(86), 0.12, 34, (1, 2), (1, .15)), t0, 0.05, pan)
    elif ty == 'commit':
        place(mix_fx, blip(mtof(89), 0.25, 18, (1, 2), (1, .2)), t0, 0.05)
    elif ty == 'shutter':
        place(mix_dry, shutter(), t0, 0.16)
    elif ty == 'draw':
        place(mix_fx, pencil(1.3), t0, 0.022, 0.1)
    elif ty == 'drop':
        place(mix_fx, blip(mtof(74), 0.3, 16, (1, 2), (1, .2)), t0 + 0.25, 0.06, pan)
        place(mix_dry, thud(0.4), t0 + 0.27, 0.12)
    elif ty == 'rise':
        place(mix_fx, whoosh(1.0, 300, 4000, True), t0 - 0.1, 0.04)
    elif ty == 'final':
        for j, m in enumerate((65, 72, 77, 79, 84)):
            place(mix_fx, bell(mtof(m), 4.0), t0 + 0.03 * j, 0.04, -0.4 + 0.2 * j)

# ---------------- 混响（合成脉冲响应的 FFT 卷积） ----------------
def reverb(x, secs=2.6, damp=2.2, pre=0.02):
    n = int(secs * SR); t = np.arange(n) / SR
    ir = np.zeros((n, 2))
    for c in range(2):
        ir[:, c] = fft_filter(rng.standard_normal(n) * np.exp(-t * damp), 120, 7000)
    ir[: int(pre * SR)] = 0
    ir /= np.sqrt((ir ** 2).sum(axis=0))
    L = len(x) + n; nfft = 1 << (L - 1).bit_length()
    out = np.zeros((len(x), 2))
    for c in range(2):
        out[:, c] = np.fft.irfft(np.fft.rfft(x[:, c], nfft) * np.fft.rfft(ir[:, c], nfft), nfft)[:len(x)]
    return out

wet = reverb(mix_pad * 0.8 + mix_fx, 3.0, 1.7) * 0.9
mix = mix_pad + mix_fx * 0.9 + wet * 0.5 + mix_dry

fi = int(0.8 * SR); mix[:fi] *= np.linspace(0, 1, fi)[:, None]
fo = int(2.0 * SR); mix[-fo:] *= np.linspace(1, 0, fo)[:, None] ** 1.5
mix = np.tanh(mix * 1.4) / np.tanh(1.4)
if MUSIC:
    rms = np.sqrt((mix ** 2).mean())
    mix *= 0.10 / max(rms, 1e-9)
else:
    # 只有音效时：先按峰值归一，再整体提 5 dB，超过 0.6 的部分软限幅（上限约 0.89），
    # 平均响度约 -20 LUFS；不按 RMS 归一，否则稀疏的音效会被推得过响
    mix *= 0.7 / max(np.abs(mix).max(), 1e-9) * 10 ** (5 / 20)
    a = np.abs(mix); k = 0.6; room = 0.29
    mix = np.where(a > k, np.sign(mix) * (k + room * np.tanh((a - k) / room)), mix)
peak = np.abs(mix).max()
if peak > 0.89: mix *= 0.89 / peak
pcm = (mix * 32767).astype('<i2')
with wave.open(out_path, 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())
print('wrote', out_path, 'rms', round(float(np.sqrt((mix ** 2).mean())), 4), 'peak', round(float(np.abs(mix).max()), 3))
