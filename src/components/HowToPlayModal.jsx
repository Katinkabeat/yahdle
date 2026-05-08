import { SQModal } from '../../../rae-side-quest/packages/sq-ui'

// Placeholder how-to-play modal. Replace with the real instructions once
// the game's rules are settled.
export default function HowToPlayModal({ open, onClose }) {
  return (
    <SQModal open={open} onClose={onClose} title="How to play">
      <div className="space-y-3 text-sm">
        <p>
          {/* TODO write the actual rules for Yahdle here. */}
          Instructions coming soon — write them as the game's rules settle.
        </p>
      </div>
    </SQModal>
  )
}
