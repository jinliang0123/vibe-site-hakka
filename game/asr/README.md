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
python3 eval_dialects.py           # 全部六腔；或 --dialects 1,2 --limit 50 先試
```

輸出在 `results/`：`summary.md`（各腔通過率、不確定率、漢字字錯率 CER、遊戲詞通過率）與每腔明細 CSV。

**模型存取**：formospeech/whisper-large-v3-taiwanese-hakka 在 Hugging Face 需先同意條款申請存取，並在主機上 `hf auth login`。腔調提示預設用模型說明的腔調代碼（`htia_sixian`、`htia_hailu`、`htia_dapu`、`htia_raoping`、`htia_zhaoan`、`htia_nansixian`），可用環境變數 `HAKKA_PROMPT_1` … `HAKKA_PROMPT_6` 覆寫。

**授權**：此模型為 CC BY-NC 4.0，只能非商業使用。實測與研究可以；遊戲若收費或商業營運，須另洽授權或改用自有資料訓練的模型。

建議門檻：遊戲詞通過率 ≥ 85% 的腔調開放自動比對；其餘腔調先以「自己聽聽看＋社群驗證」為主。

## 3. 語音比對伺服器

```bash
cd game/asr
ALLOW_ORIGINS=https://jinliang0123.github.io uvicorn server:app --host 0.0.0.0 --port 8000
```

在遊戲「設定 › 進階」填入伺服器網址（或開 `game/?asr=https://伺服器網址`），錄音就會送到 `/check` 比對。客語用 formospeech 客語模型（CC BY-NC 4.0，非商業），國語、英語用 Whisper large-v3 turbo；評分規則在 `score.py`，與前端 `game/score.js` 相同。

正式版改由 Supabase Edge Function 轉送，並把結果寫入 `game_recordings`。
