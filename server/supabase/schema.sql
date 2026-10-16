-- ===========================================================================
-- Supabase users 테이블 스키마 (dbd-clone)
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 실행하세요.
-- service_role 키로 접근하므로 RLS 정책 없이 동작합니다.
-- ===========================================================================

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  password_hash text not null,
  nickname text,
  wins integer not null default 0,
  losses integer not null default 0,
  matches_played integer not null default 0,
  generators_repaired integer not null default 0,
  survivors_sacrificed integer not null default 0,
  escapes integer not null default 0,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists users_email_idx on public.users (email);
