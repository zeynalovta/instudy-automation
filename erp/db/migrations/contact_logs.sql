begin;

create table if not exists public.dma_contact_logs (
  id bigint generated always as identity primary key,
  application_id bigint not null references public.dma_applications(id) on delete cascade,
  contacted_at timestamptz not null default now(),
  channel text not null check (channel in ('PHONE', 'WHATSAPP', 'EMAIL', 'OTHER')),
  outcome text not null check (outcome in ('TALKED', 'NO_ANSWER', 'PHONE_OFF', 'FOLLOW_UP', 'NOT_INTERESTED', 'OTHER')),
  note text,
  staff_email text not null default (auth.jwt() ->> 'email'),
  created_at timestamptz not null default now()
);

create index if not exists dma_contact_logs_application_idx
  on public.dma_contact_logs (application_id, contacted_at desc);

alter table public.dma_contact_logs enable row level security;

grant select, insert on public.dma_contact_logs to authenticated;
grant usage on sequence public.dma_contact_logs_id_seq to authenticated;
revoke update, delete on public.dma_contact_logs from authenticated;

create policy "dma_contact_logs_select"
  on public.dma_contact_logs for select to authenticated
  using ((select public.has_scope('dma')));

create policy "dma_contact_logs_insert"
  on public.dma_contact_logs for insert to authenticated
  with check (
    (select public.has_scope('dma'))
    and staff_email = (auth.jwt() ->> 'email')
  );

commit;

-- Rollback:
-- drop table if exists public.dma_contact_logs;
