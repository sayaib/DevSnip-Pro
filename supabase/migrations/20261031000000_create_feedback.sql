-- Messages from the Feedback form in Milestones & Points.
-- The extension ships a publishable key, so anyone can reach this table:
-- the anon role may only insert the listed columns and can never read rows.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  category text not null check (category in ('bug_report', 'feature_addition', 'feedback')),
  title text not null check (char_length(title) between 3 and 120),
  message text not null check (char_length(message) between 10 and 4000),
  email text check (email is null or char_length(email) <= 254),
  extension_version text check (char_length(extension_version) <= 40),
  vscode_version text check (char_length(vscode_version) <= 40),
  platform text check (char_length(platform) <= 40)
);

alter table public.feedback enable row level security;

revoke all on public.feedback from anon, authenticated;
grant insert (category, title, message, email, extension_version, vscode_version, platform)
  on public.feedback to anon;

drop policy if exists "Anyone can send feedback" on public.feedback;
create policy "Anyone can send feedback"
  on public.feedback for insert to anon
  with check (true);

-- Make the REST API see the new table straight away.
notify pgrst, 'reload schema';
