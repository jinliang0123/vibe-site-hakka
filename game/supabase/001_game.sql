-- 客語尋寶家：資料表草案（尚未套用到任何資料庫）
-- 目標：遊戲收集的照片、圈選、名稱、錄音與人工驗證，日後能直接拿來訓練客語語音模型與影像辨識模型。
-- 設計原則：
--   1. 說話者匿名：訓練用的 speaker 與登入帳號分開，匯出時只帶 speaker_id，不帶姓名、email。
--   2. 標籤可追溯：模型判定（game_asr_results）與人工驗證（game_reviews）分開存，保留每一次結果。
--   3. 同意逐筆綁定：每張照片、每筆錄音都記錄當時的同意書版本與用途；撤回後不再匯出。
--   4. 存原始音檔：關閉瀏覽器降噪錄音，另轉一份 16 kHz 單聲道 FLAC 給訓練用。
--   5. 只用標準 PostgreSQL＋Supabase auth；未來搬到台灣自家伺服器時，把 auth.users 換成自家帳號表即可。
-- 可重複執行：if not exists / or replace，權限規則只在不存在時建立，不刪除任何東西。
-- 與 cam_* 資料表互不影響，所有物件以 game_ 開頭。

-- ===== 管理者 =====
create table if not exists public.game_admins(
  user_id uuid primary key references auth.users on delete cascade,
  role text not null default 'admin' check (role in ('admin','advisor')),  -- advisor = 六腔語言顧問
  created_at timestamptz not null default now()
);

