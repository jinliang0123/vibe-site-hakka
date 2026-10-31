-- 拍照學客語（合併版 cam）：認物件＋認文字共用的會員設定、群組、我的最愛、使用者投稿、練習紀錄、管理者
-- 與「客語字音字形練習」共用同一個 Supabase 專案與會員帳號，資料表一律以 cam_ 開頭。
-- 可重複執行：資料表、函式用 if not exists / or replace，權限規則只在不存在時建立（不刪除任何東西）。
-- 舊的 objcam_*、hakkaocr_* 資料表與儲存空間不受影響，確認新站正常後再自行清除。

-- ===== 資料表 =====
create table if not exists public.cam_profiles(
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  display_name text not null default '' check (char_length(display_name)<=40),
  dialect smallint not null default 1 check (dialect between 1 and 6),
  review_gap smallint not null default 0 check (review_gap between 0 and 3),  -- 0=漸進(1→2→3天)，1~3=固定天數
  updated_at timestamptz not null default now()
);

-- 網站管理者（可看全部統計、審核投稿、匯出匯入資料）
create table if not exists public.cam_admins(
  user_id uuid primary key references auth.users on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.cam_groups(
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  join_code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
  created_at timestamptz not null default now()
);

create table if not exists public.cam_group_members(
  group_id uuid not null references public.cam_groups on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (group_id,user_id)
);
create index if not exists cam_group_members_user on public.cam_group_members(user_id);

-- 我的最愛：kind=object（認物件）或 text（認文字）
create table if not exists public.cam_favorites(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('object','text')),
  image_path text not null,
  word text not null check (char_length(word) between 1 and 60),  -- 客語漢字
  dialect smallint not null default 1 check (dialect between 1 and 6),
  pron text,                        -- 收藏時該腔調的拼音（數字調）
  zh text,                          -- 認物件：國語名稱
  zhuyin text,                      -- 認物件：注音
  concept smallint,                 -- 認物件：詞彙表索引
  label text,                       -- 認物件：辨識標籤（coco 類別、imagenet:編號 或 manual）
  ocr_text text,                    -- 認文字：照片中辨識出的全部文字
  gloss text,                       -- 認文字：辭典解釋摘要
  box real[],                       -- 認文字：文字在照片上的位置 [x,y,w,h]（0~1）
  review_count smallint not null default 0 check (review_count between 0 and 5),
  next_review_at timestamptz,
  last_review_at timestamptz,
  group_id uuid references public.cam_groups on delete set null,  -- 分享到群組相簿
  created_at timestamptz not null default now()
);
create index if not exists cam_favorites_user on public.cam_favorites(user_id,created_at desc);
create index if not exists cam_favorites_due on public.cam_favorites(user_id,next_review_at);
create index if not exists cam_favorites_group on public.cam_favorites(group_id);

-- 使用者投稿：kind=object 提供物品的客語資料（未來影像辨識的訓練資料）；kind=text 回報文字辨識或讀音錯誤
create table if not exists public.cam_contributions(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('object','text')),
  image_path text,                  -- 照片（{user_id}/contrib/{id}.jpg）
  audio_path text,                  -- 錄音（{user_id}/contrib/{id}.webm 等）
  box real[],                       -- 物品或文字在照片上的位置 [x,y,w,h]（0~1）
  dialect smallint not null default 1 check (dialect between 1 and 6),
  hanzi text not null check (char_length(hanzi) between 1 and 60),  -- 使用者提供的客語漢字
  pinyin text check (char_length(pinyin)<=200),                     -- 使用者提供的客語拼音
  zh text check (char_length(zh)<=60),                              -- 認物件：國語名稱
  concept smallint,                 -- 認物件：系統辨識（或手動選）的詞彙表索引，新物品為 null
  label text,                       -- 認物件：系統辨識標籤
  orig_text text,                   -- 認文字：系統原本辨識／顯示的文字
  orig_pron text,                   -- 認文字：系統原本顯示的拼音
  issue text check (issue in ('ocr','pron','audio','gloss','other')),  -- 認文字：錯誤類型
  note text check (char_length(note)<=500),
  status text not null default 'pending' check (status in ('pending','accepted','rejected')),
  admin_note text,
  reviewed_by uuid references auth.users on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cam_contributions_user on public.cam_contributions(user_id,created_at desc);
