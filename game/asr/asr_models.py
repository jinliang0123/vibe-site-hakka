"""載入語音辨識模型（需要 GPU 才夠快；CPU 也能跑，但一筆要數十秒）。
客語：formospeech/whisper-large-v3-taiwanese-hakka（CC BY 4.0，六腔）。
國語、英語：openai/whisper-large-v3-turbo。
腔調提示：模型說明頁有指定各腔的提示寫法，請先確認後填入 HAKKA_PROMPTS（或環境變數 HAKKA_PROMPT_<腔號>）。
未確認前預設不加提示，實測報告會記錄當時用的設定。"""
import os, functools
HAKKA_MODEL = os.environ.get('HAKKA_MODEL', 'formospeech/whisper-large-v3-taiwanese-hakka')
GENERAL_MODEL = os.environ.get('GENERAL_MODEL', 'openai/whisper-large-v3-turbo')
DIAL = {1: '四縣', 2: '海陸', 3: '大埔', 4: '饒平', 5: '詔安', 6: '南四縣'}
HAKKA_PROMPTS = {d: os.environ.get(f'HAKKA_PROMPT_{d}', '') for d in DIAL}

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
        kw = {'task': 'transcribe'}
        prompt = HAKKA_PROMPTS.get(int(dialect or 1), '')
        if prompt:
            kw['prompt_ids'] = p.tokenizer.get_prompt_ids(prompt, return_tensors='pt').to(p.device)
        out = p(path, generate_kwargs=kw)
        text = out['text']
        if prompt and text.startswith(prompt):
            text = text[len(prompt):]
        return text.strip(), f'{HAKKA_MODEL} prompt={prompt!r}'
    p = _pipe(GENERAL_MODEL)
    out = p(path, generate_kwargs={'task': 'transcribe', 'language': 'zh' if lang == 'zh' else 'en'})
    return out['text'].strip(), GENERAL_MODEL
