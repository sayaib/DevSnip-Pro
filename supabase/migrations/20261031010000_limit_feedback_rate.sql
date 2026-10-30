-- The publishable key ships in the extension, so anyone can post to this table.
-- A cap on rows per hour keeps a flood from filling the database. Real users
-- only notice it during a flood, and their draft stays in the form.

create index if not exists feedback_created_at_idx on public.feedback (created_at);

create or replace function public.feedback_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.feedback where created_at > now() - interval '1 hour') >= 200 then
    raise exception 'Too many feedback messages right now.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.feedback_rate_limit() from public, anon, authenticated;

drop trigger if exists feedback_rate_limit on public.feedback;
create trigger feedback_rate_limit
  before insert on public.feedback
  for each row execute function public.feedback_rate_limit();
