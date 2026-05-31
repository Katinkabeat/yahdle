-- Yahdle — notify creator when an invite is declined (Phase 2, parity)
-- CREATE OR REPLACE of yahdle_decline_invite (from yahdle_multiplayer_rpcs.sql)
-- to also fire an 'invite_declined' push to the creator. Yahdle's decline
-- DELETEs the waiting 1v1 game; we capture created_by via RETURNING before
-- it's gone, then notify. Gated per-recipient in the edge fn via
-- sq_notification_enabled('yahdle','invite_declined') — default OFF.
-- Idempotent.

create or replace function public.yahdle_decline_invite(p_game_id uuid)
returns void language plpgsql security definer as $$
declare
  v_uid     uuid := auth.uid();
  v_creator uuid;
begin
  delete from public.yahdle_games
  where id = p_game_id
    and status = 'waiting'
    and invited_user_id = v_uid
  returning created_by into v_creator;

  if not found then raise exception 'Invite not found'; end if;

  begin
    perform net.http_post(
      url := 'https://yyhewndblruwxsrqzart.supabase.co/functions/v1/yahdle-push-notification',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl5aGV3bmRibHJ1d3hzcnF6YXJ0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1MDk4MjAsImV4cCI6MjA4OTA4NTgyMH0.vwL4iipf5e_bm8rsW_dECSv640s8Kds5c2tYCOJqEnQ'
      ),
      body := jsonb_build_object(
        'type', 'invite_declined',
        'game_id', p_game_id,
        'creator_id', v_creator,
        'decliner_id', v_uid
      )
    );
  exception when others then
    raise warning 'Yahdle invite_declined push failed: %', SQLERRM;
  end;
end;
$$;

grant execute on function public.yahdle_decline_invite(uuid) to authenticated;
