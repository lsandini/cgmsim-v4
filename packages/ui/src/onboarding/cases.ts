import type { VirtualPatient, TherapyProfile, TherapyMode, BasalEntry } from '@cgmsim/shared';
import { DEFAULT_PRESCRIPTION } from '@cgmsim/shared';

export type CaseId = 'lean-recent' | 'average-established' | 'larger-resistant';

export interface PatientCase {
  id: CaseId;
  label: string;
  shortLabel: string;
  description: string;
  patient: VirtualPatient;
}

export const PATIENT_CASES: Record<CaseId, PatientCase> = {
  'lean-recent': {
    id: 'lean-recent',
    label: 'Lean adult, recent diagnosis',
    shortLabel: 'Lean',
    description: '60 kg · 1 yr · insulin sensitive',
    patient: {
      weight: 60,
      diabetesDuration: 1,
      trueISF: 54,
      trueCR: 15,
      dia: 6,
      carbsAbsTime: 360,
      gastricEmptyingRate: 1.0,
    },
  },
  'average-established': {
    id: 'average-established',
    label: 'Average adult, established T1',
    shortLabel: 'Average',
    description: '75 kg · 10 yr · default profile',
    patient: {
      weight: 75,
      diabetesDuration: 10,
      trueISF: 36,
      trueCR: 12,
      dia: 6,
      carbsAbsTime: 360,
      gastricEmptyingRate: 1.0,
    },
  },
  'larger-resistant': {
    id: 'larger-resistant',
    label: 'Larger adult, insulin-resistant',
    shortLabel: 'Larger',
    description: '100 kg · 25 yr · insulin resistant',
    patient: {
      weight: 100,
      diabetesDuration: 25,
      trueISF: 22,
      trueCR: 7,
      dia: 6,
      carbsAbsTime: 360,
      gastricEmptyingRate: 1.0,
    },
  },
};

export type TherapyChoice = 'mdi' | 'pump' | 'aid';

export interface TherapyOption {
  id: TherapyChoice;
  mode: TherapyMode;
  label: string;
  description: string;
}

export const THERAPY_OPTIONS: Record<TherapyChoice, TherapyOption> = {
  mdi: {
    id: 'mdi',
    mode: 'MDI',
    label: 'Pens (MDI)',
    description: 'Long-acting basal + rapid-acting bolus pens. Manual everything.',
  },
  pump: {
    id: 'pump',
    mode: 'PUMP',
    label: 'Standard pump',
    description: 'Programmed basal rate + manual bolus. Open loop.',
  },
  aid: {
    id: 'aid',
    mode: 'AID',
    label: 'AID pump',
    description: 'Closed loop: PID controller adjusts basal automatically.',
  },
};

/**
 * Per-case basal requirements, calibrated empirically against this simulator's
 * physics. Two independent tables because MDI long-acting and pump basal don't
 * have a fixed conversion — the long-acting depot has spread-out PD with some
 * "waste" relative to a flat continuous infusion, so the same patient typically
 * needs slightly less daily insulin on pump than on MDI.
 *
 * Pump rates are on the 0.05 U/hr grid (real pump granularity).
 *
 * Re-validate these if the patient ISFs or other physics parameters change.
 * The 1800-rule formula (TDD ≈ 1800/ISF, basal ≈ 40% of TDD) was tried first
 * but consistently over-dosed.
 */
const BASAL_MDI_U_PER_DAY: Record<CaseId, number> = {
  'lean-recent':         12,
  'average-established': 16,
  'larger-resistant':    31,
};

const BASAL_PUMP_U_PER_HOUR: Record<CaseId, number> = {
  'lean-recent':         0.45,
  'average-established': 0.65,
  'larger-resistant':    1.30,
};

/**
 * Build a TherapyProfile preset for the chosen patient + therapy.
 * MDI gets a single evening Toujeo (GlargineU300) shot at 22:00; pump/AID
 * use a flat basal program at the calibrated hourly rate.
 */
export function buildTherapyForCase(c: PatientCase, choice: TherapyChoice): TherapyProfile {
  const basalRate  = BASAL_PUMP_U_PER_HOUR[c.id];
  const basalDaily = BASAL_MDI_U_PER_DAY[c.id];

  const basalProfile: BasalEntry[] = [{ timeMinutes: 0, rateUPerHour: basalRate }];

  const isMDI = choice === 'mdi';

  return {
    mode: THERAPY_OPTIONS[choice].mode,
    basalProfile,
    rapidAnalogue: 'Fiasp',
    rapidDia: 5,
    longActingMorning: null,
    longActingEvening: isMDI
      ? { type: 'GlargineU300', units: Math.max(1, Math.round(basalDaily)), injectionMinute: 22 * 60 }
      : null,
    glucoseTarget: choice === 'aid' ? 110 : 100,
    enableSMB: false,
    mdiSubmode: 'LIVE',
    prescription: JSON.parse(JSON.stringify(DEFAULT_PRESCRIPTION)),
  };
}
