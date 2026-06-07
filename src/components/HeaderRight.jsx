import SettingsDropdown from './lobby/SettingsDropdown.jsx'

// Shared right-side header content: 🏠 home (back to SQ hub) + ⚙️ settings.
// Used in both LobbyPage and GamePage so the chrome stays uniform.
// `isAdmin` is forwarded to SettingsDropdown so the admin-panel row
// only renders when appropriate. `gameRows` is an optional render-prop for
// game-specific cog rows (Claim win / Forfeit), forwarded to SettingsDropdown.
export default function HeaderRight({ isAdmin = false, gameRows = null }) {
  return (
    <>
      <a
        href="/games/"
        className="text-2xl leading-none hover:scale-110 transition-transform"
        title="Side Quest"
        aria-label="Side Quest"
      >
        🏠
      </a>
      <SettingsDropdown isAdmin={isAdmin} gameRows={gameRows} />
    </>
  )
}