-- ===== 玩家設定（遊戲用，不進訓練資料） =====
create table if not exists public.game_profiles(
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  display_name text not null default '' check (char_length(display_name)<=40),
  dialect smallint not null default 1 check (dialect between 1 and 6),  -- 1四縣 2海陸 3大埔 4饒平 5詔安 6南四縣
  font_scale smallint not null default 1 check (font_scale between 1 and 3),
  points integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ===== 同意書（每次同意或變更都新增一筆，不覆寫） =====
create table if not exists public.game_consents(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  version text not null,                          -- 同意書版本，例如 2026-11-v1
  use_game boolean not null default true,         -- 遊戲功能（必要）
  use_research boolean not null default false,    -- 學術研究與模型評測
  use_train boolean not null default false,       -- 訓練公司自有的客語模型（含商業服務）
  use_public boolean not null default false,      -- 照片或錄音可公開展示（例如圖鑑、示範發音）
  is_minor boolean not null default false,
  guardian_confirmed_at timestamptz,              -- 未成年：法定代理人確認時間
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,                         -- 撤回後，相關資料不再匯出，並排入刪除
  check (not is_minor or guardian_confirmed_at is not null or not (use_train or use_public or use_research))
);
create index if not exists game_consents_user on public.game_consents(user_id,granted_at desc);

-- ===== 說話者（匿名，訓練資料只看得到這張表） =====
create table if not exists public.game_speakers(
  id uuid primary key default gen_random_uuid(),  -- 匯出用的匿名 speaker_id
  user_id uuid not null unique default auth.uid() references auth.users on delete cascade,
  age_band text check (age_band in ('<13','13-17','18-29','30-44','45-64','65-74','75+')),
  gender text check (gender in ('f','m','x')),    -- 可不填
  region text check (char_length(region)<=40),    -- 成長地區（縣市＋鄉鎮），例如 苗栗縣公館鄉
  native_dialect smallint check (native_dialect between 1 and 6),
  hakka_level text check (hakka_level in ('native','fluent','learner','beginner')),
  updated_at timestamptz not null default now()
);

-- ===== 照片 =====
create table if not exists public.game_captures(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  consent_id uuid not null references public.game_consents,
  image_path text not null,                       -- storage: game/{user_id}/photo/{id}.jpg（已去 EXIF）
  sha256 text not null check (char_length(sha256)=64),
  width integer, height integer,
  source text not null default 'camera' check (source in ('camera','album')),
  exif_stripped boolean not null default true,
  faces_blurred boolean not null default false,
  device text check (char_length(device)<=160),
  created_at timestamptz not null default now()
);
create index if not exists game_captures_user on public.game_captures(user_id,created_at desc);
create index if not exists game_captures_sha on public.game_captures(sha256);

-- ===== 圈選範圍（影像辨識訓練用） =====
create table if not exists public.game_regions(
  id uuid primary key default gen_random_uuid(),
  capture_id uuid not null references public.game_captures on delete cascade,
  kind text not null check (kind in ('auto_box','polygon','whole')),
  box real[] check (box is null or array_length(box,1)=4),  -- [x,y,w,h]，0~1 相對座標
  polygon jsonb,                                  -- [[x,y],...]，0~1 相對座標（手畫圈）
  detector_label text,                            -- 自動框：COCO 類別
  detector_score real,
  crop_path text,                                 -- storage: game/{user_id}/crop/{id}.jpg
  created_at timestamptz not null default now()
);
create index if not exists game_regions_capture on public.game_regions(capture_id);

-- ===== 名稱標籤 =====
create table if not exists public.game_labels(
  id uuid primary key default gen_random_uuid(),
  region_id uuid not null references public.game_regions on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  concept text,                                   -- 詞彙表的國語名稱（objcam/vocab.js 的 zh），新物品為 null
  free_text text check (char_length(free_text)<=60),  -- 玩家自己輸入或說出的名稱
  source text not null check (source in ('top3','suggest','typed','voice')),
  model text,                                     -- 產生選項的影像模型與版本
  topk jsonb,                                     -- [{"zh":"杯子","score":0.62},...]
  status text not null default 'player' check (status in ('player','verified','rejected')),
  verified_concept text,                          -- 審核後的正確名稱
  created_at timestamptz not null default now()
);
create index if not exists game_labels_region on public.game_labels(region_id);
create index if not exists game_labels_concept on public.game_labels(concept);

-- ===== 錄音 =====
create table if not exists public.game_recordings(
  id uuid primary key default gen_random_uuid(),
  label_id uuid references public.game_labels on delete set null,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  speaker_id uuid references public.game_speakers on delete set null,
  consent_id uuid not null references public.game_consents,
  lang text not null check (lang in ('hak','zh','en')),
  dialect_claimed smallint check (dialect_claimed between 1 and 6),   -- 玩家自選腔調
  dialect_verified smallint check (dialect_verified between 1 and 6), -- 顧問或多數審核確認的腔調
  expect_text text,                               -- 應該說的詞（客語漢字／國語／英文）
  expect_pinyin text,                             -- 客語：教育部拼音（數字調）
  attempt smallint not null default 1,
  audio_raw_path text not null,                   -- storage: game/{user_id}/audio/{id}.webm（原檔）
  audio_16k_path text,                            -- storage: game/{user_id}/audio16k/{id}.flac（伺服器轉檔）
  mime text, sample_rate integer, duration real,
  peak real, mean_rms real, voiced_ratio real,
  capture_settings jsonb,                         -- {"echoCancellation":false,"noiseSuppression":false,"autoGainControl":false}
  device text check (char_length(device)<=160),
  sha256 text not null check (char_length(sha256)=64),
  listened_demo boolean,                          -- 錄音前有沒有先聽辭典示範（會影響發音，分析時要分開）
  self_check text check (self_check in ('similar','different')),
  final_verdict text check (final_verdict in ('auto_pass','pass','fail','other_word','unusable','pending_review')),
  final_text text,                                -- 人工確認「實際說的」漢字（訓練標籤）
  final_pinyin text,                              -- 人工確認「實際說的」拼音
  split text check (split in ('train','dev','test')),  -- 匯出時依 speaker 決定，固定後不再變動
  withdrawn_at timestamptz,                       -- 同意撤回時自動填入；排入刪除，不再匯出
  created_at timestamptz not null default now()
);
create index if not exists game_recordings_user on public.game_recordings(user_id,created_at desc);
create index if not exists game_recordings_review on public.game_recordings(final_verdict,lang,dialect_claimed);
create index if not exists game_recordings_speaker on public.game_recordings(speaker_id);

-- ===== 模型判定（每次比對都留一筆，方便比較新舊模型） =====
create table if not exists public.game_asr_results(
  id bigint generated always as identity primary key,
  recording_id uuid not null references public.game_recordings on delete cascade,
  model text not null,                            -- 例如 hakka-quest-asr
  model_version text not null,                    -- 例如 2027.03-lora-v2
  mode text not null check (mode in ('open','closed')),  -- open=自由辨識，closed=與候選詞比對
  transcript text,
  pinyin text,
  score real,
  verdict text check (verdict in ('pass','unsure','fail')),
  candidates jsonb,                               -- closed 模式：[{"text":"機車","score":-1.2},...]
  latency_ms integer,
  created_at timestamptz not null default now()
);
create index if not exists game_asr_results_rec on public.game_asr_results(recording_id);

-- ===== 人工驗證（社群、管理者、語言顧問；每人每筆一票） =====
create table if not exists public.game_reviews(
  id bigint generated always as identity primary key,
  recording_id uuid not null references public.game_recordings on delete cascade,
  reviewer_id uuid not null default auth.uid() references auth.users on delete cascade,
  reviewer_role text not null default 'community' check (reviewer_role in ('community','admin','advisor')),
  verdict text not null check (verdict in ('correct','wrong','other_word','unclear','noise')),
  heard_text text check (char_length(heard_text)<=60),     -- other_word 時：實際聽到的漢字
  heard_pinyin text check (char_length(heard_pinyin)<=200),
  dialect smallint check (dialect between 1 and 6),        -- 審核者判斷的腔調
  note text check (char_length(note)<=300),
  created_at timestamptz not null default now(),
  unique (recording_id,reviewer_id)
);
create index if not exists game_reviews_rec on public.game_reviews(recording_id);

-- ===== 積分紀錄（遊戲用） =====
create table if not exists public.game_points_ledger(
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  event text not null check (event in ('name','pass','first_try','new_item','new_lang','pending','quest','review_bonus')),
  points integer not null,
  ref text,
  created_at timestamptz not null default now()
);
create index if not exists game_points_user on public.game_points_ledger(user_id,created_at desc);

-- ===== 資料集版本（每次匯出留紀錄，訓練結果可重現；撤回時查得到哪些版本收錄過） =====
create table if not exists public.game_dataset_releases(
  id uuid primary key default gen_random_uuid(),
  name text not null unique,                      -- 例如 hakka-quest-asr-2027.03
  filters jsonb,                                  -- 匯出條件：語言、一致門檻等
  counts jsonb,                                   -- 各 split 筆數與時數
  created_by uuid default auth.uid() references auth.users on delete set null,
  created_at timestamptz not null default now()
);
create table if not exists public.game_dataset_items(
  release_id uuid not null references public.game_dataset_releases on delete cascade,
  recording_id uuid not null references public.game_recordings on delete cascade,
  split text not null check (split in ('train','dev','test')),
  primary key (release_id,recording_id)
);
create index if not exists game_dataset_items_rec on public.game_dataset_items(recording_id);

-- 撤回同意：該次同意下的錄音自動標記 withdrawn_at
create or replace function public.game_on_consent_revoke() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    update public.game_recordings set withdrawn_at=new.revoked_at where consent_id=new.id and withdrawn_at is null;
  end if;
  return new;
end $$;
do $$ begin if not exists(select 1 from pg_trigger where tgname='game_consent_revoke') then
create trigger game_consent_revoke after update of revoked_at on public.game_consents
  for each row execute function public.game_on_consent_revoke();
end if; end $$;

-- ===== 權限 =====
create or replace function public.game_is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.game_admins where user_id=(select auth.uid()))
$$;

