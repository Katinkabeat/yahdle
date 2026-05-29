-- ============================================================
-- Yahdle — Smarter invite expiry (card c150)
--
-- Replaces the old behaviour where any still-'waiting' game past its
-- expires_at was HARD-DELETED (silent, permanent — Rae's 4-player game
-- vanished this way). New policy:
--   • Friend-invite window 1 day → 3 days (open games stay 7 days).
--   • At expiry, per game:
--       - >= 2 players joined  → drop the no-show invitee slots, shrink
--         max_players to who's here, and START the game short-handed.
--         invited_user_ids is KEPT so the UI can render no-shows as
--         greyed-out ✗ pills. No push (the pills are the signal).
--       - only the creator (1)  → CLOSE (not delete): status='finished'
--         + closed_reason, no winner, and we deliberately skip
--         yahdle_finalize_game so it records NO matchups / stats. The
--         lone creator gets a single 'game_closed' push.
--
-- Idempotent.
-- ============================================================

-- ── 1. closed_reason column (for no-show closes) ─────────────
alter table public.yahdle_games
  add column if not exists closed_reason text;

-- ── 2. Expiry window: friend invites 1 day → 3 days ──────────
-- (open games — invited_user_id null — stay 7 days.)
create or replace function public.yahdle_set_game_expiry()
returns trigger language plpgsql as $$
begin
  if new.expires_at is null or tg_op = 'INSERT' then
    if new.invited_user_id is null then
      new.expires_at := coalesce(new.created_at, now()) + interval '7 days';
    else
      new.expires_at := coalesce(new.created_at, now()) + interval '3 days';
    end if;
  end if;
  return new;
end;
$$;

-- ── 3. Suppress the "opponent joined" push on short-handed auto-start ──
-- The expire sweep flips waiting→active, which normally fires this push.
-- Rae wants NO push when a game opens short-handed (the greyed ✗ pills
-- are the signal), so the trigger now skips when the expire sweep has
-- set the txn-local guard GUC.
create or replace function public.yahdle_notify_opponent_joined()
returns trigger language plpgsql security definer as $$
begin
  if coalesce(current_setting('yahdle.suppress_join_push', true), '') = '1' then
    return NEW;
  end if;
  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/yahdle-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'opponent_joined',
        'record', row_to_json(NEW)
      )
    );
  exception when others then
    raise warning 'Yahdle opponent_joined push trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$$;

-- ── 4. Expire sweep: start short-handed, or close-with-reason ─
-- (was a blanket DELETE). Still cheap + safe to call from the lobby on
-- every load — filtered by status + indexed expires_at. Returns the
-- number of games it processed.
create or replace function public.yahdle_expire_stale_invites()
returns int language plpgsql security definer as $$
declare
  g        record;
  v_joined int;
  n        int := 0;
begin
  -- No "opponent joined" pushes for the auto-starts below (txn-local).
  perform set_config('yahdle.suppress_join_push', '1', true);

  for g in
    select * from public.yahdle_games
     where status = 'waiting' and expires_at < now()
     for update
  loop
    select count(*) into v_joined
      from public.yahdle_players where game_id = g.id;

    if v_joined >= 2 then
      -- Playable: drop no-show slots (kept in invited_user_ids for the
      -- greyed ✗ pills), shrink to who's here, and start. Joined players
      -- always hold contiguous player_index 0..v_joined-1.
      update public.yahdle_games
         set max_players        = v_joined,
             status             = 'active',
             joined_at          = now(),
             current_player_idx = floor(random() * v_joined)::int,
             current_turn       = 1,
             last_activity_at   = now()
       where id = g.id;
    else
      -- Only the creator — unplayable. Close (not delete), file under
      -- Completed with a reason, and skip finalize so it never touches
      -- matchups / stats.
      update public.yahdle_games
         set status           = 'finished',
             finished_at      = now(),
             closed_reason    = 'no_other_players',
             winner_user_id   = null,
             is_tie           = false,
             last_activity_at = now()
       where id = g.id;

      -- One push to the lone creator (the only notification in this flow).
      begin
        perform net.http_post(
          url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/yahdle-push-notification',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
          ),
          body := jsonb_build_object(
            'type', 'game_closed',
            'record', jsonb_build_object(
              'id', g.id,
              'created_by', g.created_by,
              'closed_reason', 'no_other_players'
            )
          )
        );
      exception when others then
        raise warning 'Yahdle game_closed push failed: %', SQLERRM;
      end;
    end if;

    n := n + 1;
  end loop;

  return n;
end;
$$;

grant execute on function public.yahdle_expire_stale_invites() to authenticated;
