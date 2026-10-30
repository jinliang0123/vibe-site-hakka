-- 拍照識客字（hakkaocr）：個人資料、群組、我的最愛、照片儲存
-- 與「客語字音字形練習」共用同一個 Supabase 專案與會員帳號，資料表一律以 hakkaocr_ 開頭。
-- 可重複執行：資料表、函式用 if not exists / or replace，權限規則只在不存在時建立（不刪除任何東西）。

create table if not exists public.hakkaocr_profiles(
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  display_name text not null default '' check (char_length(display_name)<=40),
  dialect smallint not null default 1 check (dialect between 1 and 6),
  review_gap smallint not null default 0 check (review_gap between 0 and 3),  -- 0=漸進(1→2→3天)，1~3=固定天數
  updated_at timestamptz not null default now()
);

create table if not exists public.hakkaocr_groups(
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  join_code text not null unique default upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
  created_at timestamptz not null default now()
);

create table if not exists public.hakkaocr_group_members(
  group_id uuid not null references public.hakkaocr_groups on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  role text not null default 'member' check (role in ('owner','admin','member')),
  joined_at timestamptz not null default now(),
  primary key (group_id,user_id)
);
create index if not exists hakkaocr_group_members_user on public.hakkaocr_group_members(user_id);

create table if not exists public.hakkaocr_favorites(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  image_path text not null,
  ocr_text text,                    -- 影像辨識出的全部文字
  word text not null check (char_length(word) between 1 and 60),  -- 選定（可手動修正）的客語漢字
  dialect smallint not null default 1 check (dialect between 1 and 6),
  pron text,                        -- 收藏時該腔調的拼音（數字調）
  gloss text,                       -- 收藏時的辭典解釋摘要
  box real[],                       -- 文字在照片上的位置 [x,y,w,h]（0~1）
  review_count smallint not null default 0 check (review_count between 0 and 5),
  next_review_at timestamptz,
  last_review_at timestamptz,
  group_id uuid references public.hakkaocr_groups on delete set null,  -- 分享到群組相簿
  created_at timestamptz not null default now()
);
create index if not exists hakkaocr_favorites_user on public.hakkaocr_favorites(user_id,created_at desc);
create index if not exists hakkaocr_favorites_due on public.hakkaocr_favorites(user_id,next_review_at);
create index if not exists hakkaocr_favorites_group on public.hakkaocr_favorites(group_id);

-- 權限判斷（security definer 避免 RLS 互相遞迴）
create or replace function public.hakkaocr_role(g uuid) returns text
language sql stable security definer set search_path='' as $$
  select role from public.hakkaocr_group_members where group_id=g and user_id=(select auth.uid())
$$;
create or replace function public.hakkaocr_shares_group(other uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.hakkaocr_group_members a join public.hakkaocr_group_members b using(group_id)
    where a.user_id=(select auth.uid()) and b.user_id=other)
$$;

alter table public.hakkaocr_profiles enable row level security;
alter table public.hakkaocr_groups enable row level security;
alter table public.hakkaocr_group_members enable row level security;
alter table public.hakkaocr_favorites enable row level security;

do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='hakkaocr_profiles' and policyname='p_sel') then
create policy p_sel on public.hakkaocr_profiles for select to authenticated
  using (user_id=(select auth.uid()) or public.hakkaocr_shares_group(user_id));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='hakkaocr_profiles' and policyname='p_ins') then
create policy p_ins on public.hakkaocr_profiles for insert to authenticated with check (user_id=(select auth.uid()));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='hakkaocr_profiles' and policyname='p_upd') then
create policy p_upd on public.hakkaocr_profiles for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
end if; end $$;

do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='hakkaocr_groups' and policyname='g_sel') then
create policy g_sel on public.hakkaocr_groups for select to authenticated using (public.hakkaocr_role(id) is not null);
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='hakkaocr_groups' and policyname='g_upd') then
create policy g_upd on public.hakkaocr_groups for update to authenticated using (public.hakkaocr_role(id) in ('owner','admin'));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='hakkaocr_groups' and policyname='g_del') then
create policy g_del on public.hakkaocr_groups for delete to authenticated using (owner_id=(select auth.uid()));
end if; end $$;

do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='hakkaocr_group_members' and policyname='m_sel') then
create policy m_sel on public.hakkaocr_group_members for select to authenticated using (public.hakkaocr_role(group_id) is not null);
end if; end $$;
-- 自己退出（擁有者不可退出），或管理者移除一般成員；擁有者可移除任何人
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='hakkaocr_group_members' and policyname='m_del') then
create policy m_del on public.hakkaocr_group_members for delete to authenticated using (
  (user_id=(select auth.uid()) and role<>'owner')
  or (public.hakkaocr_role(group_id)='owner' and role<>'owner')
  or (public.hakkaocr_role(group_id)='admin' and role='member'));
end if; end $$;

do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='hakkaocr_favorites' and policyname='f_sel') then
create policy f_sel on public.hakkaocr_favorites for select to authenticated
  using (user_id=(select auth.uid()) or (group_id is not null and public.hakkaocr_role(group_id) is not null));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='hakkaocr_favorites' and policyname='f_ins') then
create policy f_ins on public.hakkaocr_favorites for insert to authenticated
  with check (user_id=(select auth.uid()) and (group_id is null or public.hakkaocr_role(group_id) is not null));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='hakkaocr_favorites' and policyname='f_upd') then
