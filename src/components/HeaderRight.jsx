import SettingsDropdown from './lobby/SettingsDropdown.jsx'

// Shared right-side header content: 🏠 home (back to SQ hub) + ⚙️ settings.
// Used in both LobbyPage and GamePage so the chrome stays uniform.
// `isAdmin` is forwarded to SettingsDropdown so the admin-panel row
// only renders when appropriate.
export default function HeaderRight({ isAdmin = false }) {
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
      <SettingsDropdown isAdmin={isAdmin} />
    </>
  )
}
