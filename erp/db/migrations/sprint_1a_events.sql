-- Sprint 1A: measurement / observability / attribution
--
-- Bu SQL Supabase SQL Editor-da ƏLLƏ icra olunub (təsdiqlənmiş versiya).
-- Repoda yalnız qeyd üçün saxlanılır; tətbiq bunu avtomatik işə salmır.
--
-- Dizayn qərarları:
--  * event qatında raw Instagram ID yoxdur: user_key (uuid) + instagram_user_keys xəritəsi
--  * instagram_events dəyişməzdir (trigger + service_role-da yalnız select/insert)
--  * mətn yalnız instagram_event_payloads-dadır (maks. 500 simvol, 90 gün retention)
--  * instagram_event_payloads.event_id FK-sında ON DELETE CASCADE QƏSDƏN yoxdur:
--    event-lər silinmir, cascade heç nə qazandırmır və təsadüfi silmələri gizlədərdi
--  * RPC SECURITY INVOKER: service_role hüquqları ilə işləyir (bypassrls), execute yalnız service_role-da

begin;
set local lock_timeout = '3s';

-- 1) Pseudonim xəritəsi: raw ID-nin yeganə yeri (event qatında yox)
create table public.instagram_user_keys (
  user_key          uuid        primary key default gen_random_uuid(),
  instagram_user_id text        not null unique,
  created_at        timestamptz not null default now()
);

-- 2) Hadisələr: raw ID və mətn yoxdur, dəyişməzdir
create table public.instagram_events (
  id             bigint generated always as identity primary key,
  user_key       uuid        not null,   -- FK yoxdur: xəritə silinəndə hadisələr qalmalıdır
  event_type     text        not null,
  channel        text,
  program        text,
  program_method text,
  ad_id          text,
  media_id       text,
  dedupe_key     text unique,            -- null-lar təkrarlana bilər
  occurred_at    timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  metadata       jsonb       not null default '{}'::jsonb
);
create index idx_instagram_events_user_time on public.instagram_events (user_key, occurred_at);
create index idx_instagram_events_type_time on public.instagram_events (event_type, occurred_at);
create index idx_instagram_events_ad        on public.instagram_events (ad_id) where ad_id is not null;

-- 3) Payload: mətn və müvəqqəti məlumat, 90 gündən sonra silinir
create table public.instagram_event_payloads (
  event_id     bigint      primary key references public.instagram_events(id),
  text_content text,
  extra        jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
create index idx_instagram_event_payloads_created on public.instagram_event_payloads (created_at);

-- 4) Reklam -> proqram xəritəsi (əllə doldurulur)
create table public.ad_program_map (
  ad_id      text primary key,
  program    text not null check (program in
             ('backend','frontend','hr','data','accounting','computer_operator')),
  ad_name    text,
  note       text,
  created_at timestamptz not null default now()
);

-- 5) RLS və açıq hüquqlar (defolt hüquqlardan asılı olmamaq üçün)
alter table public.instagram_user_keys      enable row level security;
alter table public.instagram_events         enable row level security;
alter table public.instagram_event_payloads enable row level security;
alter table public.ad_program_map           enable row level security;

revoke all on public.instagram_user_keys, public.instagram_events,
              public.instagram_event_payloads, public.ad_program_map
  from anon, authenticated, service_role;

grant select, insert on public.instagram_user_keys      to service_role;
grant select, insert on public.instagram_events         to service_role;
grant select, insert on public.instagram_event_payloads to service_role;
grant select         on public.ad_program_map           to service_role;

do $$
begin
  execute format('grant usage, select on sequence %s to service_role',
                 pg_get_serial_sequence('public.instagram_events', 'id'));
end $$;

-- 6) instagram_events dəyişməzdir
create function public.instagram_events_block_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'instagram_events is append-only (% blocked)', tg_op;
end;
$$;

create trigger instagram_events_append_only
  before update or delete on public.instagram_events
  for each row execute function public.instagram_events_block_mutation();

create trigger instagram_events_no_truncate
  before truncate on public.instagram_events
  for each statement execute function public.instagram_events_block_mutation();

-- 7) Yazma funksiyası (SECURITY INVOKER: çağıranın, yəni service_role-un hüquqları ilə)
create function public.log_instagram_events(p_events jsonb)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  r        jsonb;
  v_uid    text;
  v_key    uuid;
  v_id     bigint;
  v_ins    integer := 0;
  v_dup    integer := 0;
  v_failed integer := 0;
begin
  if jsonb_typeof(p_events) is distinct from 'array' then
    return jsonb_build_object('inserted', 0, 'duplicates', 0, 'failed', 0, 'error', 'not_an_array');
  end if;

  for r in select value from jsonb_array_elements(p_events)
  loop
    v_id  := null;
    v_key := null;
    v_uid := nullif(r->>'instagram_user_id', '');

    begin
      if v_uid is null then
        raise exception 'missing instagram_user_id';
      end if;

      -- raw ID -> user_key (yoxdursa yaradılır, yarışa davamlı)
      select user_key into v_key
        from public.instagram_user_keys where instagram_user_id = v_uid;

      if v_key is null then
        insert into public.instagram_user_keys (instagram_user_id)
        values (v_uid)
        on conflict (instagram_user_id) do nothing
        returning user_key into v_key;

        if v_key is null then
          select user_key into v_key
            from public.instagram_user_keys where instagram_user_id = v_uid;
        end if;
      end if;

      insert into public.instagram_events (
        user_key, event_type, channel, program, program_method,
        ad_id, media_id, dedupe_key, occurred_at, metadata
      ) values (
        v_key,
        r->>'event_type',
        r->>'channel',
        r->>'program',
        r->>'program_method',
        r->>'ad_id',
        r->>'media_id',
        r->>'dedupe_key',
        coalesce((r->>'occurred_at')::timestamptz, now()),
        coalesce(r->'metadata', '{}'::jsonb)
      )
      on conflict (dedupe_key) do nothing
      returning id into v_id;

      if v_id is null then
        v_dup := v_dup + 1;
      else
        v_ins := v_ins + 1;
        if nullif(r->>'text', '') is not null or r->'extra' is not null then
          insert into public.instagram_event_payloads (event_id, text_content, extra)
          values (v_id, left(r->>'text', 500), coalesce(r->'extra', '{}'::jsonb));
        end if;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      raise warning 'log_instagram_events row failed: %', sqlerrm;
    end;
  end loop;

  return jsonb_build_object('inserted', v_ins, 'duplicates', v_dup, 'failed', v_failed);
end;
$$;

revoke all on function public.log_instagram_events(jsonb) from public, anon, authenticated;
grant execute on function public.log_instagram_events(jsonb) to service_role;

-- 8) Payload retention: 90 gün, gündəlik 03:17 UTC
select cron.schedule(
  'instagram-event-payloads-retention',
  '17 3 * * *',
  $$ delete from public.instagram_event_payloads where created_at < now() - interval '90 days' $$
);

-- 9) Sticky sütunlar (sonda, kilid müddəti minimum olsun; backfill yoxdur)
alter table public.instagram_contacts
  add column if not exists first_link_clicked_at timestamptz,
  add column if not exists first_confirmed_at    timestamptz;

commit;
