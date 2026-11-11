"""載入語音辨識模型（需要 GPU 才夠快；CPU 也能跑，但一筆要數十秒）。
客語：formospeech/whisper-large-v3-taiwanese-hakka（六腔；Hugging Face 上需申請存取並登入）。
  授權為 CC BY-NC 4.0：只能非商業使用（實測、研究）。遊戲若收費或商業營運，須另洽授權或改用自有資料訓練的模型。
國語、英語：openai/whisper-large-v3-turbo。
腔調提示：依模型說明，以腔調代碼當提示（htia_sixian 等），並指定 language="Chinese"；輸出中的腔調代碼會去掉。
可用環境變數 HAKKA_PROMPT_<腔號> 覆寫（設成空字串＝不加提示，例如拿一般 Whisper 當對照組時）。

兩種用法：
- transcribe()：自由辨識（open）。加了輸出長度上限，並先切掉前後靜音、補一小段靜音，避免單字詞「幻覺重複」。
- score_candidates()：封閉比對（closed）。遊戲知道玩家該說哪個詞，只問「這段錄音最像候選詞中的哪一個」：
  對每個候選詞算模型的平均對數機率，正確詞要排第一且明顯勝過干擾詞才算通過。不必重新訓練模型。"""
import os, re, math, functools
import numpy as np

HAKKA_MODEL = os.environ.get('HAKKA_MODEL', 'formospeech/whisper-large-v3-taiwanese-hakka')
GENERAL_MODEL = os.environ.get('GENERAL_MODEL', 'openai/whisper-large-v3-turbo')
DIAL = {1: '四縣', 2: '海陸', 3: '大埔', 4: '饒平', 5: '詔安', 6: '南四縣'}
DEFAULT_PROMPTS = {1: 'htia_sixian', 2: 'htia_hailu', 3: 'htia_dapu', 4: 'htia_raoping', 5: 'htia_zhaoan', 6: 'htia_nansixian'}
HAKKA_PROMPTS = {d: os.environ.get(f'HAKKA_PROMPT_{d}', DEFAULT_PROMPTS[d]) for d in DIAL}
SR = 16000
MAX_NEW_TOKENS = int(os.environ.get('ASR_MAX_NEW_TOKENS', '24'))   # 遊戲詞 1–4 字，24 個 token 綽綽有餘
CLOSED_TEMP = float(os.environ.get('ASR_CLOSED_TEMP', '0.2'))      # 封閉比對的 softmax 溫度，實測後校正


# ---------- 音訊前處理 ----------
def load_audio(path):
    """用 ffmpeg 讀成 16 kHz 單聲道 float32（webm、mp3、wav 都可以）。"""
    from transformers.pipelines.audio_utils import ffmpeg_read
    with open(path, 'rb') as f:
        return ffmpeg_read(f.read(), SR)

