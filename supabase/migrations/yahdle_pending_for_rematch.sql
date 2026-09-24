-- Yahdle — hub bell counts incoming rematch requests (c378).
--
-- Before: the bell counted 'Your turn' + 'Invite' only; a 1v1 rematch
-- request (c165 handshake — a flag on the finished game, no new row until
-- accepted) showed in the Yahdle lobby (c255) but never in the hub bell.
-- Adds a 'Rematch' bucket: finished 1v1 games where the OTHER player asked,
-- the request is still open (not accepted, not declined), and uid is seated.

create or replace function public.yahdle_pending_for(uid uuid)
returns table(count integer, label text, url text)
language sql stable security definer
set search_path = public
as $$
  with invites as (select count(*)::int as n from public.yahdle_games
     where status='waiting' and (uid = any(coalesce(invited_user_ids,'{}')) or invited_user_id=uid)
       and not exists (select 1 from public.yahdle_players p where p.game_id=yahdle_games.id and p.user_id=uid)),
  turn as (select count(*)::int as n from public.yahdle_games g
      join public.yahdle_players p on p.game_id=g.id and p.user_id=uid
     where g.status='active' and p.player_index=g.current_player_idx),
  rematch as (select count(*)::int as n from public.yahdle_games g
      join public.yahdle_players p on p.game_id=g.id and p.user_id=uid
     where g.status='finished' and g.max_players=2
       and g.rematch_requested_by is not null and g.rematch_requested_by <> uid
       and g.rematch_new_game_id is null and g.rematch_declined_at is null)
  select n, 'Your turn'::text, '/yahdle/'::text from turn where n>0
  union all select n, 'Invite'::text, '/yahdle/'::text from invites where n>0
  union all select n, 'Rematch'::text, '/yahdle/'::text from rematch where n>0;
$$;
