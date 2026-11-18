// Which app this build is: the full team platform, or the stand-alone motion
// analysis app for people outside the team (docs/DECISIONS.md D27). Set at
// build time (`vite --mode solo`); dead branches are removed from the bundle.
export const SOLO = import.meta.env.VITE_EDITION === 'solo';