create index if not exists cam_contributions_status on public.cam_contributions(kind,status,created_at desc);

-- 練習紀錄：拍照辨識（scan）與完成複習（review），供統計使用
create table if not exists public.cam_activity(
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  kind text not null check (kind in ('object','text')),
  action text not null check (action in ('scan','review')),
  ref uuid,                         -- review 時為 favorite id
  created_at timestamptz not null default now()
);
create index if not exists cam_activity_user on public.cam_activity(user_id,created_at desc);

-- ===== 權限判斷（security definer 避免 RLS 互相遞迴） =====
create or replace function public.cam_is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.cam_admins where user_id=(select auth.uid()))
$$;
create or replace function public.cam_role(g uuid) returns text
language sql stable security definer set search_path='' as $$
  select role from public.cam_group_members where group_id=g and user_id=(select auth.uid())
$$;
create or replace function public.cam_shares_group(other uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.cam_group_members a join public.cam_group_members b using(group_id)
    where a.user_id=(select auth.uid()) and b.user_id=other)
$$;

alter table public.cam_profiles enable row level security;
alter table public.cam_admins enable row level security;
alter table public.cam_groups enable row level security;
alter table public.cam_group_members enable row level security;
alter table public.cam_favorites enable row level security;
alter table public.cam_contributions enable row level security;
alter table public.cam_activity enable row level security;

-- 管理者對所有 cam_ 資料表有完整權限（匯入、匯出、審核）
do $$ declare t text; begin
  foreach t in array array['cam_profiles','cam_groups','cam_group_members','cam_favorites','cam_contributions','cam_activity'] loop
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='admin_all') then
      execute format('create policy admin_all on public.%I for all to authenticated using (public.cam_is_admin()) with check (public.cam_is_admin())',t);
    end if;
  end loop;
end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_admins' and policyname='a_sel') then
create policy a_sel on public.cam_admins for select to authenticated using (user_id=(select auth.uid()) or public.cam_is_admin());
end if; end $$;

do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_profiles' and policyname='p_sel') then
create policy p_sel on public.cam_profiles for select to authenticated
  using (user_id=(select auth.uid()) or public.cam_shares_group(user_id));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_profiles' and policyname='p_ins') then
create policy p_ins on public.cam_profiles for insert to authenticated with check (user_id=(select auth.uid()));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_profiles' and policyname='p_upd') then
create policy p_upd on public.cam_profiles for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
end if; end $$;

do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_groups' and policyname='g_sel') then
create policy g_sel on public.cam_groups for select to authenticated using (public.cam_role(id) is not null);
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_groups' and policyname='g_upd') then
create policy g_upd on public.cam_groups for update to authenticated using (public.cam_role(id) in ('owner','admin'));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_groups' and policyname='g_del') then
create policy g_del on public.cam_groups for delete to authenticated using (owner_id=(select auth.uid()));
end if; end $$;

do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_group_members' and policyname='m_sel') then
create policy m_sel on public.cam_group_members for select to authenticated using (public.cam_role(group_id) is not null);
end if; end $$;
-- 自己退出（擁有者不可退出），或管理者移除一般成員；擁有者可移除任何人
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_group_members' and policyname='m_del') then
create policy m_del on public.cam_group_members for delete to authenticated using (
  (user_id=(select auth.uid()) and role<>'owner')
  or (public.cam_role(group_id)='owner' and role<>'owner')
  or (public.cam_role(group_id)='admin' and role='member'));
end if; end $$;

do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_favorites' and policyname='f_sel') then
create policy f_sel on public.cam_favorites for select to authenticated
  using (user_id=(select auth.uid()) or (group_id is not null and public.cam_role(group_id) is not null));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_favorites' and policyname='f_ins') then
create policy f_ins on public.cam_favorites for insert to authenticated
  with check (user_id=(select auth.uid()) and (group_id is null or public.cam_role(group_id) is not null));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_favorites' and policyname='f_upd') then
