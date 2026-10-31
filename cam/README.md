# 拍照學客語（合併版 cam）

把原本的「拍照學客語」（`objcam/`，認物件）與「拍照識客字」（`hakkaocr/`，認文字）合併成一個網站，網址為主網站下的 `/cam/`。舊網址會自動轉到新版（`/objcam/` → `?mode=object`、`/hakkaocr/` → `?mode=text`）。

## 功能

- **兩種模式**：拍照畫面上方切換「📦 認物件」與「🔤 認文字」，記住上次選擇，也可用網址 `?mode=object|text` 指定。辨識程式只在切到該模式時才下載。
  - 認物件：TensorFlow.js（COCO-SSD＋MobileNet v2），國語在照片上方、客語在下方（同原 objcam）。
  - 認文字：Tesseract.js 繁中辨識、點字挑選、黃框重新辨識、直接輸入查詢（同原 hakkaocr）。
- **共用會員、群組、我的最愛、複習**：一份個人設定（暱稱、腔調、複習間隔），一套群組與邀請碼；我的最愛可依類型篩選，複習時兩種收藏混在一起（文字收藏先看照片想唸法再翻答案）。
- **🎙️ 提供客語資料（認物件）**：使用者對照片輸入國語名稱、客語漢字、拼音，並可錄音（最長 20 秒），連同照片與物品框存進資料庫，作為未來影像辨識的訓練資料。詞彙表沒有的物品也能投稿。
- **🚩 回報錯誤（認文字）**：選錯誤類型（辨識錯字、拼音、錄音、解釋、其他），輸入正確漢字、拼音與錄音，並記下系統原本的辨識結果。
- **📮 我的投稿**：在「我的帳號」查看審核狀態、管理者回覆，可撤回尚未審核的投稿。
- **🛠️ 管理者介面**（`admin.html`，只有 `cam_admins` 裡的帳號能進入）：
  - 統計：會員、群組、收藏、投稿、近期拍照與複習數；各組（含未分組）的收集與練習統計，可點開看每位成員進度；近 30 天每日活動。全部可下載 CSV。
  - 投稿審核：依類型、狀態篩選，看照片與物品框、聽錄音、修改漢字拼音、採用／不採用／刪除、回覆投稿者。
  - 資料下載：每個資料表的 JSON／CSV；完整備份 ZIP（資料表＋照片＋錄音）；影像辨識訓練資料包（`labels.csv`、`labels.json`、`images/`、`audio/`）；客語更正清單。
  - 資料上傳：匯入完整備份 ZIP 或單一資料表 JSON，相同主鍵更新、其餘新增，不刪除既有資料。

## 檔案

| 檔案 | 說明 |
|---|---|
| `index.html`、`style.css` | 網站頁面與樣式 |
| `core.js` | 共用：設定、Supabase、發音、對話框、登入（`admin.html` 也用） |
| `mode-obj.js` | 認物件模式（詞彙表沿用 `../objcam/vocab.js`） |
| `mode-text.js` | 認文字模式（辭典沿用 `../hakkaocr/dict.json`） |
| `app.js` | 模式切換、相機、帳號、我的最愛、複習、群組、投稿與錄音 |
| `admin.html`、`admin.js` | 管理者介面 |
| `supabase/001_cam.sql` | 資料表、權限（RLS）、RPC、儲存空間，可重複執行 |

詞彙表與辭典的產生工具仍在 `objcam/tools/`、`hakkaocr/tools/`。

## 資料表（Supabase，全部以 `cam_` 開頭）

`cam_profiles` 個人設定、`cam_groups`／`cam_group_members` 群組、`cam_favorites` 我的最愛（`kind` = object／text）、`cam_contributions` 使用者投稿與錯誤回報、`cam_activity` 拍照與複習紀錄、`cam_admins` 網站管理者。照片與錄音放在私有 bucket `cam`：`{user_id}/fav/…`、`{user_id}/contrib/…`。

舊的 `objcam_*`、`hakkaocr_*` 資料表合併時都是空的，不需要搬資料；確認新站正常後可自行刪除。

## 部署

1. 在 Supabase SQL Editor 執行 `supabase/001_cam.sql`。
2. 設定網站管理者：
   ```sql
   insert into public.cam_admins(user_id) select id from auth.users where email='管理者信箱';
   ```
3. 網站隨 GitHub Pages 發布，網址 `https://<帳號>.github.io/vibe-site-hakka/cam/`。