-- 錄音目前是否可用於某用途（同意未撤回）
create or replace function public.game_consent_ok(c uuid, purpose text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.game_consents k where k.id=c and k.revoked_at is null and
    case purpose when 'train' then k.use_train when 'research' then k.use_research
                 when 'public' then k.use_public else k.use_game end)
$$;

do $$ declare t text; begin
  foreach t in array array['game_admins','game_profiles','game_consents','game_speakers','game_captures','game_regions',
    'game_labels','game_recordings','game_asr_results','game_reviews','game_points_ledger','game_dataset_releases','game_dataset_items'] loop
    execute format('alter table public.%I enable row level security',t);
    if t<>'game_admins' and not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='admin_all') then
      execute format('create policy admin_all on public.%I for all to authenticated using (public.game_is_admin()) with check (public.game_is_admin())',t);
    end if;
  end loop;
end $$;

do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='game_admins' and policyname='a_sel') then
create policy a_sel on public.game_admins for select to authenticated using (user_id=(select auth.uid()) or public.game_is_admin());
end if; end $$;

-- 自己的資料：可看、可新增；同意書與說話者資料可修改（撤回＝更新 revoked_at）
do $$ declare t text; begin
  foreach t in array array['game_profiles','game_consents','game_speakers','game_captures','game_labels','game_recordings','game_points_ledger'] loop
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='own_sel') then
      execute format('create policy own_sel on public.%I for select to authenticated using (user_id=(select auth.uid()))',t);
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='own_ins') then
      execute format('create policy own_ins on public.%I for insert to authenticated with check (user_id=(select auth.uid()))',t);
    end if;
  end loop;
  foreach t in array array['game_profiles','game_consents','game_speakers'] loop
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='own_upd') then
      execute format('create policy own_upd on public.%I for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()))',t);
    end if;
  end loop;
