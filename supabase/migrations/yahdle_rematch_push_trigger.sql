-- Yahdle — rematch_requested push moves server-side (c378).
--
-- Before: requestRematch() in the browser POSTed {type:'rematch_requested'}
-- to the edge fn after the RPC. A phone backgrounding/closing the tab right
-- after the tap could drop that fetch silently, and client POSTs never land
-- in sq_http_log, so there was no record either way.
--
-- Now: an AFTER UPDATE trigger fires when rematch_requested_by goes
-- null → set on a finished game, same pg_net path as every other Yahdle push.
-- The edge fn's existing 'rematch_requested' branch re-reads the game and
-- resolves the recipient, so only game_id is sent.

create or replace function public.yahdle_notify_rematch_requested()
returns trigger language plpgsql security definer
set search_path = public
as $$
begin
  begin
    perform net.http_post(
      url := public.sq_functions_base_url() || '/yahdle-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || public.sq_anon_key()
      ),
      body := jsonb_build_object(
        'type', 'rematch_requested',
        'game_id', NEW.id
      ),
      timeout_milliseconds := 15000
    );
  exception when others then
    raise warning 'Yahdle rematch_requested push trigger failed: %', SQLERRM;
  end;
  return NEW;
end;
$$;

drop trigger if exists on_yahdle_rematch_requested on public.yahdle_games;
create trigger on_yahdle_rematch_requested
after update on public.yahdle_games
for each row
when (
  NEW.status = 'finished'
  and OLD.rematch_requested_by is null
  and NEW.rematch_requested_by is not null
)
execute function public.yahdle_notify_rematch_requested();
