"""語音比對伺服器：uvicorn server:app --host 0.0.0.0 --port 8000（在 game/asr 目錄執行）
遊戲在「設定 › 進階」填入網址（或網址加 ?asr=https://…），錄音會 POST 到 /check。
欄位：audio（檔案）、lang（hak|zh|en）、dialect（1–6）、accept（JSON 字串陣列，第一個是正確詞）、pinyin（客語數字調拼音）、
      candidates（JSON 字串陣列，干擾詞；有給就用封閉比對）、mode（open|closed，預設有干擾詞就 closed）。
回傳：{transcript, score, verdict, match, model, mode, best?, candidates?}。正式版改由後端寫入 game_asr_results。"""
import json, os, tempfile
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
import asr_models as A
from score import score

app = FastAPI(title='客語尋寶家 語音比對')
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get('ALLOW_ORIGINS', 'https://jinliang0123.github.io').split(','),
                   allow_methods=['POST', 'GET'], allow_headers=['*'])

@app.get('/health')
def health():
    return {'ok': True}

@app.post('/check')
async def check(audio: UploadFile = File(...), lang: str = Form(...), dialect: str = Form(''),
                accept: str = Form('[]'), pinyin: str = Form(''), candidates: str = Form('[]'), mode: str = Form('')):
    if lang not in ('hak', 'zh', 'en'):
        return {'error': 'bad lang'}
    data = await audio.read()
    if len(data) > 2_000_000:
        return {'error': 'audio too large'}
    acc = [x for x in json.loads(accept or '[]') if x][:5]
    cand = [x for x in json.loads(candidates or '[]') if x and x not in acc][:15]
    mode = mode or ('closed' if cand and acc else 'open')
    d = int(dialect) if dialect.isdigit() else None
    suffix = os.path.splitext(audio.filename or '')[1] or '.webm'
    # Windows 上 ffmpeg 打不開「仍開著」的暫存檔，所以先關閉再讀，最後自己刪除
    f = tempfile.NamedTemporaryFile(suffix=suffix, delete=False)
    try:
        f.write(data); f.close()
        wav = A.load_audio(f.name)
        if mode == 'closed' and acc:
            r = A.score_candidates(f.name, lang, d, acc[:1] + cand, 0, audio=wav)
            return {'transcript': '', 'mode': 'closed', **r}
        text, model = A.transcribe(f.name, lang, d, audio=wav)
        return {'transcript': text, 'model': model, 'mode': 'open', **score(lang, text, acc, pinyin or None)}
    finally:
        try: os.unlink(f.name)
        except OSError: pass
