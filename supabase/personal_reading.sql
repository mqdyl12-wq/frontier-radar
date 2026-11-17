-- Optional phase 2: implement login before wiring this table into the UI.
create table if not exists public.reading_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id text not null,
  saved boolean not null default true,
  status text not null default '待读' check (status in ('待读','在读','已读')),
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, paper_id)
);
alter table public.reading_notes enable row level security;
revoke all on public.reading_notes from anon, authenticated;
grant select, insert, update, delete on public.reading_notes to authenticated;
create policy "owner select" on public.reading_notes
  for select to authenticated using (user_id = (select auth.uid()));
create policy "owner insert" on public.reading_notes
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "owner update" on public.reading_notes
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy "owner delete" on public.reading_notes
  for delete to authenticated using (user_id = (select auth.uid()));
