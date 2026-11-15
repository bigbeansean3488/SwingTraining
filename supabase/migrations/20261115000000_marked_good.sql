-- Analyses the athlete or coach marked as a "good" motion. Later analyses are
-- compared with these (own references only; no external standard).
alter table public.motion_analyses
  add column if not exists marked_good boolean not null default false;
