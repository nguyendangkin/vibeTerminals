import React from "react";

const PX = 12;

type PxVal = 0 | 1 | 2 | 3 | 4 | 5;

const GRID: PxVal[][] = [
  [0,0,0,5,5,5,0,0,0,0],
  [0,0,0,5,5,5,0,0,0,0],
  [0,5,1,1,1,1,1,1,5,0],
  [0,1,1,1,1,1,1,1,1,0],
  [0,1,2,1,1,1,1,2,1,0],
  [0,1,3,4,1,1,3,4,1,0],
  [0,1,3,4,1,1,3,4,1,0],
  [0,1,1,1,2,2,1,1,1,0],
  [0,1,1,1,1,1,1,1,1,0],
  [1,1,1,1,1,1,1,1,1,1],
  [2,0,1,1,1,1,1,1,0,2],
  [2,0,1,1,1,1,1,1,0,2],
  [0,0,1,1,1,1,1,1,0,0],
  [0,0,1,1,1,1,1,1,0,0],
  [0,0,0,1,0,0,1,0,0,0],
  [0,0,1,1,1,1,1,1,0,0],
];

const COLORS: Record<number, string> = {
  1: "#4a9eff",
  2: "#1a5fa0",
  3: "#e8f4ff",
  4: "#004db5",
  5: "#7fc4ff",
};

const COLS = 10;
const ROWS = 16;

const LEFT_EYE_KEYS  = new Set(["5,2","5,3","6,2","6,3"]);
const RIGHT_EYE_KEYS = new Set(["5,6","5,7","6,6","6,7"]);
const ANTENNA_KEYS   = new Set(["0,3","0,4","0,5","1,3","1,4","1,5"]);

export function WelcomeScreen() {
  const bodyRects: React.ReactElement[]     = [];
  const leftEyeRects: React.ReactElement[]  = [];
  const rightEyeRects: React.ReactElement[] = [];
  const antennaRects: React.ReactElement[]  = [];

  for (let ri = 0; ri < ROWS; ri++) {
    for (let ci = 0; ci < COLS; ci++) {
      const val = GRID[ri][ci];
      if (val === 0) continue;
      const key = `${ri},${ci}`;
      const rect = (
        <rect
          key={key}
          x={ci * PX}
          y={ri * PX}
          width={PX}
          height={PX}
          fill={COLORS[val]}
        />
      );
      if (LEFT_EYE_KEYS.has(key))       leftEyeRects.push(rect);
      else if (RIGHT_EYE_KEYS.has(key)) rightEyeRects.push(rect);
      else if (ANTENNA_KEYS.has(key))   antennaRects.push(rect);
      else                               bodyRects.push(rect);
    }
  }

  return (
    <div className="welcome-screen">
      <div className="welcome-mascot-wrap">
        <svg
          width={COLS * PX}
          height={ROWS * PX}
          viewBox={`0 0 ${COLS * PX} ${ROWS * PX}`}
          shapeRendering="crispEdges"
          style={{ imageRendering: "pixelated" }}
        >
          <g className="mascot-antenna">{antennaRects}</g>
          <g>{bodyRects}</g>
          <g className="mascot-eye mascot-eye-left">{leftEyeRects}</g>
          <g className="mascot-eye mascot-eye-right">{rightEyeRects}</g>
        </svg>
      </div>
      <div className="welcome-text">
        <div className="welcome-title">tertito</div>
        <div className="welcome-hint">Ctrl+O to open a folder</div>
      </div>
    </div>
  );
}
