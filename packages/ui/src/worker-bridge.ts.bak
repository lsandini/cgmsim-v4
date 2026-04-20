/**
 * WorkerBridge — typed wrapper around the simulation WebWorker.
 *
 * Isolates all worker lifecycle management and postMessage calls.
 * The rest of the UI never touches the Worker API directly.
 */

import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
  TickSnapshot,
  StateSavedMessage,
  WorkerState,
  RapidAnalogueType,
  VirtualPatient,
  TherapyProfile,
} from '@cgmsim/shared';

// Vite resolves this at build time via the ?worker suffix
// The worker file path is relative to this module
import SimWorker from './worker-entry?worker';

type TickHandler = (snap: TickSnapshot) => void;
type SavedHandler = (state: WorkerState) => void;

export class WorkerBridge {
  private worker: Worker;
  private tickHandlers: TickHandler[] = [];
  private savedHandlers: SavedHandler[] = [];

  constructor() {
    this.worker = new SimWorker();
    this.worker.addEventListener('message', (e: MessageEvent<WorkerOutboundMessage>) => {
      const msg = e.data;
      if (msg.type === 'TICK') {
        for (const h of this.tickHandlers) h(msg);
      } else if (msg.type === 'STATE_SAVED') {
        for (const h of this.savedHandlers) h(msg.state);
      }
    });
    this.worker.addEventListener('error', (e: ErrorEvent) => {
      console.error('[WorkerBridge] Worker error:', e.message, e.filename, e.lineno);
    });
    this.worker.addEventListener('messageerror', (e: MessageEvent) => {
      console.error('[WorkerBridge] Message error:', e);
    });
  }

  onTick(handler: TickHandler): void {
    this.tickHandlers.push(handler);
  }

  onStateSaved(handler: SavedHandler): void {
    this.savedHandlers.push(handler);
  }

  // ── Convenience send methods ──────────────────────────────────────────────

  send(msg: WorkerInboundMessage): void {
    this.worker.postMessage(msg);
  }

  resume(): void { this.send({ type: 'RESUME' }); }
  pause(): void { this.send({ type: 'PAUSE' }); }

  setThrottle(throttle: number): void {
    this.send({ type: 'SET_THROTTLE', throttle });
  }

  bolus(units: number, analogue?: RapidAnalogueType): void {
    this.send({ type: 'BOLUS', units, ...(analogue ? { analogue } : {}) });
  }

  meal(carbsG: number, gastricEmptyingRate?: number): void {
    this.send({ type: 'MEAL', carbsG, ...(gastricEmptyingRate !== undefined ? { gastricEmptyingRate } : {}) });
  }

  setTarget(targetMgdL: number): void {
    this.send({ type: 'SET_TARGET', targetMgdL });
  }

  setPatientParam(patch: Partial<VirtualPatient>): void {
    this.send({ type: 'SET_PATIENT_PARAM', patch });
  }

  setTherapyParam(patch: Partial<TherapyProfile>): void {
    this.send({ type: 'SET_THERAPY_PARAM', patch });
  }

  requestSave(): void {
    this.send({ type: 'SAVE_STATE' });
  }

  reset(state: WorkerState): void {
    this.send({ type: 'RESET', state });
  }

  terminate(): void {
    this.worker.terminate();
  }
}
