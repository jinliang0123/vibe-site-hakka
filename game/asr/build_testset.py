"""產生六腔語音實測詞表：python3 game/asr/build_testset.py
每個腔調 200 個詞：先放遊戲詞彙表（objcam/vocab.js）裡有整詞錄音的物品名稱，
其餘從《臺灣客語辭典》（hakkaocr/dict.json，來源 0）中抽 2–4 字、有該腔錄音的詞補足（固定亂數種子，可重現）。
錄音是教育部辭典的示範發音，用來測「標準發音能不能被辨識對」；長輩真實錄音要在封測時另外收。"""
import json, os, random, re
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..', '..')
AUDIO_BASE = 'https://hakkadict.moe.edu.tw/static/audio/'
DIAL = {1: '四縣', 2: '海陸', 3: '大埔', 4: '饒平', 5: '詔安', 6: '南四縣'}
PER = 200

def load_vocab():
    s = open(os.path.join(ROOT, 'objcam', 'vocab.js'), encoding='utf-8').read()
    i = s.index('window.OBJ_VOCAB=') + len('window.OBJ_VOCAB=')
    return json.JSONDecoder().raw_decode(s[i:])[0]['V']

def audio_url(a, d):
    if isinstance(a, str):
        a = a.replace('#', str(d))
    else:
        a = a[d - 1]
    if not a:
        return None
    return AUDIO_BASE + a + ('' if re.search(r'\.(mp3|wav)$', a) else '.mp3')

def main():
    vocab = load_vocab()
    dic = json.load(open(os.path.join(ROOT, 'hakkaocr', 'dict.json'), encoding='utf-8'))
    out = {'note': __doc__.strip(), 'per_dialect': PER, 'dialects': {}}
    for d, name in DIAL.items():
        items, seen = [], set()
        for v in vocab:
            h = v['h'].get(str(d))
            if h and h['s'] == 0 and len(h['a']) == 1 and h['w'] not in seen:
                items.append({'hanzi': h['w'], 'pinyin': h['p'], 'audio': AUDIO_BASE + h['a'][0] + '.mp3', 'zh': v['zh'], 'source': 'game_vocab'})
                seen.add(h['w'])
        pool = []
        for w, ents in dic.items():
            if w in seen or not (2 <= len(w) <= 4) or not re.fullmatch(r'[㐀-鿿\U00020000-\U0003134f]+', w):
                continue
            for e in ents:
                if e[5] != 0 or not e[0][d - 1]:
                    continue
                url = audio_url(e[1], d)
                if url:
                    pool.append({'hanzi': w, 'pinyin': e[0][d - 1], 'audio': url, 'zh': None, 'source': 'moe_dict'})
                    break
        random.Random(1000 + d).shuffle(pool)
        items += pool[:max(0, PER - len(items))]
        out['dialects'][str(d)] = {'name': name + '腔', 'items': items[:PER]}
        print(name, len(items[:PER]), '（遊戲詞', sum(1 for x in items[:PER] if x['source'] == 'game_vocab'), '）')
    json.dump(out, open(os.path.join(HERE, 'testset_dialects.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
