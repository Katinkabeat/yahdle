-- Yahdle — push notification triggers.
--
-- Three triggers on yahdle_games feed the yahdle-push-notification
-- Edge Function via pg_net:
--   1. on_yahdle_game_invited       : AFTER INSERT (invited_user_id set).
--                                     Notifies the invitee.
--   2. on_yahdle_opponent_joined    : AFTER UPDATE, status waiting→active.
--                                     Notifies the creator.
--   3. on_yahdle_turn_change        : AFTER UPDATE, current_player_idx
--                                     changed while still active. Notifies
--                                     the new current player.
--   4. on_yahdle_game_finished      : AFTER UPDATE, status active→finished.
--                                     Notifies both players (won / lost /
--                                     tie / opponent forfeited).
--
-- Auth: project's public anon JWT — Edge Function only needs a valid JWT
-- for verification, then it spins up its own service-role client.

-- ── 1. game_invited (INSERT) ─────────────────────────────────
create or replace function public.yahdle_notify_game_invited()
returns trigger language plpgsql security definer as $$
begin
  if NEW.invited_user_id is null then
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
        'type', 'game_invited',
        'record', row_to_json(NEW)
      )
    );
  exception when others then
    raise warning 'Yahdle game_invited push trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$$;

drop trigger if exists on_yahdle_game_invited on public.yahdle_games;
create trigger on_yahdle_game_invited
after insert on public.yahdle_games
for each row
when (NEW.invited_user_id is not null)
execute function public.yahdle_notify_game_invited();

-- ── 2. opponent_joined (UPDATE waiting→active) ───────────────
create or replace function public.yahdle_notify_opponent_joined()
returns trigger language plpgsql security definer as $$
begin
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

drop trigger if exists on_yahdle_opponent_joined on public.yahdle_games;
create trigger on_yahdle_opponent_joined
after update on public.yahdle_games
for each row
when (OLD.status = 'waiting' and NEW.status = 'active')
execute function public.yahdle_notify_opponent_joined();

-- ── 3. turn_change (UPDATE current_player_idx changed) ───────
create or replace function public.yahdle_notify_turn_change()
returns trigger language plpgsql security definer as $$
begin
  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/yahdle-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'turn_change',
        'record', row_to_json(NEW),
        'old_record', row_to_json(OLD)
      )
    );
  exception when others then
    raise warning 'Yahdle turn_change push trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$$;

drop trigger if exists on_yahdle_turn_change on public.yahdle_games;
create trigger on_yahdle_turn_change
after update on public.yahdle_games
for each row
when (
  NEW.status = 'active'
  and OLD.status = 'active'
  and OLD.current_player_idx is distinct from NEW.current_player_idx
)
execute function public.yahdle_notify_turn_change();

-- ── 4. game_finished (UPDATE active→finished) ────────────────
create or replace function public.yahdle_notify_game_finished()
returns trigger language plpgsql security definer as $$
begin
  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/yahdle-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'game_finished',
        'record', row_to_json(NEW)
      )
    );
  exception when others then
    raise warning 'Yahdle game_finished push trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$$;

drop trigger if exists on_yahdle_game_finished on public.yahdle_games;
create trigger on_yahdle_game_finished
after update on public.yahdle_games
for each row
when (OLD.status = 'active' and NEW.status = 'finished')
execute function public.yahdle_notify_game_finished();
