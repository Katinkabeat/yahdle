import { useNavigate, useParams } from 'react-router-dom'
import {
  SQBoardShell,
  SQLobbyHeader,
  SQBoardHeader,
} from '../../../../rae-side-quest/packages/sq-ui'
import AvatarMenu from '../lobby/AvatarMenu.jsx'
import HeaderRight from '../HeaderRight.jsx'

// Multiplayer game page. Real-time synced game state via Supabase channels.
//
// TODO:
//   - load game + players + my-player by `gameId`
//   - subscribe to realtime updates so opponents' moves appear live
//   - render the shared board, score panel, turn indicator, action bar
//   - wire nudge + forfeit actions
//   - render the end-game banner when status === 'finished' (or your
//     game's equivalent). Use the canonical 4-branch headline so an
//     admin-closed game shows "🛑 Game closed by admin" instead of
//     falsely attributing a winner:
//
//       game.closed_by_admin
//         ? '🛑 Game closed by admin'
//         : game.forfeit_user_id
//           ? `🏳️ ${forfeiter} forfeited — ${winner} wins!`
//           : winnerPlayer
//             ? `🏆 ${winnerName} wins!`
//             : "🤝 It's a tie!"
//
// Use the `useRealtimeChannel` hook (src/hooks/useRealtimeChannel.js)
// for realtime + polling fallback + visibility refresh. Example:
//
//   useRealtimeChannel({
//     channelName: `game-${gameId}`,
//     subscriptions: [
//       { event: 'UPDATE', schema: 'public', table: 'yahdle_games',   filter: `id=eq.${gameId}` },
//       { event: '*',      schema: 'public', table: 'yahdle_players', filter: `game_id=eq.${gameId}` },
//     ],
//     onChange: loadGame,
//     enabled: !!gameId,
//   })
export default function MultiGamePage({ session, profile, isAdmin }) {
  const { gameId } = useParams()
  const navigate = useNavigate()

  return (
    <SQBoardShell
      width="narrow"
      header={
        <SQLobbyHeader
          title="Yahdle"
          avatarSlot={<AvatarMenu profile={profile} />}
          rightSlot={<HeaderRight isAdmin={isAdmin} />}
        />
      }
      subHeader={
        <SQBoardHeader
          backLabel="← Lobby"
          onBackClick={() => navigate('/')}
          centerSlot={null}
          rightSlot={null /* TODO multi-game status, e.g. whose turn it is */}
        />
      }
    >
      <div className="py-6">
        <h1 className="font-display text-2xl mb-2">Multiplayer game {gameId}</h1>
        <p className="opacity-80">
          Multi board placeholder — render the Yahdle multiplayer play surface here.
        </p>
      </div>
    </SQBoardShell>
  )
}