create policy f_upd on public.hakkaocr_favorites for update to authenticated
  using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()) and (group_id is null or public.hakkaocr_role(group_id) is not null));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='public' and tablename='hakkaocr_favorites' and policyname='f_del') then
create policy f_del on public.hakkaocr_favorites for delete to authenticated using (user_id=(select auth.uid()));
end if; end $$;

-- RPC：建立群組、以代碼加入、變更角色、成員學習進度
create or replace function public.hakkaocr_create_group(p_name text) returns public.hakkaocr_groups
language plpgsql security definer set search_path='' as $$
declare g public.hakkaocr_groups;
begin
  if auth.uid() is null then raise exception 'NOT_LOGGED_IN'; end if;
  insert into public.hakkaocr_groups(name,owner_id) values (trim(p_name),auth.uid()) returning * into g;
  insert into public.hakkaocr_group_members(group_id,user_id,role) values (g.id,auth.uid(),'owner');
  return g;
end $$;

create or replace function public.hakkaocr_join_group(p_code text) returns public.hakkaocr_groups
language plpgsql security definer set search_path='' as $$
declare g public.hakkaocr_groups;
begin
  if auth.uid() is null then raise exception 'NOT_LOGGED_IN'; end if;
  select * into g from public.hakkaocr_groups where join_code=upper(trim(p_code));
  if g.id is null then raise exception 'CODE_NOT_FOUND'; end if;
  insert into public.hakkaocr_group_members(group_id,user_id) values (g.id,auth.uid()) on conflict do nothing;
  return g;
end $$;

create or replace function public.hakkaocr_set_role(p_group uuid,p_user uuid,p_role text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if public.hakkaocr_role(p_group) is distinct from 'owner' then raise exception 'NOT_OWNER'; end if;
  if p_role not in ('admin','member') or p_user=auth.uid() then raise exception 'BAD_ROLE'; end if;
  update public.hakkaocr_group_members set role=p_role where group_id=p_group and user_id=p_user;
end $$;

create or replace function public.hakkaocr_new_code(p_group uuid) returns text
language plpgsql security definer set search_path='' as $$
declare c text;
begin
  if coalesce(public.hakkaocr_role(p_group),'') not in ('owner','admin') then raise exception 'NOT_MANAGER'; end if;
  c:=upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  update public.hakkaocr_groups set join_code=c where id=p_group;
  return c;
end $$;

create or replace function public.hakkaocr_group_progress(p_group uuid)
returns table(user_id uuid,display_name text,email text,role text,favorites int,reviews int,finished int,due int,last_active timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if public.hakkaocr_role(p_group) is distinct from 'owner' and public.hakkaocr_role(p_group) is distinct from 'admin' then raise exception 'NOT_MANAGER'; end if;
  return query
  select m.user_id, coalesce(nullif(p.display_name,''),split_part(u.email,'@',1)),
    u.email::text,
    m.role,
    count(f.id)::int, coalesce(sum(f.review_count),0)::int,
    count(f.id) filter (where f.review_count>=5)::int,
    count(f.id) filter (where f.review_count<5 and f.next_review_at<=now())::int,
    greatest(max(f.created_at),max(f.last_review_at))
  from public.hakkaocr_group_members m
  join auth.users u on u.id=m.user_id
  left join public.hakkaocr_profiles p on p.user_id=m.user_id
  left join public.hakkaocr_favorites f on f.user_id=m.user_id
  where m.group_id=p_group
  group by m.user_id,p.display_name,u.email,m.role
  order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, 2;
end $$;

revoke execute on function public.hakkaocr_role(uuid), public.hakkaocr_shares_group(uuid) from anon, public;
revoke execute on function public.hakkaocr_create_group(text), public.hakkaocr_join_group(text), public.hakkaocr_set_role(uuid,uuid,text),
  public.hakkaocr_new_code(uuid), public.hakkaocr_group_progress(uuid) from anon, public;
grant execute on function public.hakkaocr_role(uuid), public.hakkaocr_shares_group(uuid), public.hakkaocr_create_group(text),
  public.hakkaocr_join_group(text), public.hakkaocr_set_role(uuid,uuid,text), public.hakkaocr_new_code(uuid),
  public.hakkaocr_group_progress(uuid) to authenticated;

-- 照片：私有 bucket，路徑為 {user_id}/{favorite_id}.jpg
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('hakkaocr','hakkaocr',false,2097152,array['image/jpeg','image/webp','image/png'])
on conflict (id) do nothing;

create or replace function public.hakkaocr_can_view_photo(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.hakkaocr_favorites f where f.image_path=p_name
    and (f.user_id=(select auth.uid()) or (f.group_id is not null and public.hakkaocr_role(f.group_id) is not null)))
$$;
revoke execute on function public.hakkaocr_can_view_photo(text) from anon, public;
grant execute on function public.hakkaocr_can_view_photo(text) to authenticated;

do $$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='hakkaocr_read') then
create policy hakkaocr_read on storage.objects for select to authenticated
  using (bucket_id='hakkaocr' and ((storage.foldername(name))[1]=(select auth.uid())::text or public.hakkaocr_can_view_photo(name)));
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='hakkaocr_write') then
create policy hakkaocr_write on storage.objects for insert to authenticated
  with check (bucket_id='hakkaocr' and (storage.foldername(name))[1]=(select auth.uid())::text);
end if; end $$;
do $$ begin if not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='hakkaocr_remove') then
create policy hakkaocr_remove on storage.objects for delete to authenticated
  using (bucket_id='hakkaocr' and (storage.foldername(name))[1]=(select auth.uid())::text);
end if; end $$;
