// True isometric (30-degree) projection: a flat square plane with half-extent
// r, viewed from a standard isometric camera, projects to a rhombus with
// corners at (0, r), (r*sqrt3, 0), (0, -r), (-r*sqrt3, 0) - width:height of
// sqrt(3):1. This is the classic 30-degree pseudo-3D angle, not a CSS cube.
const SQRT3 = Math.sqrt(3);

type Stage = { label: string; cy: number };

const STAGES: Stage[] = [
  { label: "Negotiate", cy: 100 },
  { label: "Pay", cy: 290 },
  { label: "Settle", cy: 480 },
  { label: "Deliver", cy: 670 },
];

const CX = 170;
const R = 70;
const DEPTH = 16;
const HALF_W = R * SQRT3;

function isoRhombus(cx: number, cy: number, r: number) {
  const hw = r * SQRT3;
  return `${cx},${cy + r} ${cx + hw},${cy} ${cx},${cy - r} ${cx - hw},${cy}`;
}

function IsoPlane({ cx, cy, opacity }: { cx: number; cy: number; opacity: number }) {
  const hw = HALF_W;
  const leftFace = `${cx - hw},${cy} ${cx},${cy + R} ${cx},${cy + R + DEPTH} ${cx - hw},${cy + DEPTH}`;
  const rightFace = `${cx},${cy + R} ${cx + hw},${cy} ${cx + hw},${cy + DEPTH} ${cx},${cy + R + DEPTH}`;

  return (
    <g>
      <polygon points={leftFace} fill="#5b3fd6" fillOpacity={opacity * 0.9} />
      <polygon points={rightFace} fill="#7c5cff" fillOpacity={opacity * 0.9} />
      <polygon
        points={isoRhombus(cx, cy, R)}
        fill="url(#planeGradient)"
        fillOpacity={opacity}
        stroke="rgba(167,139,250,0.65)"
        strokeWidth={1.5}
      />
    </g>
  );
}

export default function DiagramFlow() {
  return (
    <svg
      viewBox="0 0 480 800"
      className="h-auto w-full max-w-[280px] sm:max-w-[320px]"
      role="img"
      aria-label="Layered isometric diagram showing the flow: negotiate, pay, settle, deliver"
    >
      <defs>
        <linearGradient id="planeGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a78bfa" />
          <stop offset="100%" stopColor="#7c5cff" />
        </linearGradient>
      </defs>

      {STAGES.slice(0, -1).map((stage, i) => {
        const next = STAGES[i + 1];
        return (
          <line
            key={`connector-${stage.label}`}
            x1={CX}
            y1={stage.cy + R + DEPTH}
            x2={CX}
            y2={next.cy - R}
            stroke="rgba(139,124,246,0.5)"
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
        );
      })}

      {STAGES.map((stage, i) => (
        <IsoPlane key={stage.label} cx={CX} cy={stage.cy} opacity={0.22 + i * 0.06} />
      ))}

      {/* Signature animation: a soft pulse travels down the pipeline, plane
          then connector then plane, on a shared 3.5s loop. Positive delays
          (in strict top-to-bottom order) plus fill-mode "both" so each
          element sits dim until its turn, rather than negative delays -
          those looked correct in isolation but the modulo wraparound
          against a short 6%-of-cycle peak window scrambled the visual
          order (verified by sampling computed opacity over time). */}
      {STAGES.map((stage, i) => (
        <polygon
          key={`plane-glow-${stage.label}`}
          points={isoRhombus(CX, stage.cy, R)}
          fill="none"
          stroke="#c4b5fd"
          strokeWidth={2.5}
          opacity={0.2}
          className="pipeline-pulse-el"
          style={{ animationDelay: `${i * 1}s`, animationFillMode: "both" }}
        />
      ))}
      {STAGES.slice(0, -1).map((stage, i) => {
        const next = STAGES[i + 1];
        return (
          <line
            key={`connector-glow-${stage.label}`}
            x1={CX}
            y1={stage.cy + R + DEPTH}
            x2={CX}
            y2={next.cy - R}
            stroke="#a78bfa"
            strokeWidth={2.5}
            strokeLinecap="round"
            opacity={0.2}
            className="pipeline-pulse-el"
            style={{ animationDelay: `${(i * 2 + 1) * 0.5}s`, animationFillMode: "both" }}
          />
        );
      })}

      {STAGES.map((stage, i) => (
        <text
          key={`label-${stage.label}`}
          x={CX + HALF_W + 22}
          y={stage.cy + DEPTH / 2}
          dominantBaseline="middle"
          textAnchor="start"
          className="font-display"
          fill="#f5f4fb"
          fontSize="30"
          fontWeight={600}
        >
          {stage.label}
          <tspan x={CX + HALF_W + 22} dy="24" fill="#9491a8" fontSize="16" fontWeight={400}>
            {String(i + 1).padStart(2, "0")}
          </tspan>
        </text>
      ))}
    </svg>
  );
}