end $$;

-- 圈選範圍跟著照片走
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='game_regions' and policyname='own_sel') then
create policy own_sel on public.game_regions for select to authenticated
  using (exists(select 1 from public.game_captures c where c.id=capture_id and c.user_id=(select auth.uid())));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='game_regions' and policyname='own_ins') then
create policy own_ins on public.game_regions for insert to authenticated
  with check (exists(select 1 from public.game_captures c where c.id=capture_id and c.user_id=(select auth.uid())));
end if; end $$;

-- 模型判定：只能看自己錄音的結果；寫入由語音伺服器用 service role 處理
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='game_asr_results' and policyname='own_sel') then
create policy own_sel on public.game_asr_results for select to authenticated
  using (exists(select 1 from public.game_recordings r where r.id=recording_id and r.user_id=(select auth.uid())));
end if; end $$;

-- 是否可審這筆錄音：別人的、待驗證、同意公開或研究（security definer，避免被錄音表的 RLS 擋住）
create or replace function public.game_can_review(rec uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.game_recordings r where r.id=rec and r.user_id<>(select auth.uid())
    and r.final_verdict='pending_review' and r.withdrawn_at is null
    and (public.game_consent_ok(r.consent_id,'public') or public.game_consent_ok(r.consent_id,'research')))
$$;

-- 社群驗證：只能審別人的、待驗證、且同意公開或研究的錄音；不能審自己的
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='game_reviews' and policyname='rv_ins') then
create policy rv_ins on public.game_reviews for insert to authenticated with check (
  reviewer_id=(select auth.uid()) and
  (reviewer_role='community' or public.game_is_admin()) and public.game_can_review(recording_id));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='game_reviews' and policyname='rv_sel') then
create policy rv_sel on public.game_reviews for select to authenticated using (reviewer_id=(select auth.uid()));
end if; end $$;

