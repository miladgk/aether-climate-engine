import { STATION_META, StationCardSummary, StationId } from '../types/telemetry';
import { buildSparklinePath } from '../utils/telemetry';

interface StationDeckProps {
  cards: StationCardSummary[];
  activeStation: StationId;
  onSelectStation: (station: StationId) => void;
}

const SPARK_W = 124;
const SPARK_H = 18;

export function StationDeck({ cards, activeStation, onSelectStation }: StationDeckProps) {
  return (
    <nav className="station-deck" aria-label="Global Weather Stations">
      {cards.map((card) => {
        const meta = STATION_META[card.id];
        const isActive = card.id === activeStation;
        const spark = buildSparklinePath(card.sparklineValues, SPARK_W, SPARK_H, 2.5);
        const gradId = `spark-grad-${card.id.replace(/\s+/g, '-').toLowerCase()}`;

        const cardClasses = [
          'station-card',
          isActive ? 'active' : '',
          card.isMaxAnomaly ? 'max-anomaly' : '',
          card.isMinAnomaly ? 'min-anomaly' : '',
        ]
          .filter(Boolean)
          .join(' ');

        return (
          <button
            key={card.id}
            type="button"
            className={cardClasses}
            aria-pressed={isActive}
            data-loc={card.id}
            onClick={() => onSelectStation(card.id)}
          >
            <div className="st-top-row">
              <span className="st-name-row">{meta.shortLabel}</span>
              <div className="st-temp">{card.tempDisplay}</div>
            </div>

            <div className="st-meta-row">
              <span
                className={`st-clock-pill ${card.isNight ? 'night' : 'day'}`}
                title={
                  card.isNight
                    ? `Local night at ${meta.fullName} right now`
                    : `Local daylight at ${meta.fullName} right now`
                }
              >
                <span className="st-solar-glyph" aria-hidden="true">
                  {card.isNight ? '☾' : '☀'}
                </span>
                <span>{card.localTimeLabel}</span>
              </span>
              <div className="st-wind">{card.windDisplay}</div>
            </div>

            <div className="st-bottom-row">
              <div className="st-left-sub">
                <div className="st-coords">{card.coordsLabel}</div>
                <div className="st-spark-wrap" aria-hidden="true">
                  {spark ? (
                    <svg
                      className="st-sparkline"
                      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
                      preserveAspectRatio="none"
                    >
                      <defs>
                        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor="var(--amber)"
                            stopOpacity={isActive ? '0.28' : '0.16'}
                          />
                          <stop offset="100%" stopColor="var(--amber)" stopOpacity="0" />
                        </linearGradient>
                      </defs>
                      <path d={spark.areaPath} fill={`url(#${gradId})`} />
                      <path
                        d={spark.linePath}
                        fill="none"
                        stroke={isActive ? 'var(--amber)' : 'var(--spark-stroke)'}
                        strokeWidth={isActive ? '1.5' : '1.25'}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        vectorEffect="non-scaling-stroke"
                      />
                      <circle
                        cx={spark.endX}
                        cy={spark.endY}
                        r="2"
                        fill={isActive ? 'var(--amber)' : 'var(--spark-dot)'}
                      />
                    </svg>
                  ) : (
                    <div className="st-spark-placeholder" />
                  )}
                </div>
              </div>

              <div className="st-metrics">
                <div className={`yoy-badge yoy-${card.yoyTone}`}>{card.yoyLabel}</div>
              </div>
            </div>
          </button>
        );
      })}
    </nav>
  );
}
