"""比對評分：與 game/score.js 相同規則（1 − 編輯距離 ÷ 較長者長度；包含正確詞直接算 1 分）。
≥ 0.8 通過、≥ 0.5 不確定、其餘不通過。門檻在實測後依各腔結果調整。"""
import re
PASS, UNSURE = 0.8, 0.5

def lev(a, b):
    a, b = list(a), list(b)
    if not a: return len(b)
    if not b: return len(a)
    prev = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        cur = [i]
        for j in range(1, len(b) + 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] != b[j - 1])))
        prev = cur
    return prev[-1]

def sim(a, b):
    n = max(len(a), len(b))
    return 1 - lev(a, b) / n if n else 0.0

def norm_zh(s):
    return re.sub(r'[\W\d_a-zA-Z]+', '', s or '').replace('台', '臺')

def norm_en(s):
    s = re.sub(r'[^a-z ]+', ' ', (s or '').lower())
    s = re.sub(r'\b(a|an|the|this|is|it|that)\b', ' ', s)
    return re.sub(r'\s+', ' ', s).strip()

def sylls(p, keep_tone=False):
    out = [x for x in re.split(r'[\s\-]+', (p or '').lower()) if x]
    return out if keep_tone else [re.sub(r'\d+$', '', x) for x in out]

def syll_sim(a, b, keep_tone=False):
    x, y = sylls(a, keep_tone), sylls(b, keep_tone)
    n = max(len(x), len(y))
    return 1 - lev(x, y) / n if n else 0.0

def verdict(s):
    return 'pass' if s >= PASS else 'unsure' if s >= UNSURE else 'fail'

def looks_pinyin(t):
    return bool(re.search(r'[a-z]+\d', (t or '').lower()))

def score(lang, transcript, accept, pinyin=None):
    best, match = 0.0, ''
    if lang == 'en':
        t = norm_en(transcript)
        for a in accept:
            n = norm_en(a)
            if not n: continue
            s = 1.0 if f' {n} ' in f' {t} ' else sim(t, n)
            if s > best: best, match = s, a
    else:
        if lang == 'hak' and pinyin and looks_pinyin(transcript):
            s = syll_sim(transcript, pinyin)
            if s > best: best, match = s, pinyin
        t = norm_zh(transcript)
        for a in accept:
            n = norm_zh(a)
            if not n or not t: continue
            s = 1.0 if n in t else sim(t, n)
            if s > best: best, match = s, a
    best = round(best, 2)
    return {'score': best, 'verdict': verdict(best), 'match': match}