-- 待驗證清單（給社群驗證畫面；不含帳號資訊）
create or replace function public.game_review_queue(lim integer default 20)
returns table(recording_id uuid, lang text, dialect smallint, expect_text text, expect_pinyin text, audio_raw_path text, duration real)
language sql stable security definer set search_path='' as $$
  select r.id,r.lang,r.dialect_claimed,r.expect_text,r.expect_pinyin,r.audio_raw_path,r.duration
  from public.game_recordings r
  where r.final_verdict='pending_review' and r.user_id<>(select auth.uid())
    and (public.game_consent_ok(r.consent_id,'public') or public.game_consent_ok(r.consent_id,'research'))
    and not exists(select 1 from public.game_reviews v where v.recording_id=r.id and v.reviewer_id=(select auth.uid()))
  order by (select count(*) from public.game_reviews v where v.recording_id=r.id), r.created_at
  limit least(greatest(lim,1),50)
$$;

-- 驗證彙整：票數、一致程度、顧問意見
create or replace view public.game_review_summary with (security_invoker=true) as
select r.id as recording_id,
  count(v.*) as votes,
  count(*) filter (where v.verdict='correct') as correct,
  count(*) filter (where v.verdict in ('wrong','other_word')) as wrong,
  count(*) filter (where v.verdict in ('unclear','noise')) as unusable,
  case when count(v.*)=0 then null else
    greatest(count(*) filter (where v.verdict='correct'),
             count(*) filter (where v.verdict in ('wrong','other_word')),
             count(*) filter (where v.verdict in ('unclear','noise')))::real/count(v.*) end as agreement,
  (array_agg(v.verdict order by v.created_at desc) filter (where v.reviewer_role='advisor'))[1] as advisor_verdict,
  mode() within group (order by v.dialect) filter (where v.dialect is not null) as dialect_vote
from public.game_recordings r left join public.game_reviews v on v.recording_id=r.id
group by r.id;

-- ===== 訓練資料匯出（只有管理者；同意 use_train 且未撤回、已確認內容的錄音） =====
create or replace view public.game_export_asr with (security_invoker=true) as
select r.id, r.speaker_id, r.lang,
  coalesce(r.dialect_verified, r.dialect_claimed) as dialect,
  r.dialect_verified is not null as dialect_is_verified,
  coalesce(r.final_text, case when r.final_verdict in ('auto_pass','pass') then r.expect_text end) as text,
  coalesce(r.final_pinyin, case when r.final_verdict in ('auto_pass','pass') then r.expect_pinyin end) as pinyin,
  r.expect_text, r.expect_pinyin, r.final_verdict, r.listened_demo,
  r.audio_16k_path, r.audio_raw_path, r.duration, r.sample_rate, r.mean_rms, r.voiced_ratio, r.capture_settings, r.device,
  s.age_band, s.gender, s.region, s.native_dialect, s.hakka_level,
  k.version as consent_version, r.split, r.created_at,
  q.votes, q.agreement, q.advisor_verdict
from public.game_recordings r
join public.game_consents k on k.id=r.consent_id
left join public.game_speakers s on s.id=r.speaker_id
left join public.game_review_summary q on q.recording_id=r.id
where k.use_train and k.revoked_at is null and r.withdrawn_at is null
  and r.final_verdict in ('auto_pass','pass','fail','other_word');

-- ===== 儲存空間（私有） =====
insert into storage.buckets(id,name,public) values ('game','game',false) on conflict (id) do nothing;
do $$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='game_own_ins') then
create policy game_own_ins on storage.objects for insert to authenticated
  with check (bucket_id='game' and (storage.foldername(name))[1]=(select auth.uid())::text);
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='game_own_sel') then
create policy game_own_sel on storage.objects for select to authenticated
  using (bucket_id='game' and ((storage.foldername(name))[1]=(select auth.uid())::text or public.game_is_admin()));
end if; end $$;
create or replace function public.game_can_review_path(p text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.game_recordings r where r.audio_raw_path=p and public.game_can_review(r.id))
$$;
-- 社群驗證者可聽待驗證錄音（同意公開或研究）；路徑必須是 game_recordings 裡登記的原檔
do $$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='game_review_sel') then
create policy game_review_sel on storage.objects for select to authenticated
  using (bucket_id='game' and public.game_can_review_path(name));
end if; end $$;