create policy f_upd on public.cam_favorites for update to authenticated
  using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()) and (group_id is null or public.cam_role(group_id) is not null));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_favorites' and policyname='f_del') then
create policy f_del on public.cam_favorites for delete to authenticated using (user_id=(select auth.uid()));
end if; end $$;

-- 投稿：本人可新增、查看、刪除尚未審核的投稿；審核由管理者（admin_all）處理
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_contributions' and policyname='c_sel') then
create policy c_sel on public.cam_contributions for select to authenticated using (user_id=(select auth.uid()));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_contributions' and policyname='c_ins') then
create policy c_ins on public.cam_contributions for insert to authenticated
  with check (user_id=(select auth.uid()) and status='pending' and reviewed_by is null);
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_contributions' and policyname='c_del') then
create policy c_del on public.cam_contributions for delete to authenticated using (user_id=(select auth.uid()) and status='pending');
end if; end $$;

do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_activity' and policyname='act_ins') then
create policy act_ins on public.cam_activity for insert to authenticated with check (user_id=(select auth.uid()));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='cam_activity' and policyname='act_sel') then
create policy act_sel on public.cam_activity for select to authenticated using (user_id=(select auth.uid()));
end if; end $$;

-- ===== RPC：群組 =====
create or replace function public.cam_create_group(p_name text) returns public.cam_groups
language plpgsql security definer set search_path='' as $$
declare g public.cam_groups;
begin
  if auth.uid() is null then raise exception 'NOT_LOGGED_IN'; end if;
  insert into public.cam_groups(name,owner_id) values (trim(p_name),auth.uid()) returning * into g;
  insert into public.cam_group_members(group_id,user_id,role) values (g.id,auth.uid(),'owner');
  return g;
end $$;

create or replace function public.cam_join_group(p_code text) returns public.cam_groups
language plpgsql security definer set search_path='' as $$
declare g public.cam_groups;
begin
  if auth.uid() is null then raise exception 'NOT_LOGGED_IN'; end if;
  select * into g from public.cam_groups where join_code=upper(trim(p_code));
  if g.id is null then raise exception 'CODE_NOT_FOUND'; end if;
  insert into public.cam_group_members(group_id,user_id) values (g.id,auth.uid()) on conflict do nothing;
  return g;
end $$;

