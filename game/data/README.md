# 客語尋寶家：資料表與訓練資料匯出格式（草案）

狀態：草案，**尚未套用到任何資料庫**。SQL 在 `../supabase/001_game.sql`，已在本機 PostgreSQL 16（模擬 Supabase auth／storage）實際跑過兩次，並測過權限與匯出。

## 目的

遊戲收集的照片、圈選、名稱與錄音，日後要能直接拿來訓練公司自有的客語語音模型與影像辨識模型，並能部署在台灣的專用伺服器（雲端與地端）。因此資料表只用標準 PostgreSQL，搬家時把 `auth.users` 換成自家帳號表即可。

## 資料表

| 資料表 | 內容 | 訓練用途 |
|---|---|---|
| game_consents | 每次同意或撤回都新增一筆：版本、遊戲／研究／訓練自有模型／公開展示、未成年與法定代理人確認 | 決定哪些資料可匯出 |
| game_speakers | 匿名說話者：年齡層、性別、成長地區、母語腔調、客語程度（都可不填） | 依說話者切分、分析長輩表現 |
| game_captures | 照片（去 EXIF、人臉模糊標記、SHA-256） | 影像辨識 |
| game_regions | 自動框／手畫圈／整張，0~1 相對座標 | 物件偵測框 |
| game_labels | 前三選項、建議、打字、語音輸入的名稱；影像模型 top-k；審核後的正確名稱 | 影像分類標籤 |
| game_recordings | 錄音原檔＋16 kHz FLAC、音質、瀏覽器處理設定、裝置、自選腔調與確認腔調、有沒有先聽示範、**實際說的漢字與拼音** | 語音辨識與發音評測 |
| game_asr_results | 每個模型、每個版本、自由辨識或封閉比對的結果 | 新舊模型比較 |
| game_reviews | 每位審核者一票：正確／錯誤／說了別的詞／聽不清／雜音，加上實際聽到的漢字、拼音、腔調 | 訓練標籤品質 |
| game_review_summary（view） | 票數、一致程度、顧問意見、腔調多數決 | 篩選可靠標籤 |
| game_dataset_releases／items | 每次匯出的版本與收錄的錄音 | 結果可重現；撤回時查得到受影響版本 |
| game_profiles、game_points_ledger | 遊戲設定與積分 | 不匯出 |

權限重點：玩家只看得到自己的資料；不能審自己的錄音；社群只審「同意公開或研究」且待驗證的錄音；撤回同意時，該次同意下的錄音自動標記 `withdrawn_at`，不再進審核清單或匯出。

## 匯出格式

`game_export_asr` view 只列出「同意訓練自有模型、未撤回、已有結果」的錄音。`export_dataset.py` 把它轉成 Hugging Face audiofolder 格式：

```
hakka-quest-asr-2027.03/
  README.md            筆數、時數、各腔調／年齡層／同意版本分布
  train/metadata.jsonl + *.flac
  dev/metadata.jsonl   + *.flac
  test/metadata.jsonl  + *.flac
```

metadata.jsonl 每行一筆：

```json
{"file_name":"<id>.flac","id":"<id>","speaker_id":"<匿名>","lang":"hak","dialect":1,"dialect_name":"四縣",
 "dialect_is_verified":true,"text":"機車","pinyin":"gi24 ca24","expect_text":"機車","expect_pinyin":"gi24 ca24",
 "final_verdict":"pass","listened_demo":false,"duration":1.4,"age_band":"65-74","gender":null,"region":"苗栗縣公館鄉",
 "native_dialect":1,"hakka_level":"native","device":"…","consent_version":"2026-11-v1","votes":3,"agreement":1.0,"advisor_verdict":null}
```

- `text`／`pinyin` 是**實際說的內容**：人工有填就用人工的，否則通過的錄音用預期詞。說錯詞的錄音也保留，標籤是實際說的詞。
- 載入：`datasets.load_dataset("audiofolder", data_dir="hakka-quest-asr-2027.03")`。
- 照片與圈選另匯出 COCO JSON（images／annotations／categories，categories 用 vocab.js 的國語名稱）。

## 切分與品質規則

- 同一位說話者只在一個 split（speaker_id 雜湊 80/10/10）；沒有 speaker 的錄音只進 train。split 一旦寫回資料庫就不再變，測試集跨版本可比較。
- 有人工投票的錄音，一致程度需 ≥ 2/3，或有語言顧問意見，才會匯出。
- 教育部辭典的示範錄音不放進資料集（授權不同），只當測試用。
- 匯出只帶匿名代號，不含姓名、email、帳號。

## 前端配合狀況（2026-11-11）

已完成（原型仍只存在手機，欄位已與資料表對齊）：

1. 錄音關閉 echoCancellation／noiseSuppression／autoGainControl，實際生效的設定寫進 capture_settings。
2. 記錄錄音前有沒有先聽示範（listened_demo）。
3. 設定裡新增「我的基本資料」（game_speakers，全部可不填）。
4. 新版同意書 2026-11-v1：研究、訓練公司自有模型、讓其他玩家聽三項分開勾；未滿 18 歲要勾監護人同意才能提供資料；取消或縮小同意時留紀錄，舊錄音標記 withdrawn_at。舊版只同意「改進客語辨識」的玩家，保守地只當作同意研究。
5. 「自己聽聽看」可以填「我唸的是另一種說法」（player_text、player_pinyin），社群驗證時可參考。

還沒做（要等 game_* 資料表套用到資料庫）：

6. 同意訓練的錄音上傳原檔，伺服器轉 16 kHz FLAC。
7. 社群驗證畫面（含「實際聽到的是…」欄位）與管理者審核。

## 待決定

- 審核共識規則（草案：顧問一票定案，否則至少 2 人且 ≥ 2/3 一致）與審核者資格。
- 原始音檔保存期限、撤回後刪除時限。
- 資料集日後是否對外釋出、用什麼授權。
- 同意書文字請法務確認（聲音屬個資法保護的個人資料）。
