# 六腔語音實測與語音比對伺服器

第 1 階段要回答一個問題：**客語自動比對準不準，哪些腔調可以先開放？**

## 1. 實測詞表

`testset_dialects.json`：六個腔調各 200 個詞，先放遊戲詞彙表裡有整詞錄音的物品（35–56 個），其餘從教育部《臺灣客語辭典》抽 2–4 字的詞補足（固定亂數種子）。錄音用辭典的示範發音。重新產生：

```bash
python3 game/asr/build_testset.py
```

辭典示範發音是「標準答案」，測的是模型的上限；長輩的真實錄音（口音、噪音、舊手機）要在社區封測時另外收集再測一次。

## 2. 跑實測（需要 GPU 主機，並能連到 huggingface.co 與 hakkadict.moe.edu.tw）

```bash
cd game/asr
pip install -r requirements.txt   # 另需 ffmpeg
python3 eval_dialects.py           # 全部六腔、兩種模式；或 --dialects 1,2 --limit 50 先試
python3 eval_dialects.py --mode closed --out results_closed   # 只跑封閉比對
```

輸出在 `--out`（預設 `results/`）：`summary.md` 與每腔明細 CSV。兩種評分方式並列：

- **自由辨識（open）**：模型寫出聽到的字，再和正確詞比對；看通過率、漢字字錯率 CER、遊戲詞通過率。
- **封閉比對（closed）**：遊戲知道玩家該說哪個詞，把正確詞和 9 個同腔干擾詞一起給模型打分，正確詞要排第一且機率 ≥ 0.6 才通過。這是遊戲實際要用的方式，通常比自由辨識準得多，也不會有幻覺重複。溫度 `ASR_CLOSED_TEMP`（預設 0.2）要用實測結果校正。

兩種模式都會先切掉錄音前後的靜音、補 0.3 秒靜音，並把輸出限制在 `ASR_MAX_NEW_TOKENS`（預設 24）個 token，避免「人 → 妮妮妮…」這種幻覺重複。評分會把簡體轉繁體（OpenCC）、收斂連續重複的字，拼音比對不看聲調。

拿一般 Whisper 當對照組（2026-11-04 已跑過一次自由辨識：通過 4–8%）：

```bash
HAKKA_MODEL=openai/whisper-large-v3 HAKKA_PROMPT_1= HAKKA_PROMPT_2= HAKKA_PROMPT_3= HAKKA_PROMPT_4= HAKKA_PROMPT_5= HAKKA_PROMPT_6= \
  python3 eval_dialects.py --out results_baseline_whisper-large-v3
```

四縣的「下女」辭典錄音已失效（404），2026-11-11 起測試詞改為「緯度」，其他 1,199 個詞不變。

**模型存取**：formospeech/whisper-large-v3-taiwanese-hakka 在 Hugging Face 需先同意條款申請存取，並在主機上 `hf auth login`。腔調提示預設用模型說明的腔調代碼（`htia_sixian`、`htia_hailu`、`htia_dapu`、`htia_raoping`、`htia_zhaoan`、`htia_nansixian`），可用環境變數 `HAKKA_PROMPT_1` … `HAKKA_PROMPT_6` 覆寫。

**授權**：此模型為 CC BY-NC 4.0，只能非商業使用。實測與研究可以；遊戲若收費或商業營運，須另洽授權或改用自有資料訓練的模型。

建議門檻：遊戲詞通過率 ≥ 85% 的腔調開放自動比對；其餘腔調先以「自己聽聽看＋社群驗證」為主。

## 3. 語音比對伺服器

```bash
cd game/asr
ALLOW_ORIGINS=https://jinliang0123.github.io uvicorn server:app --host 0.0.0.0 --port 8000
```

在遊戲「設定 › 進階」填入伺服器網址（或開 `game/?asr=https://伺服器網址`），錄音就會送到 `/check` 比對。客語錄音會一併送出同一本圖鑑的 9 個干擾詞，伺服器用封閉比對；國語、英語用自由辨識。Windows 主機也能跑（暫存檔關閉後才交給 ffmpeg）。客語用 formospeech 客語模型（CC BY-NC 4.0，非商業），國語、英語用 Whisper large-v3 turbo；評分規則在 `score.py`，與前端 `game/score.js` 相同。

正式版改由 Supabase Edge Function 轉送，並把結果寫入 `game_recordings`。
