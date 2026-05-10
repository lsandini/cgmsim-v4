import { InlineSimulator } from '../inline-simulator.js';
import { CGMRenderer, setRendererTheme } from '../canvas-renderer.js';
import './mobile-styles.css';

setRendererTheme('dark');

const canvas = document.getElementById('cgm-canvas') as HTMLCanvasElement;
if (!canvas) throw new Error('mobile: #cgm-canvas not found');

const sim = new InlineSimulator();
const renderer = new CGMRenderer(canvas);

renderer.options.displayUnit = 'mmoll';
renderer.options.therapyMode = 'MDI';
// Mobile defaults — overlays the renderer SHOULDN'T draw on the canvas because
// they're presented as top-pill overlays (IOB/COB) instead. The basal strip
// (showBasal=false) leaves a wasteful ~92px PAD_BOTTOM gap because CGMRenderer
// hardcodes PAD_BOTTOM around the assumption a basal panel is shown. Acceptable
// for v1; if mobile chart cropping becomes visible, narrow PAD_BOTTOM via a
// renderer-side option in a future task.
renderer.options.showBasal = false; // Mobile drops the basal strip overlay
renderer.options.showIOB = false;   // IOB shown as a top-pill instead of an overlay
renderer.options.showCOB = false;   // Same as IOB
renderer.options.showForecast = true; // AR2 default on
renderer.options.showTrueGlucose = false;

renderer.setZoom(360); // 6h default
renderer.start();

sim.onTick((snap) => renderer.pushTick(snap));
sim.onEvent((evs) => renderer.pushEvents(evs));

sim.setThrottle(360);
sim.resume();

// Expose for debugging while the rest is built (will be removed in a later task)
(window as any).__mobile = { sim, renderer };