def trim_pad(x, sr=SR, thresh_db=-40.0, pad_s=0.3, win_s=0.02):
    """切掉前後靜音（以最大音量為基準 -40 dB），再前後各補 0.3 秒靜音。"""
    x = np.asarray(x, dtype=np.float32)
    if x.size == 0:
        return x
    w = max(1, int(sr * win_s))
    n = len(x) // w
    if n == 0:
        return x
    rms = np.sqrt(np.mean(x[:n * w].reshape(n, w) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms / (rms.max() + 1e-12))
    voiced = np.where(db > thresh_db)[0]
    if voiced.size:
        x = x[max(0, voiced[0] * w - w):min(len(x), (voiced[-1] + 2) * w)]
    pad = np.zeros(int(sr * pad_s), dtype=np.float32)
    return np.concatenate([pad, x, pad])


# ---------- 模型 ----------
@functools.lru_cache(maxsize=None)
def _load(model):
    import torch
    from transformers import WhisperForConditionalGeneration, WhisperProcessor
    dev = 'cuda:0' if torch.cuda.is_available() else 'cpu'
    dt = torch.float16 if dev.startswith('cuda') else torch.float32
    proc = WhisperProcessor.from_pretrained(model)
    m = WhisperForConditionalGeneration.from_pretrained(model, torch_dtype=dt).to(dev).eval()
    return m, proc

def _setting(lang, dialect):
    if lang == 'hak':
        return HAKKA_MODEL, 'chinese', HAKKA_PROMPTS.get(int(dialect or 1), '')
    return GENERAL_MODEL, ('chinese' if lang == 'zh' else 'english'), ''

def _features(m, proc, audio):
    feats = proc.feature_extractor(audio, sampling_rate=SR, return_tensors='pt').input_features
    return feats.to(m.device, dtype=m.dtype)

def _clean(text, prompt):
    if prompt:
        text = text.replace(prompt, '')
    return re.sub(r'htia_[a-z]+', '', text).strip()

def transcribe(path, lang, dialect=None, audio=None):
    """自由辨識。回傳 (文字, 使用的模型與設定)。"""
    import torch
    model, language, prompt = _setting(lang, dialect)
    m, proc = _load(model)
    audio = trim_pad(load_audio(path) if audio is None else audio)
    kw = {'task': 'transcribe', 'language': language, 'max_new_tokens': MAX_NEW_TOKENS}
    if prompt:
        kw['prompt_ids'] = torch.tensor(proc.tokenizer.get_prompt_ids(prompt), device=m.device)
    with torch.no_grad():
        ids = m.generate(_features(m, proc, audio), **kw)
    text = proc.tokenizer.batch_decode(ids, skip_special_tokens=True)[0]
    return _clean(text, prompt), f'{model} prompt={prompt!r} max_new_tokens={MAX_NEW_TOKENS}'


# ---------- 封閉比對 ----------
def _prefix_ids(tok, language, prompt):
    """解碼器開頭：[提示] <|startoftranscript|> <|語言|> <|transcribe|> <|notimestamps|>"""
    ids = list(tok.get_prompt_ids(prompt)) if prompt else []
    ids += tok.convert_tokens_to_ids(['<|startoftranscript|>', f'<|{_lang_code(language)}|>', '<|transcribe|>', '<|notimestamps|>'])
    return ids

def _lang_code(language):
    return {'chinese': 'zh', 'english': 'en'}.get(language, language)

def candidate_logprobs(m, tok, feats, prefix, candidates):
    """每個候選詞的平均對數機率（含結尾符號）。編碼器只跑一次。"""
    import torch
    with torch.no_grad():
        enc = m.get_encoder()(feats)
        out = []
        for c in candidates:
            target = tok.encode(c, add_special_tokens=False) + [tok.eos_token_id]
            ids = torch.tensor([prefix + target], device=feats.device)
            logits = m(encoder_outputs=enc, decoder_input_ids=ids[:, :-1]).logits[0].float()
            lp = torch.log_softmax(logits, dim=-1)
            pos = torch.arange(len(prefix) - 1, ids.shape[1] - 1, device=feats.device)
            tl = lp[pos, ids[0, len(prefix):]]
            out.append(float(tl.mean()))
    return out

def closed_verdict(scores, target_index=0, temp=None):
    """把候選詞分數換成「是正確詞的機率」：softmax(平均對數機率 ÷ 溫度)。
    通過：正確詞排第一且機率 ≥ 0.6；不確定：機率 ≥ 0.3 或排第一；其餘不通過。"""
    temp = temp or CLOSED_TEMP
    mx = max(scores)
    ex = [math.exp((s - mx) / temp) for s in scores]
    z = sum(ex)
    probs = [e / z for e in ex]
    p = probs[target_index]
    top = max(range(len(scores)), key=lambda i: scores[i])
    if top == target_index and p >= 0.6:
        v = 'pass'
    elif p >= 0.3 or top == target_index:
        v = 'unsure'
    else:
        v = 'fail'
    return round(p, 3), v, probs, top

def score_candidates(path, lang, dialect, candidates, target_index=0, audio=None):
    """封閉比對。candidates[target_index] 是正確詞，其他是干擾詞（同類別的其他物品）。
    回傳 dict：score（正確詞機率）、verdict、best（模型最傾向的候選詞）、candidates（每個詞的分數）、model。"""
    model, language, prompt = _setting(lang, dialect)
    m, proc = _load(model)
    audio = trim_pad(load_audio(path) if audio is None else audio)
    lps = candidate_logprobs(m, proc.tokenizer, _features(m, proc, audio), _prefix_ids(proc.tokenizer, language, prompt), candidates)
    p, v, probs, top = closed_verdict(lps, target_index)
    return {'score': p, 'verdict': v, 'best': candidates[top], 'match': candidates[target_index] if v == 'pass' else '',
            'candidates': [{'text': c, 'logprob': round(l, 4), 'prob': round(q, 4)} for c, l, q in zip(candidates, lps, probs)],
            'model': f'{model} prompt={prompt!r} closed temp={CLOSED_TEMP}'}
