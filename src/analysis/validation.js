// Validation status registry. Every metric result carries its entry so the UI
// and stored data never present synthetic validation as field validation.
// Keep in sync with docs/validation-status.md.

export const VALIDATION = Object.freeze({
  IMPLEMENTED: 'IMPLEMENTED',
  UNIT_VALIDATED: 'UNIT_VALIDATED',
  FIELD_VALIDATED: 'FIELD_VALIDATED',
});

const unitOnly = Object.freeze({ level: VALIDATION.UNIT_VALIDATED, field: 'PENDING' });

export const METRIC_VALIDATION = Object.freeze({
  qc: unitOnly,
  normalization: unitOnly,
  events: unitOnly,
  headStability: unitOnly,
  stride: unitOnly,
  wristPath: unitOnly,
  timing: unitOnly,
  comparison: unitOnly,
  motionConsistency: unitOnly,
});
