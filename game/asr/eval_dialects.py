"""六腔語音實測：python3 eval_dialects.py [--dialects 1,2,...] [--limit 200]
讀 testset_dialects.json，下載教育部辭典示範錄音，用客語模型辨識，計算：
- 通過率（score ≥ 0.8，與遊戲相同規則）、不確定率、不通過率
- 漢字字錯率 CER
結果寫到 results/：每筆明細 CSV 與 summary.md。需要能連到 hakkadict.moe.edu.tw 與 huggingface.co。"""
import argparse, csv, json, os, time, urllib.request
from asr_models import transcribe, HAKKA_MODEL, HAKKA_PROMPTS, DIAL
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

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dialects', default='1,2,3,4,5,6')
    ap.add_argument('--limit', type=int, default=200)
    a = ap.parse_args()
    ts = json.load(open(os.path.join(HERE, 'testset_dialects.json'), encoding='utf-8'))
    out = os.path.join(HERE, 'results'); os.makedirs(out, exist_ok=True)
    summary = []
    for d in [int(x) for x in a.dialects.split(',')]:
        items = ts['dialects'][str(d)]['items'][:a.limit]
        rows, errs, chars = [], 0, 0
        t0 = time.time()
        for it in items:
            try:
                path = fetch(it['audio'], os.path.join(out, 'audio'))
                text, model = transcribe(path, 'hak', d)
            except Exception as e:
                rows.append({**it, 'transcript': '', 'score': '', 'verdict': 'error', 'error': str(e)[:200]}); continue
            r = score('hak', text, [it['hanzi']], it['pinyin'])
            ref, hyp = norm_zh(it['hanzi']), norm_zh(text)
            errs += lev(ref, hyp); chars += len(ref)
            rows.append({**it, 'transcript': text, 'score': r['score'], 'verdict': r['verdict'], 'error': ''})
        with open(os.path.join(out, f'dialect_{d}.csv'), 'w', newline='', encoding='utf-8-sig') as f:
            w = csv.DictWriter(f, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
        ok = [r for r in rows if r['verdict'] != 'error']
        n = max(1, len(ok))
        s = {'d': d, 'name': DIAL[d], 'n': len(ok), 'errors': len(rows) - len(ok),
             'pass': sum(r['verdict'] == 'pass' for r in ok) / n, 'unsure': sum(r['verdict'] == 'unsure' for r in ok) / n,
             'fail': sum(r['verdict'] == 'fail' for r in ok) / n, 'cer': errs / max(1, chars),
             'game_pass': (lambda g: sum(r['verdict'] == 'pass' for r in g) / max(1, len(g)))([r for r in ok if r['source'] == 'game_vocab']),
             'sec': time.time() - t0}
        summary.append(s); print(s)
    with open(os.path.join(out, 'summary.md'), 'w', encoding='utf-8') as f:
        f.write(f'# 六腔語音實測結果\n\n模型：{HAKKA_MODEL}　腔調提示：{HAKKA_PROMPTS}\n\n')
        f.write('| 腔調 | 筆數 | 通過 | 不確定 | 不通過 | 漢字 CER | 遊戲詞通過 | 下載或辨識失敗 |\n|---|---|---|---|---|---|---|---|\n')
        for s in summary:
            f.write(f"| {s['name']} | {s['n']} | {s['pass']:.0%} | {s['unsure']:.0%} | {s['fail']:.0%} | {s['cer']:.1%} | {s['game_pass']:.0%} | {s['errors']} |\n")
        f.write('\n上線門檻建議：遊戲詞通過率 ≥ 85% 的腔調開放自動比對；不足的腔調以社群驗證為主。\n')

if __name__ == '__main__':
    main()
