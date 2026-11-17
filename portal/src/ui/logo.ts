// Twinfold's logo, drawn in code: two upright rounded openings (blue and amber) leaning into each
// other like a sheet of paper folded once, with a white crease where they meet, beside the wordmark.
// Original artwork.

export function logoSVG(a = '#2f8cff', b = '#ffa31a', withWord = true): string {
  const word = withWord
    ? `<text x="92" y="58" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif" font-size="44" font-weight="300" letter-spacing="9" fill="currentColor">TWIN<tspan font-weight="700">FOLD</tspan></text>
       <text x="94" y="80" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="9.5" letter-spacing="3.2" fill="currentColor" opacity="0.6">HOLLOWMERE KINEMATICS INSTITUTE</text>`
    : '';
  return `<svg class="logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${withWord ? 470 : 84} 92" role="img" aria-label="Twinfold">
    <defs>
      <clipPath id="tf-crease"><rect x="10" y="10" width="40" height="70" rx="17" transform="rotate(-11 30 45)"/></clipPath>
    </defs>
    <rect x="10" y="10" width="40" height="70" rx="17" transform="rotate(-11 30 45)" fill="none" stroke="${a}" stroke-width="7"/>
    <rect x="32" y="12" width="40" height="70" rx="17" transform="rotate(11 52 47)" fill="none" stroke="${b}" stroke-width="7"/>
    <g clip-path="url(#tf-crease)"><rect x="32" y="12" width="40" height="70" rx="17" transform="rotate(11 52 47)" fill="none" stroke="#ffffff" stroke-width="7"/></g>
    ${word}
  </svg>`;
}
