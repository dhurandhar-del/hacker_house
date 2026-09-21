/**
 * The probability after every posting, as one line. DESIGN_SYSTEM.md §11.2.
 *
 * Inline SVG rather than a charting library: this is a polyline over at most
 * thirty points and any dependency would be larger than the component.
 *
 * Three rules from the design system, each with a reason:
 *
 * **The y axis is fixed at 0–1, never auto-scaled.** An auto-scaled
 * probability axis makes a 0.02 wobble look like a crisis, which is the
 * opposite of what a calibration chart is for.
 *
 * **Dots are coloured by direction**, `--danger` upward and `--success`
 * downward, so the shape of the argument is visible and not only its
 * conclusion — this case was argued in both directions.
 *
 * **The 0.85 and 0.15 stopping bands are ruled and labelled.** They are the
 * policy's own numbers and they are where the verdict changes.
 *
 * The first point is the prior: where the case started because of how the
 * alert arrived, before anything was found.
 */

const WIDTH = 320;
const HEIGHT = 96;
const PAD_X = 8;
const PAD_TOP = 8;
const PAD_BOTTOM = 8;

/** The meter stops from §2.3, so the terminal segment matches the meter. */
function meterVar(p: number): string {
  if (p <= 0.15) return "var(--meter-0)";
  if (p <= 0.4) return "var(--meter-1)";
  if (p <= 0.7) return "var(--meter-2)";
  return "var(--meter-3)";
}

export function ProbabilityTrajectory({ values }: { values: number[] }) {
  const prior = values[0];
  const last = values[values.length - 1];
  if (prior === undefined || last === undefined) return null;

  const x = (index: number) =>
    PAD_X + (index / Math.max(values.length - 1, 1)) * (WIDTH - PAD_X * 2);
  const y = (value: number) =>
    PAD_TOP + (1 - Math.max(0, Math.min(1, value))) * (HEIGHT - PAD_TOP - PAD_BOTTOM);

  const path = values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
  const penultimate = values[values.length - 2];
  const tail =
    penultimate === undefined
      ? ""
      : `${x(values.length - 2)},${y(penultimate)} ${x(values.length - 1)},${y(last)}`;

  return (
    <figure className="flex flex-col gap-1.5">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-24 w-full"
        role="img"
        aria-label={
          `Fraud probability moved from a prior of ${prior.toFixed(2)} to ` +
          `${last.toFixed(2)} over ${values.length - 1} postings.`
        }
      >
        {[0.85, 0.15].map((band) => (
          <g key={band}>
            <line
              x1={PAD_X}
              x2={WIDTH - PAD_X}
              y1={y(band)}
              y2={y(band)}
              stroke="var(--border-strong)"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <text
              x={WIDTH - PAD_X}
              y={y(band) - 3}
              textAnchor="end"
              fill="var(--fg-subtle)"
              fontSize="9"
            >
              stop {band.toFixed(2)}
            </text>
          </g>
        ))}

        <polyline
          points={path}
          fill="none"
          stroke="var(--fg-muted)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {tail ? (
          <polyline
            points={tail}
            fill="none"
            stroke={meterVar(last)}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
        ) : null}

        {values.map((value, index) => {
          const previous = values[index - 1] ?? value;
          const up = value > previous + 0.0005;
          const down = value < previous - 0.0005;
          return (
            <circle
              key={index}
              cx={x(index)}
              cy={y(value)}
              r={index === 0 ? 3.5 : 2.5}
              fill={
                index === 0
                  ? "var(--surface)"
                  : up
                    ? "var(--danger)"
                    : down
                      ? "var(--success)"
                      : "var(--fg-subtle)"
              }
              stroke={index === 0 ? "var(--fg-subtle)" : "none"}
              strokeWidth={index === 0 ? 1.5 : 0}
            >
              <title>
                {index === 0
                  ? `prior ${value.toFixed(4)}`
                  : `posting ${index}: ${previous.toFixed(4)} → ${value.toFixed(4)}`}
              </title>
            </circle>
          );
        })}
      </svg>

      <figcaption className="flex justify-between text-caption text-fg-subtle">
        <span>
          prior <span className="font-mono text-fg">{prior.toFixed(2)}</span>
        </span>
        <span>
          {values.length - 1} posting{values.length === 2 ? "" : "s"}
        </span>
        <span>
          now <span className="font-mono text-fg">{last.toFixed(2)}</span>
        </span>
      </figcaption>
    </figure>
  );
}
