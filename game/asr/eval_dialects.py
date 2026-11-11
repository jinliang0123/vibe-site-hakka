"""六腔語音實測：python3 eval_dialects.py [--dialects 1,2,...] [--limit 200] [--mode open|closed|both] [--out results]
讀 testset_dialects.json，下載教育部辭典示範錄音，用客語模型評分：
- open（自由辨識）：模型自己寫出聽到的字，再和正確詞比對（漢字字錯率 CER、通過率）。
- closed（封閉比對）：遊戲知道玩家該說哪個詞，把正確詞和 9 個同腔干擾詞一起給模型打分，看正確詞是否勝出。
  干擾詞優先選字數相同的詞，固定亂數種子，可重現。
通過率規則與遊戲相同；上線門檻建議「遊戲詞通過率 ≥ 85%」。
結果寫到 --out 資料夾：每腔明細 CSV 與 summary.md。需要能連到 hakkadict.moe.edu.tw 與 huggingface.co。
拿一般 Whisper 當對照組：HAKKA_MODEL=openai/whisper-large-v3 並把 HAKKA_PROMPT_1..6 設成空字串。"""
import argparse, csv, json, os, random, time, urllib.request
import asr_models as A
from score import score, lev, norm_zh

HERE = os.path.dirname(os.path.abspath(__file__))

def fetch(url, cache):
    os.makedirs(cache, exist_ok=True)
    p = os.path.join(cache, url.rsplit('/', 1)[1])
    if not os.path.exists(p):
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=30) as r, open(p, 'wb') as f:
            f.write(r.read())
    return p

def distractors(item, pool, k, seed):
    """同腔、不同詞的干擾詞；優先字數相同。"""
    others = [x['hanzi'] for x in pool if x['hanzi'] != item['hanzi']]
    same = [w for w in others if len(w) == len(item['hanzi'])]
    rest = [w for w in others if len(w) != len(item['hanzi'])]
    rnd = random.Random(seed)
    rnd.shuffle(same); rnd.shuffle(rest)
    return (same + rest)[:k]

def rate(rows, key):
    ok = [r for r in rows if r.get(key) not in (None, '', 'error')]
    n = max(1, len(ok))
    game = [r for r in ok if r['source'] == 'game_vocab']
    return {'n': len(ok), 'pass': sum(r[key] == 'pass' for r in ok) / n, 'unsure': sum(r[key] == 'unsure' for r in ok) / n,
            'fail': sum(r[key] == 'fail' for r in ok) / n, 'game_pass': sum(r[key] == 'pass' for r in game) / max(1, len(game))}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dialects', default='1,2,3,4,5,6')
    ap.add_argument('--limit', type=int, default=200)
    ap.add_argument('--mode', default='both', choices=['open', 'closed', 'both'])
    ap.add_argument('--distractors', type=int, default=9)
    ap.add_argument('--out', default=os.path.join(HERE, 'results'))
    ap.add_argument('--audio-cache', default=os.path.join(HERE, 'results', 'audio'))
    a = ap.parse_args()
    ts = json.load(open(os.path.join(HERE, 'testset_dialects.json'), encoding='utf-8'))
    os.makedirs(a.out, exist_ok=True)
    do_open, do_closed = a.mode in ('open', 'both'), a.mode in ('closed', 'both')
    summary = []
    for d in [int(x) for x in a.dialects.split(',')]:
        pool = ts['dialects'][str(d)]['items']
        items = pool[:a.limit]
        rows, errs, chars, t0 = [], 0, 0, time.time()
        for i, it in enumerate(items):
            row = {**it, 'transcript': '', 'open_score': '', 'open_verdict': '', 'closed_score': '', 'closed_verdict': '',
                   'closed_best': '', 'distractors': '', 'error': ''}
            try:
                path = fetch(it['audio'], a.audio_cache)
                audio = A.load_audio(path)
                if do_open:
                    text, _ = A.transcribe(path, 'hak', d, audio=audio)
                    r = score('hak', text, [it['hanzi']], it['pinyin'])
                    ref, hyp = norm_zh(it['hanzi']), norm_zh(text)
                    errs += lev(ref, hyp); chars += len(ref)
                    row.update(transcript=text, open_score=r['score'], open_verdict=r['verdict'])
                if do_closed:
                    ds = distractors(it, pool, a.distractors, 7000 * d + i)
                    r = A.score_candidates(path, 'hak', d, [it['hanzi']] + ds, 0, audio=audio)
                    row.update(closed_score=r['score'], closed_verdict=r['verdict'], closed_best=r['best'], distractors='、'.join(ds))
            except Exception as e:
                row.update(open_verdict='error' if do_open else '', closed_verdict='error' if do_closed else '', error=str(e)[:200])
            rows.append(row)
        with open(os.path.join(a.out, f'dialect_{d}.csv'), 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
        s = {'d': d, 'name': A.DIAL[d], 'errors': sum(bool(r['error']) for r in rows), 'sec': time.time() - t0,
             'cer': errs / max(1, chars) if do_open else None,
             'open': rate(rows, 'open_verdict') if do_open else None, 'closed': rate(rows, 'closed_verdict') if do_closed else None}
        summary.append(s); print(json.dumps(s, ensure_ascii=False))
    with open(os.path.join(a.out, 'summary.md'), 'w', encoding='utf-8') as f:
        f.write(f'# 六腔語音實測結果\n\n模型：{A.HAKKA_MODEL}　腔調提示：{A.HAKKA_PROMPTS}　輸出上限 {A.MAX_NEW_TOKENS} token\n\n')
        if do_open:
            f.write('## 自由辨識（open）\n\n| 腔調 | 筆數 | 通過 | 不確定 | 不通過 | 漢字 CER | 遊戲詞通過 | 失敗 |\n|---|---|---|---|---|---|---|---|\n')
            for s in summary:
                o = s['open']
                f.write(f"| {s['name']} | {o['n']} | {o['pass']:.0%} | {o['unsure']:.0%} | {o['fail']:.0%} | {s['cer']:.1%} | {o['game_pass']:.0%} | {s['errors']} |\n")
        if do_closed:
            f.write(f'\n## 封閉比對（closed，正確詞＋{a.distractors} 個干擾詞，溫度 {A.CLOSED_TEMP}）\n\n| 腔調 | 筆數 | 通過 | 不確定 | 不通過 | 遊戲詞通過 |\n|---|---|---|---|---|---|\n')
            for s in summary:
                c = s['closed']
                f.write(f"| {s['name']} | {c['n']} | {c['pass']:.0%} | {c['unsure']:.0%} | {c['fail']:.0%} | {c['game_pass']:.0%} |\n")
        f.write('\n上線門檻建議：遊戲詞通過率 ≥ 85% 的腔調開放自動比對；不足的腔調以社群驗證為主。\n')

if __name__ == '__main__':
    main()
