"""載入語音辨識模型（需要 GPU 才夠快；CPU 也能跑，但一筆要數十秒）。
客語：formospeech/whisper-large-v3-taiwanese-hakka（六腔；Hugging Face 上需申請存取並登入）。
  授權為 CC BY-NC 4.0：只能非商業使用（實測、研究）。遊戲若收費或商業營運，須另洽授權或改用自有資料訓練的模型。
國語、英語：openai/whisper-large-v3-turbo。
腔調提示：依模型說明，以腔調代碼當提示（htia_sixian 等），並指定 language="Chinese"；輸出中的腔調代碼會去掉。
可用環境變數 HAKKA_PROMPT_<腔號> 覆寫。"""
import os, re, functools
HAKKA_MODEL = os.environ.get('HAKKA_MODEL', 'formospeech/whisper-large-v3-taiwanese-hakka')
GENERAL_MODEL = os.environ.get('GENERAL_MODEL', 'openai/whisper-large-v3-turbo')
DIAL = {1: '四縣', 2: '海陸', 3: '大埔', 4: '饒平', 5: '詔安', 6: '南四縣'}
DEFAULT_PROMPTS = {1: 'htia_sixian', 2: 'htia_hailu', 3: 'htia_dapu', 4: 'htia_raoping', 5: 'htia_zhaoan', 6: 'htia_nansixian'}
HAKKA_PROMPTS = {d: os.environ.get(f'HAKKA_PROMPT_{d}', DEFAULT_PROMPTS[d]) for d in DIAL}

@functools.lru_cache(maxsize=None)
def _pipe(model):
    import torch
    from transformers import pipeline
    dev = 'cuda:0' if torch.cuda.is_available() else 'cpu'
    dt = torch.float16 if dev.startswith('cuda') else torch.float32
    return pipeline('automatic-speech-recognition', model=model, torch_dtype=dt, device=dev)

def transcribe(path, lang, dialect=None):
    """回傳 (文字, 使用的模型與設定)"""
    if lang == 'hak':
        p = _pipe(HAKKA_MODEL)
        kw = {'task': 'transcribe', 'language': 'Chinese'}
        prompt = HAKKA_PROMPTS.get(int(dialect or 1), '')
        if prompt:
            kw['prompt_ids'] = p.tokenizer.get_prompt_ids(prompt, return_tensors='pt').to(p.device)
        out = p(path, generate_kwargs=kw)
        text = out['text']
        if prompt:
            text = text.replace(prompt, '')
        text = re.sub(r'htia_[a-z]+', '', text)
        return text.strip(), f'{HAKKA_MODEL} prompt={prompt!r}'
    p = _pipe(GENERAL_MODEL)
    out = p(path, generate_kwargs={'task': 'transcribe', 'language': 'zh' if lang == 'zh' else 'en'})
    return out['text'].strip(), GENERAL_MODEL
