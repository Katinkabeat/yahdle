-- Yahdle: Realtime via "Broadcast from database" (realtime.send) instead of
-- postgres_changes. Idempotent; safe to re-run. Mirrors wordy/realtime_broadcast.sql.
--
-- Topics (prefixed because the Supabase project is shared with other SQ games):
--   yahdle:game:<game_id>   everyone in / invited to / who created that game
--   yahdle:user:<user_id>   lobby feed for one user
-- Event name: 'change'. Payload:
--   { table, event, game_id, user_id?, status,
--     new: { id, status, created_by } }
-- (`new` is only present for table = 'yahdle_games'; yahdle_players events carry
--  game_id/user_id and clients just refetch. Client handlers ignore the payload.)

-- ── 1. Trigger function ──────────────────────────────────────
create or replace function public.yahdle_broadcast_game_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_game_id  uuid;
  v_status   text;
  v_creator  uuid;
  v_invitee  uuid;
  v_invitees uuid[];
  v_payload  jsonb;
  v_uid      uuid;
begin
  if TG_TABLE_NAME = 'yahdle_games' then
    v_game_id  := NEW.id;
    v_status   := NEW.status;
    v_creator  := NEW.created_by;
    v_invitee  := NEW.invited_user_id;
    v_invitees := coalesce(NEW.invited_user_ids, '{}');
    v_payload := jsonb_build_object(
      'table',   'yahdle_games',
      'event',   TG_OP,
      'game_id', v_game_id,
      'status',  v_status,
      'new', jsonb_build_object(
        'id',         NEW.id,
        'status',     NEW.status,
        'created_by', NEW.created_by
      )
    );
  else
    -- yahdle_players: use OLD on DELETE (NEW is null there)
    if TG_OP = 'DELETE' then
      v_game_id := OLD.game_id;
      v_uid     := OLD.user_id;
    else
      v_game_id := NEW.game_id;
      v_uid     := NEW.user_id;
    end if;
    if v_game_id is null then
      return coalesce(NEW, OLD);
    end if;
    select g.status, g.created_by, g.invited_user_id, coalesce(g.invited_user_ids, '{}')
      into v_status, v_creator, v_invitee, v_invitees
      from public.yahdle_games g where g.id = v_game_id;
    v_payload := jsonb_build_object(
      'table',   'yahdle_players',
      'event',   TG_OP,
      'game_id', v_game_id,
      'user_id', v_uid,
      'status',  v_status
    );
  end if;

  begin
    perform realtime.send(v_payload, 'change', 'yahdle:game:' || v_game_id::text, true);

    -- One lobby message per distinct user: every player in the game, the
    -- creator, every invitee (the old lobby watched invited_user_id), and
    -- (yahdle_players events) the row's own user, who may have just been
    -- removed from the table.
    for v_uid in
      select yp.user_id from public.yahdle_players yp where yp.game_id = v_game_id
      union
      select v_creator where v_creator is not null
      union
      select v_invitee where v_invitee is not null
      union
      select unnest(v_invitees)
      union
      select v_uid where v_uid is not null
    loop
      perform realtime.send(v_payload, 'change', 'yahdle:user:' || v_uid::text, true);
    end loop;
  exception when others then
    -- A Realtime hiccup must never abort the game write.
    raise warning 'yahdle_broadcast_game_change failed: %', sqlerrm;
  end;

  return coalesce(NEW, OLD);
end;
$$;

-- ── 2. Triggers ──────────────────────────────────────────────
drop trigger if exists yahdle_games_broadcast on public.yahdle_games;
create trigger yahdle_games_broadcast
  after update on public.yahdle_games
  for each row execute function public.yahdle_broadcast_game_change();

drop trigger if exists yahdle_players_broadcast on public.yahdle_players;
create trigger yahdle_players_broadcast
  after insert or update or delete on public.yahdle_players
  for each row execute function public.yahdle_broadcast_game_change();

-- ── 3. Realtime authorization (private channels) ─────────────
-- SECURITY DEFINER helper so the policy doesn't recurse through
-- yahdle_players RLS. Ignores malformed topics instead of erroring.
-- 'yahdle:game:' is 12 chars, so the uuid starts at position 13.
create or replace function public.yahdle_can_read_game_topic(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_topic ~ '^yahdle:game:[0-9a-fA-F-]{36}$'
    and exists (
      select 1
      from public.yahdle_games g
      where g.id = substr(p_topic, 13)::uuid
        and (
          g.created_by = (select auth.uid())
          or g.invited_user_id = (select auth.uid())
          or (select auth.uid()) = any(coalesce(g.invited_user_ids, '{}'))
          or exists (
            select 1 from public.yahdle_players yp
            where yp.game_id = g.id and yp.user_id = (select auth.uid())
          )
        )
    );
$$;

drop policy if exists "yahdle_realtime_game_topic_select" on realtime.messages;
create policy "yahdle_realtime_game_topic_select"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast')
    and public.yahdle_can_read_game_topic(realtime.topic())
  );

drop policy if exists "yahdle_realtime_user_topic_select" on realtime.messages;
create policy "yahdle_realtime_user_topic_select"
  on realtime.messages for select to authenticated
  using (
    realtime.messages.extension in ('broadcast')
    and realtime.topic() = 'yahdle:user:' || (select auth.uid())::text
  );

-- ── 4. NOT EXECUTED: run only AFTER the broadcast client has shipped ──
-- Removes the old postgres_changes sources (WAL decode load). Running this
-- earlier would break clients still on the old build (they fall back to the
-- 6s/30s polls).
-- alter publication supabase_realtime drop table public.yahdle_games, public.yahdle_players;
