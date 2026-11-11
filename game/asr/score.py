"""比對評分：與 game/score.js 相同規則（1 − 編輯距離 ÷ 較長者長度；包含正確詞直接算 1 分）。
≥ 0.8 通過、≥ 0.5 不確定、其餘不通過。門檻在實測後依各腔結果調整。
放寬規則：簡體轉繁體（有裝 OpenCC 就用 OpenCC，否則用與 score.js 相同的對照表）、
連續重複的幻覺輸出先收斂（妮妮妮… → 妮）、拼音比對不看聲調。"""
import re
PASS, UNSURE = 0.8, 0.5

# 與 game/score.js 的 VAR 相同；沒有 OpenCC 時使用
VAR = {"台": "臺", "车": "車", "机": "機", "电": "電", "视": "視", "脑": "腦", "鸡": "雞", "鸭": "鴨", "马": "馬", "猪": "豬", "鸟": "鳥", "鱼": "魚", "龟": "龜", "蚂": "螞", "蚁": "蟻", "蝇": "蠅", "伞": "傘", "钟": "鐘", "表": "錶", "书": "書", "刷": "刷", "锅": "鍋", "盘": "盤", "灯": "燈", "帽": "帽", "鞋": "鞋", "苹": "蘋", "萝": "蘿", "卜": "蔔", "凤": "鳳", "梨": "梨", "兔": "兔", "狮": "獅", "猴": "猴", "虾": "蝦", "蟹": "蟹", "蛙": "蛙", "蜗": "蝸", "蜂": "蜂", "蝶": "蝶", "鹿": "鹿"}
try:
    from opencc import OpenCC  # pip install opencc-python-reimplemented（或 opencc）
    _CC = OpenCC('s2twp' if 'opencc_python' not in OpenCC.__module__ else 's2tw')
except Exception:  # 沒裝就用對照表
    _CC = None

def to_trad(s):
    s = s or ''
    if _CC is not None:
        try:
            s = _CC.convert(s)
        except Exception:
            pass
    return ''.join(VAR.get(c, c) for c in s)

def collapse_repeats(s, max_rep=2):
    """把幻覺重複收斂：同一個字或片段連續出現超過 max_rep 次只留一次。"""
    return re.sub(r'(.{1,4}?)\1{%d,}' % max_rep, r'\1', s or '')

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
    return collapse_repeats(to_trad(re.sub(r'[\W\d_a-zA-Z]+', '', s or '')))

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
