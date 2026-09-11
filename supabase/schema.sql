-- 검·인정 교과용도서 선정 문서 작성 웹앱 — Supabase 스키마
-- Supabase 대시보드 > SQL Editor 에서 실행하세요.
create table if not exists public.docs (
  id text primary key,
  kind text not null,            -- 'master' | 'evaluation' | 'summary'
  subject_id text,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
create index if not exists docs_kind_idx on public.docs (kind, subject_id);

alter table public.docs enable row level security;

-- 학교 내부용: 접속 코드로 앱 진입을 제어하고, DB는 anon 키로 읽기/쓰기 허용
drop policy if exists "anon all" on public.docs;
create policy "anon all" on public.docs
  for all to anon using (true) with check (true);
