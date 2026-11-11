"""把 game_export_asr 的資料列轉成可直接訓練的語音資料集（Hugging Face audiofolder 格式）。

用法：
  # 1) 從資料庫匯出資料列（管理者帳號或 service role）
  psql "$DATABASE_URL" -At -c "select json_agg(e) from public.game_export_asr e" > rows.json
  # 2) 把 storage 的 audio16k 資料夾下載到 audio/（路徑與 audio_16k_path 相同）
  # 3) 產生資料集
  python export_dataset.py rows.json --audio-root audio --out hakka-quest-asr-2027.03

輸出：
  {out}/train/metadata.jsonl、dev/、test/ 與各自的音檔，可用
  datasets.load_dataset("audiofolder", data_dir=out) 直接載入。
  {out}/README.md：筆數、時數、各腔調與年齡層分布、同意書版本。

切分規則：同一位說話者只會出現在一個 split（依 speaker_id 雜湊 80/10/10）；
資料列已有 split 欄位時沿用，確保之後重新匯出時測試集不變。
"""
import argparse, hashlib, json, shutil, sys
from collections import Counter, defaultdict
from pathlib import Path

DIAL = {1: '四縣', 2: '海陸', 3: '大埔', 4: '饒平', 5: '詔安', 6: '南四縣'}
KEEP = ['id', 'speaker_id', 'lang', 'dialect', 'dialect_is_verified', 'text', 'pinyin', 'expect_text', 'expect_pinyin',
        'final_verdict', 'listened_demo', 'duration', 'age_band', 'gender', 'region', 'native_dialect', 'hakka_level',
        'device', 'consent_version', 'votes', 'agreement', 'advisor_verdict']


def split_for(speaker_id, ratios=(0.8, 0.1)):
    """依 speaker_id 決定 split；沒有 speaker 的錄音一律放 train，避免污染測試集。"""
    if not speaker_id:
        return 'train'
    h = int(hashlib.sha256(speaker_id.encode()).hexdigest()[:8], 16) / 0xFFFFFFFF
    return 'train' if h < ratios[0] else 'dev' if h < ratios[0] + ratios[1] else 'test'


def usable(row, min_agreement):
    """訓練標籤要可靠：有文字、有 16k 音檔；人工驗證過的要達一致門檻。"""
    if not row.get('text') or not row.get('audio_16k_path'):
        return False
    if row.get('votes') and row.get('advisor_verdict') is None:
        # 社群投票：至少 2 票且一致程度達門檻（語言顧問一票定案）
        if row['votes'] < 2 or (row.get('agreement') or 0) < min_agreement:
            return False
    return True


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument('rows', help='game_export_asr 匯出的 JSON 陣列')
    ap.add_argument('--audio-root', required=True, help='audio_16k_path 的根目錄')
    ap.add_argument('--out', required=True)
    ap.add_argument('--lang', default='hak', help='只匯出這個語言（hak/zh/en/all）')
    ap.add_argument('--min-agreement', type=float, default=0.67)
    ap.add_argument('--dry-run', action='store_true', help='只統計，不複製音檔')
    a = ap.parse_args(argv)

    rows = json.loads(Path(a.rows).read_text(encoding='utf-8')) or []
    root, out = Path(a.audio_root), Path(a.out)
    stats = defaultdict(Counter)
    secs = Counter()
    skipped = Counter()
    files = defaultdict(list)
    seen_speakers = {}
    for r in rows:
        if a.lang != 'all' and r.get('lang') != a.lang:
            skipped['lang'] += 1; continue
        if not usable(r, a.min_agreement):
            skipped['label'] += 1; continue
        src = root / r['audio_16k_path']
        if not a.dry_run and not src.exists():
            skipped['missing_audio'] += 1; continue
        sp = r.get('split') or split_for(r.get('speaker_id'))
        if r.get('speaker_id'):
            prev = seen_speakers.setdefault(r['speaker_id'], sp)
            if prev != sp:
                sys.exit(f"說話者 {r['speaker_id']} 同時出現在 {prev} 與 {sp}，請先修正 split 欄位")
        rel = f"{r['id']}.flac"
        meta = {'file_name': rel, **{k: r.get(k) for k in KEEP}}
        meta['dialect_name'] = DIAL.get(r.get('dialect'))
        files[sp].append((src, rel, meta))
        stats[sp]['n'] += 1
        stats[sp][f"dialect:{meta['dialect_name']}"] += 1
        stats[sp][f"age:{r.get('age_band')}"] += 1
        stats[sp][f"consent:{r.get('consent_version')}"] += 1
        secs[sp] += r.get('duration') or 0

    if not a.dry_run:
        for sp, items in files.items():
            d = out / sp
            d.mkdir(parents=True, exist_ok=True)
            with open(d / 'metadata.jsonl', 'w', encoding='utf-8') as f:
                for src, rel, meta in items:
                    shutil.copy2(src, d / rel)
                    f.write(json.dumps(meta, ensure_ascii=False) + '\n')

    lines = ['# 客語尋寶家語音資料集', '', f'來源列數 {len(rows)}；略過 {dict(skipped) or 0}', '',
             '| split | 筆數 | 時數 | 分布 |', '|---|---|---|---|']
    for sp in ('train', 'dev', 'test'):
        c = stats.get(sp, Counter())
        dist = '、'.join(f'{k} {v}' for k, v in sorted(c.items()) if k != 'n')
        lines.append(f"| {sp} | {c['n']} | {secs[sp] / 3600:.2f} | {dist} |")
    lines += ['', '只含同意「訓練公司自有客語模型」且未撤回的錄音；說話者以匿名 speaker_id 表示。',
              '撤回同意後請重新匯出並刪除舊版資料集。']
    report = '\n'.join(lines) + '\n'
    if not a.dry_run:
        (out / 'README.md').write_text(report, encoding='utf-8')
    print(report)
    return stats


if __name__ == '__main__':
    main()
