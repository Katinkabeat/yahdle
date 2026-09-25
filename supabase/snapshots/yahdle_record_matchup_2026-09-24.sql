-- Snapshot of live public.yahdle_record_matchup taken 2026-09-24 before DROP (card c380).
-- Restore: run this, then REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated.

CREATE OR REPLACE FUNCTION public.yahdle_record_matchup(p_player_a uuid, p_player_b uuid, p_winner uuid, p_tie boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  a_win int := case when p_tie then 0 when p_winner = p_player_a then 1 else 0 end;
  a_los int := case when p_tie then 0 when p_winner = p_player_b then 1 else 0 end;
  a_tie int := case when p_tie then 1 else 0 end;
begin
  -- c332: either seat a member → no-op, no matchup rows written.
  if public.sq_is_test_account(p_player_a) or public.sq_is_test_account(p_player_b) then
    return;
  end if;

  insert into public.yahdle_matchups (player_id, opponent_id, wins, losses, ties)
  values (p_player_a, p_player_b, a_win, a_los, a_tie)
  on conflict (player_id, opponent_id) do update set
    wins = yahdle_matchups.wins + excluded.wins,
    losses = yahdle_matchups.losses + excluded.losses,
    ties = yahdle_matchups.ties + excluded.ties,
    updated_at = now();

  insert into public.yahdle_matchups (player_id, opponent_id, wins, losses, ties)
  values (p_player_b, p_player_a, a_los, a_win, a_tie)
  on conflict (player_id, opponent_id) do update set
    wins = yahdle_matchups.wins + excluded.wins,
    losses = yahdle_matchups.losses + excluded.losses,
    ties = yahdle_matchups.ties + excluded.ties,
    updated_at = now();
end;
$function$

;
