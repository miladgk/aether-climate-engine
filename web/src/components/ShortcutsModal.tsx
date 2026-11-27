interface ShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS: {
  title: string;
  items: { keys: string[]; desc: string }[];
}[] = [
  {
    title: 'Station Orbit',
    items: [
      { keys: ['1', '–', '6'], desc: 'Switch between Berlin, Tokyo, New York, London, Sydney & Helsinki' },
    ],
  },
  {
    title: 'Forecast & Instruments',
    items: [
      { keys: ['M'], desc: 'Cycle forecast model (Linear → SMA → EMA → Ensemble)' },
      { keys: ['H'], desc: 'Cycle forecast horizon (12h → 24h → 48h)' },
      { keys: ['U'], desc: 'Toggle temperature unit (°C ↔ °F)' },
      { keys: ['W'], desc: 'Toggle wind speed unit (km/h ↔ m/s)' },
      { keys: ['T'], desc: 'Cycle atmosphere theme (Ember → Nord → Stone)' },
    ],
  },
  {
    title: 'Panels & Help',
    items: [
      { keys: ['O'], desc: 'Toggle Live Observation Tape & CSV export drawer' },
      { keys: ['?'], desc: 'Open or close this keyboard reference sheet' },
      { keys: ['ESC'], desc: 'Close active overlay, popover, or drawer' },
    ],
  },
];

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  if (!open) return null;

  return (
    <div
      className="shortcut-backdrop"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="shortcut-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard Instrument Shortcuts"
      >
        <div className="shortcut-header">
          <div>
            <div className="shortcut-title">Keyboard Instrument Console</div>
            <div className="shortcut-sub">
              Direct bindings for planetary navigation and telemetry controls
            </div>
          </div>
          <button
            type="button"
            className="drawer-close"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >
            ESC / Close ✕
          </button>
        </div>

        <div className="shortcut-groups">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title} className="shortcut-group">
              <div className="shortcut-group-title">{group.title}</div>
              <div className="shortcut-list">
                {group.items.map((item) => (
                  <div key={item.desc} className="shortcut-row">
                    <span className="shortcut-desc">{item.desc}</span>
                    <span className="shortcut-keys">
                      {item.keys.map((k, idx) =>
                        k === '–' ? (
                          <span key={idx} className="shortcut-sep">
                            –
                          </span>
                        ) : (
                          <kbd key={idx} className="kbd-cap">
                            {k}
                          </kbd>
                        ),
                      )}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