create or replace function public.cam_set_role(p_group uuid,p_user uuid,p_role text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if public.cam_role(p_group) is distinct from 'owner' then raise exception 'NOT_OWNER'; end if;
  if p_role not in ('admin','member') or p_user=auth.uid() then raise exception 'BAD_ROLE'; end if;
  update public.cam_group_members set role=p_role where group_id=p_group and user_id=p_user;
end $$;

create or replace function public.cam_new_code(p_group uuid) returns text
language plpgsql security definer set search_path='' as $$
declare c text;
begin
  if coalesce(public.cam_role(p_group),'') not in ('owner','admin') then raise exception 'NOT_MANAGER'; end if;
  c:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  update public.cam_groups set join_code=c where id=p_group;
  return c;
end $$;

-- 群組成員的學習進度（群組擁有者／管理員，或網站管理者）
create or replace function public.cam_group_progress(p_group uuid)
returns table(user_id uuid,display_name text,email text,role text,fav_object int,fav_text int,favorites int,reviews int,finished int,due int,
  contrib_object int,contrib_text int,last_active timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if coalesce(public.cam_role(p_group),'') not in ('owner','admin') and not public.cam_is_admin() then raise exception 'NOT_MANAGER'; end if;
  return query
  select m.user_id, coalesce(nullif(p.display_name,''),split_part(u.email,'@',1)),
    u.email::text, m.role,
    coalesce(f.fo,0), coalesce(f.ft,0), coalesce(f.n,0), coalesce(f.rv,0), coalesce(f.fin,0), coalesce(f.due,0),
    coalesce(c.co,0), coalesce(c.ct,0),
    greatest(f.last,c.last,a.last)
  from public.cam_group_members m
  join auth.users u on u.id=m.user_id
  left join public.cam_profiles p on p.user_id=m.user_id
  left join lateral (select count(*) filter (where x.kind='object')::int fo, count(*) filter (where x.kind='text')::int ft, count(*)::int n,
      sum(x.review_count)::int rv, count(*) filter (where x.review_count>=5)::int fin,
      count(*) filter (where x.review_count<5 and x.next_review_at<=now())::int due,
      greatest(max(x.created_at),max(x.last_review_at)) last
    from public.cam_favorites x where x.user_id=m.user_id) f on true
  left join lateral (select count(*) filter (where y.kind='object')::int co, count(*) filter (where y.kind='text')::int ct, max(y.created_at) last
    from public.cam_contributions y where y.user_id=m.user_id) c on true
  left join lateral (select max(z.created_at) last from public.cam_activity z where z.user_id=m.user_id) a on true
  where m.group_id=p_group
  order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, 2;
end $$;

-- ===== RPC：網站管理者統計 =====
-- 各群組（含「未分組」）的收集與練習統計；p_days 為近期活動天數
create or replace function public.cam_admin_group_stats(p_days int default 7)
returns table(group_id uuid,group_name text,owner_email text,join_code text,created_at timestamptz,members int,
  fav_object int,fav_text int,reviews_total int,finished int,due int,
  contrib_object int,contrib_text int,contrib_pending int,
  scans_recent int,reviews_recent int,active_users_recent int,last_active timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.cam_is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
  with grp as (
    select g.id, g.name, g.owner_id, g.join_code, g.created_at from public.cam_groups g
    union all select null::uuid, '（未加入群組）', null::uuid, null::text, null::timestamptz
  ), mem as (
    select m.group_id, m.user_id from public.cam_group_members m
    union all select null::uuid, u.id from auth.users u
      where not exists(select 1 from public.cam_group_members m2 where m2.user_id=u.id)
        and (exists(select 1 from public.cam_profiles p where p.user_id=u.id)
          or exists(select 1 from public.cam_favorites f where f.user_id=u.id)
          or exists(select 1 from public.cam_contributions c where c.user_id=u.id))
  )
  select grp.id, grp.name, ou.email::text, grp.join_code, grp.created_at,
    (select count(*)::int from mem where mem.group_id is not distinct from grp.id),
    coalesce(fs.fo,0), coalesce(fs.ft,0), coalesce(fs.rv,0), coalesce(fs.fin,0), coalesce(fs.due,0),
    coalesce(cs.co,0), coalesce(cs.ct,0), coalesce(cs.cp,0),
    coalesce(acs.sc,0), coalesce(acs.rv,0), coalesce(acs.au,0),
    greatest(fs.last,cs.last,acs.last)
  from grp
  left join auth.users ou on ou.id=grp.owner_id
  left join lateral (select count(*) filter (where f.kind='object')::int fo, count(*) filter (where f.kind='text')::int ft,
      sum(f.review_count)::int rv, count(*) filter (where f.review_count>=5)::int fin,
      count(*) filter (where f.review_count<5 and f.next_review_at<=now())::int due, max(f.created_at) last
    from public.cam_favorites f where f.user_id in (select mem.user_id from mem where mem.group_id is not distinct from grp.id)) fs on true
  left join lateral (select count(*) filter (where c.kind='object')::int co, count(*) filter (where c.kind='text')::int ct,
      count(*) filter (where c.status='pending')::int cp, max(c.created_at) last
    from public.cam_contributions c where c.user_id in (select mem.user_id from mem where mem.group_id is not distinct from grp.id)) cs on true
  left join lateral (select count(*) filter (where a.action='scan')::int sc, count(*) filter (where a.action='review')::int rv,
      count(distinct a.user_id)::int au, max(a.created_at) last
    from public.cam_activity a where a.created_at>=now()-make_interval(days=>greatest(1,p_days))
      and a.user_id in (select mem.user_id from mem where mem.group_id is not distinct from grp.id)) acs on true
  order by grp.id is null, grp.created_at;
end $$;

-- 每日活動量（近 p_days 天）
create or replace function public.cam_admin_daily(p_days int default 30)
returns table(day date,scans_object int,scans_text int,reviews int,favorites int,contributions int,active_users int)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.cam_is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
  select d::date,
    (select count(*)::int from public.cam_activity a where a.created_at::date=d::date and a.action='scan' and a.kind='object'),
    (select count(*)::int from public.cam_activity a where a.created_at::date=d::date and a.action='scan' and a.kind='text'),
    (select count(*)::int from public.cam_activity a where a.created_at::date=d::date and a.action='review'),
    (select count(*)::int from public.cam_favorites f where f.created_at::date=d::date),
    (select count(*)::int from public.cam_contributions c where c.created_at::date=d::date),
    (select count(distinct a.user_id)::int from public.cam_activity a where a.created_at::date=d::date)
  from generate_series(current_date-(greatest(1,p_days)-1),current_date,interval '1 day') d
  order by 1;
end $$;

-- 所有使用者清單（含 email），供管理者對照
create or replace function public.cam_admin_users()
returns table(user_id uuid,email text,display_name text,created_at timestamptz,last_sign_in_at timestamptz,is_admin boolean,groups text)
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.cam_is_admin() then raise exception 'NOT_ADMIN'; end if;
  return query
  select u.id, u.email::text, p.display_name, u.created_at, u.last_sign_in_at,
    exists(select 1 from public.cam_admins a where a.user_id=u.id),
    (select string_agg(g.name,'、' order by g.name) from public.cam_group_members m join public.cam_groups g on g.id=m.group_id where m.user_id=u.id)
  from auth.users u left join public.cam_profiles p on p.user_id=u.id
  order by u.created_at;
end $$;

revoke execute on function public.cam_is_admin(), public.cam_role(uuid), public.cam_shares_group(uuid) from anon, public;
revoke execute on function public.cam_create_group(text), public.cam_join_group(text), public.cam_set_role(uuid,uuid,text),
  public.cam_new_code(uuid), public.cam_group_progress(uuid), public.cam_admin_group_stats(int), public.cam_admin_daily(int),
  public.cam_admin_users() from anon, public;
grant execute on function public.cam_is_admin(), public.cam_role(uuid), public.cam_shares_group(uuid), public.cam_create_group(text),
  public.cam_join_group(text), public.cam_set_role(uuid,uuid,text), public.cam_new_code(uuid), public.cam_group_progress(uuid),
  public.cam_admin_group_stats(int), public.cam_admin_daily(int), public.cam_admin_users() to authenticated;

-- ===== 照片與錄音：私有 bucket =====
-- 路徑：{user_id}/fav/{favorite_id}.jpg、{user_id}/contrib/{contribution_id}.jpg|.webm|.m4a
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('cam','cam',false,5242880,array['image/jpeg','image/webp','image/png',
  'audio/webm','audio/ogg','audio/mp4','audio/mpeg','audio/wav','audio/x-wav','audio/aac'])
on conflict (id) do nothing;

create or replace function public.cam_can_view_file(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select public.cam_is_admin() or exists(select 1 from public.cam_favorites f where f.image_path=p_name
    and (f.user_id=(select auth.uid()) or (f.group_id is not null and public.cam_role(f.group_id) is not null)))
$$;
revoke execute on function public.cam_can_view_file(text) from anon, public;
grant execute on function public.cam_can_view_file(text) to authenticated;

do $$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='cam_read') then
create policy cam_read on storage.objects for select to authenticated
  using (bucket_id='cam' and ((storage.foldername(name))[1]=(select auth.uid())::text or public.cam_can_view_file(name)));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='cam_write') then
create policy cam_write on storage.objects for insert to authenticated
  with check (bucket_id='cam' and ((storage.foldername(name))[1]=(select auth.uid())::text or public.cam_is_admin()));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='cam_update') then
create policy cam_update on storage.objects for update to authenticated
  using (bucket_id='cam' and ((storage.foldername(name))[1]=(select auth.uid())::text or public.cam_is_admin()));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='cam_remove') then
create policy cam_remove on storage.objects for delete to authenticated
  using (bucket_id='cam' and ((storage.foldername(name))[1]=(select auth.uid())::text or public.cam_is_admin()));
end if; end $$;
