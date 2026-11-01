"""語音比對伺服器：uvicorn server:app --host 0.0.0.0 --port 8000（在 game/asr 目錄執行）
遊戲在「設定 › 進階」填入網址（或網址加 ?asr=https://…），錄音會 POST 到 /check。
欄位：audio（檔案）、lang（hak|zh|en）、dialect（1–6）、accept（JSON 字串陣列）、pinyin（客語數字調拼音）。
回傳：{transcript, score, verdict, match, model}。正式版改由 Supabase Edge Function 轉送並寫入 game_recordings。"""
import json, os, tempfile
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from asr_models import transcribe
from score import score

app = FastAPI(title='客語尋寶家 語音比對')
app.add_middleware(CORSMiddleware, allow_origins=os.environ.get('ALLOW_ORIGINS', 'https://jinliang0123.github.io').split(','),
                   allow_methods=['POST', 'GET'], allow_headers=['*'])

@app.get('/health')
def health():
    return {'ok': True}

@app.post('/check')
async def check(audio: UploadFile = File(...), lang: str = Form(...), dialect: str = Form(''),
                accept: str = Form('[]'), pinyin: str = Form('')):
    if lang not in ('hak', 'zh', 'en'):
        return {'error': 'bad lang'}
    data = await audio.read()
    if len(data) > 2_000_000:
        return {'error': 'audio too large'}
    suffix = os.path.splitext(audio.filename or '')[1] or '.webm'
    with tempfile.NamedTemporaryFile(suffix=suffix) as f:
        f.write(data); f.flush()
        text, model = transcribe(f.name, lang, int(dialect) if dialect.isdigit() else None)
    r = score(lang, text, json.loads(accept or '[]'), pinyin or None)
    return {'transcript': text, 'model': model, **r}
