# CGMSIM v4

## Standalone Glycaemic Teaching Simulation Environment

### Architecture, Design, and Implementation Guide

**Version:** 0.1 — Draft 
**Date:** April 2026 
**Author:** Lorenzo Sandini, MD 
**Project:** cgmsim.com

-----

## Table of Contents

- [0. How to Use This Document](#0-how-to-use-this-document)
- [1. Executive Summary](#1-executive-summary)
- [2. Motivation and Design Philosophy](#2-motivation-and-design-philosophy)
- [3. The Physiological Model](#3-the-physiological-model)
- [4. Virtual Patient and Therapy Parameter Model](#4-virtual-patient-and-therapy-parameter-model)
- [5. Automated Insulin Delivery Controllers](#5-automated-insulin-delivery-controllers)
- [6. Temporal Control System](#6-temporal-control-system)
- [7. System Architecture](#7-system-architecture)
- [8. User Interface Design](#8-user-interface-design)
- [9. Technology Stack](#9-technology-stack)
- [10. Phased Implementation Plan](#10-phased-implementation-plan)
- [11. Open Questions and Decisions Pending](#11-open-questions-and-decisions-pending)

-----

## 0. How to Use This Document

This document is designed to be self-contained: it contains everything needed to begin implementation of CGMSIM v4 in a fresh development session, including the architectural specification, the physiological model, the technology stack, the phased implementation plan, and the open questions that must be resolved before coding begins.

### 0.1 As a Specification for a New AI-Assisted Development Session

The primary use of this document is as the opening brief for a new Claude Code session. Attach this document at the start of the session and open with the following prompt:

> **Recommended opening prompt for a Phase 1 implementation session:**
>
> *I am building CGMSIM v4, a standalone browser-based glycaemic teaching simulator. The full architecture and design specification is attached. I want to start with Phase 1. Read the document carefully before we begin, paying particular attention to sections 3 (Physiological Model), 7 (System Architecture), and 11.1 (Open Questions — Simulation Engine). Then confirm your understanding of the WebWorker tick loop and the deltaBG computation, and identify which open questions from section 11.1 must be resolved before any code is written.*

This framing forces the model to read the specification before writing any code, establishing the architecture as the authoritative source of truth for all implementation decisions. It directs attention to the three sections most relevant to Phase 1, and makes the open questions in section 11.1 the first order of business, ensuring Phase 1 blockers are resolved explicitly before the port begins.

### 0.2 Resolving Open Questions Before Starting

Section 11 contains open questions marked with `> ⚠️ OPEN QUESTION` callouts. Three are Phase 1 blockers and must be answered before writing the WebWorker simulation engine:

- **Glucose model step size (§11.1):** does CGMSIM v3 run one deltaBG computation per 5-minute interval (one step per tick), or does the glucose model step at finer sub-minute resolution with the controller subsampled at 5-minute boundaries? This determines whether the WebWorker tick function is a single computation or requires an inner loop.
- **Controller input signal (§11.1):** do the AID controllers in v3 receive the noisy post-noise CGM value or the true underlying glucose? Must be verified against the v3 source before the port begins.
- **G6 noise state variables (§11.1):** the exact variables that constitute the G6 model state — and must be serialised for session save/restore and identically seeded for comparison runs — have not yet been enumerated. This is a Phase 1 blocker.

The recommended approach is to annotate this document with the answers to these questions directly in section 11.1 before starting the implementation session.

### 0.3 Attaching Source Files from CGMSIM v3

The implementation session will be significantly more productive if the relevant v3 source files are attached alongside this document. 

**CGMSIM v3 Function Library:** The core physiological model functions used by CGMSIM v3 are available in the `@lsandini/cgmsim-lib` npm package at https://www.npmjs.com/package/@lsandini/cgmsim-lib. However, this library includes significant Nightscout integration code that is not needed for v4's standalone browser implementation. Instead of importing the full package, **extract only the essential physiological functions** and create a lightweight reference document containing:

- The deltaBG computation function — the core tick computation the WebWorker replicates
- The biexponential pharmacodynamic profiles for all insulin types (Fiasp, lispro, aspart, glargine, degludec, detemir)
- The carbohydrate absorption model functions
- The IOB and COB computation functions
- The PID controller implementation with fuzzy-logic microbolus layer

These functions should be ported to TypeScript and adapted for the WebWorker execution model, removing any Nightscout-specific dependencies.

**G6 Noise Model:** The G6 sensor noise model (`dexcomG6Noise.js` and `rng.js`) is provided separately and will be ported to TypeScript as a standalone module for Phase 1.

### 0.4 Repository Setup Before the Session

Claude Code works best when creating files in a real project structure from the first message. Before starting the implementation session, create the monorepo structure described in section 7.5 and initialise the git repository. At minimum:

- A new git repository, separate from the CGMSIM v3 repository
- An npm workspaces monorepo root with `packages/simulator`, `packages/ui`, `packages/shared`, and `packages/backend` directories
- A root `package.json` with the workspaces configuration
- A Vite project initialised in `packages/ui` with TypeScript and React templates
- TypeScript strict mode configured across all packages

### 0.5 Phased Session Strategy

Each of the three implementation phases in section 10 is sized for one or two focused development sessions. Start a new session for each phase, attaching this document each time. As implementation progresses, annotate section 10 with notes on what was completed, what deviated from the spec, and what decisions were made that are not yet reflected here. The end-of-phase milestones in section 10 are the acceptance criteria: do not proceed to the next phase until the milestone works correctly in the browser.

### 0.6 Document Versioning

|Version          |Notes                                                                                                                                                           |
|-----------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|
|v0.1 — April 2026|Initial draft. Complete architectural specification through Phase 3. Eleven open questions documented. Annotate §11 with resolved answers before Phase 1 begins.|

-----

## 1. Executive Summary

CGMSIM v4 is a standalone, browser-based glycaemic simulation environment designed exclusively for structured diabetes education sessions. It is the fourth generation of the CGMSIM platform (cgmsim.com), which has been in continuous international use as a real-time simulation tool built around Nightscout. Version 4 represents a fundamental architectural shift: it removes the Nightscout dependency entirely, eliminates the need for external infrastructure, and replaces the clock-driven real-time paradigm with an instructor-controlled temporal model in which simulation time can be paused, run at real speed, or accelerated up to one hundred times.

The core physiological engine — the glucose dynamics model, the biexponential insulin pharmacodynamic profile, the carbohydrate absorption model, the sinusoidal endogenous glucose production function, and both CGM noise models — is preserved unchanged from the existing CGMSIM codebase. Nothing about the physiology is reinvented. What changes is everything around it: the orchestration layer, the persistence layer, and the user-facing interface.

The result is a tool that a diabetes educator can open in any modern browser with no installation, no Nightscout instance, no MongoDB, and no server configuration, and immediately begin running patient scenarios for a teaching session. A full 14-day simulated patient history can be generated in approximately 20 minutes of real time at maximum speed. The simulation can be paused at any moment to discuss the current glucose pattern with an audience, parameters can be adjusted live to explore therapeutic alternatives, and the same scenario can be replayed with different therapy settings to demonstrate the clinical consequences of misconfigured insulin regimens.

This document is the primary architectural and design reference for CGMSIM v4, written as a self-contained implementation guide with sufficient detail to serve as the basis for development, for onboarding a technical collaborator, or for a future publication.

-----

## 2. Motivation and Design Philosophy

### 2.1 The Problem with CGMSIM v3 for Teaching

CGMSIM v3 was designed around a fundamentally different use case from teaching: it simulates a real patient in real time, with data flowing through Nightscout in exactly the same way as a real Nightscout-connected T1D patient. This makes it valuable for demonstrating AID algorithm behaviour over extended periods and for allowing HCPs to develop intuition by observing a virtual patient over days or weeks. However, the real-time constraint is a severe limitation in a teaching context.

A classroom session lasts one to four hours. A single simulated day takes twenty-four real hours. A clinically meaningful 14-day reporting period takes two weeks of wall-clock time. This means that in a live teaching session, CGMSIM v3 can only show a snapshot of a simulation that was started days earlier, which breaks the pedagogical flow entirely: the instructor cannot start a fresh scenario, run it to completion, and discuss the results within a single session.

The second problem is infrastructure. CGMSIM v3 requires a running Nightscout instance, a MongoDB database, and a correctly configured simulation profile before anything can be demonstrated. In a workshop setting this is a significant barrier: even technically capable participants struggle to get everything configured correctly under time pressure, and a single misconfiguration breaks the entire simulation loop.

The third problem is control. In v3, the instructor is a passive observer. The simulation runs at real time and the instructor can inject meals and boluses, but cannot pause, accelerate, or replay. There is no way to show a full day of glucose data in five minutes, no way to freeze the simulation at the exact moment of a hypoglycaemic episode to discuss it with the room, and no way to replay the same scenario with a modified therapy profile to compare outcomes side by side.

### 2.2 The Teaching Simulation Paradigm

CGMSIM v4 is built around the instructor-driven simulation session. The closest analogy is a flight simulator or a medical procedure simulator, where the instructor controls the passage of time, the difficulty of the scenario, and the moment at which the scenario is paused for discussion. This paradigm has several concrete architectural implications: simulation time must be decoupled from wall-clock time; all simulation state must live in memory; the interface must be optimised for a projected screen in a classroom; and the tool must be deployable with a single URL and zero configuration.

### 2.3 The Relationship Between v4 and CGMSIM v3

CGMSIM v4 is not a replacement for v3. The two tools serve different purposes and coexist. CGMSIM v3 remains the appropriate tool for extended individual learning, for generating realistic long-term simulation data, and for validating AID algorithm behaviour over clinically meaningful timescales. CGMSIM v4 is optimised for the live teaching session.

The physiological engine is shared. The long-term goal is to extract this engine into a standalone TypeScript package that both versions import, so that any improvement to the physiological model is automatically available in both tools. In the initial v4 release, the engine is ported by direct copy from the v3 codebase, with shared package extraction deferred until the v4 architecture is proven stable.

### 2.4 Non-Goals

The following are explicitly out of scope for CGMSIM v4, documented here to prevent scope creep during implementation:

- **Real patient data.** CGMSIM v4 operates exclusively on synthetic data generated by its own physiological engine. There are no connectors to LibreView, CareLink, Glooko, or any clinical platform. The tool generates no outputs intended to inform therapy decisions for real patients. This is both a design choice and a regulatory boundary.
- **Report generation.** Although the simulation accumulates a full time-series that could in principle be used to generate an AGP-style report, report generation is explicitly out of scope for v4. It is deferred to a future standalone module.
- **Multi-user synchronisation.** CGMSIM v4 runs a single simulation per browser tab. A classroom setup uses a single instructor machine connected to a projector; individual participant exploration is handled by each person running their own instance.
- **Mobile-first design.** The primary deployment target is a laptop or desktop connected to a projector. Touch interaction and small-screen layout are not design priorities for the initial release.
- **Persistent cloud storage.** Session state is stored in browser IndexedDB and exportable as JSON. There are no user accounts, no cloud storage, and no server-side session persistence in the initial release.

-----

## 3. The Physiological Model

This section documents the computational model that underlies the simulation. Every component described here is ported directly from the v3 codebase. The purpose of this section is to document the model fully enough that its behaviour can be predicted, debugged, and explained to learners without referring to the source code.

### 3.1 The Incremental deltaBG Architecture

The fundamental architectural choice in CGMSIM's glucose model is to compute, at each simulation tick, a *change* in blood glucose rather than an absolute blood glucose value. Every tick, the model computes a deltaBG value — a signed number in mg/dL — and adds it to the previous CGM reading to produce the new CGM reading. This incremental approach is simple, computationally efficient, and clinically intuitive: the four contributors to the delta correspond directly to the four physiological processes a clinician reasons about when interpreting a glucose trace.

**All internal computations in CGMSIM v4 are performed in mg/dL.** The UI provides a display unit selector allowing the instructor to view glucose values in either mg/dL or mmol/L, with conversion applied only at the presentation layer. This ensures computational consistency throughout the simulation engine while supporting international clinical practice preferences.

A simulation tick in CGMSIM v4 occurs every five minutes of simulated time, matching the CGM sampling cadence and the Dexcom G6 sensor update frequency. The tick is the atomic unit of simulation: exactly one CGM reading is produced per tick, and the AID controller fires exactly once per tick. The five-minute interval is not subdivided; there is no inner loop stepping the glucose model at finer resolution. The simulation operates at CGM resolution throughout, which is a simplification appropriate for the teaching use case where the clinically meaningful timescale is minutes to hours, not seconds.

The total deltaBG at each tick is the sum of four independent additive contributions:

|Contribution                 |Description                                                                                                                                                                                 |
|-----------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Insulin effect               |Computed from the biexponential pharmacodynamic activity profile of all active insulin doses, multiplied by the patient's ISF. Produces a negative deltaBG contribution.                    |
|Carbohydrate effect          |Computed from the carbohydrate absorption model applied to all active meal entries, scaled by carbohydrate sensitivity (derived from ISF and ICR). Produces a positive deltaBG contribution.|
|Endogenous Glucose Production|Sinusoidal function of simulation time with a 24-hour period. Models hepatic glucose output and the dawn phenomenon. Parameterised per patient by basal level, amplitude, and peak hour.    |
|CGM noise                    |Stateful G6 sensor noise model recalculated at each tick, carries state forward. Replaces the precomputed Perlin noise approach from v3.                                                    |

> 📦 **Implementation note:** The deltaBG computation and all physiological model functions are extracted from the `@lsandini/cgmsim-lib` npm package and ported to TypeScript for direct inclusion in `packages/simulator`. The G6 noise model is ported separately from the provided JavaScript modules.

### 3.2 The Insulin Effect

Insulin lowers blood glucose by promoting cellular glucose uptake and suppressing hepatic glucose output. The insulin effect at any tick is computed by examining all insulin doses currently within their pharmacodynamically active window — typically covering the past four to five hours — and calculating the activity of each dose using the biexponential pharmacodynamic profile. The sum of all individual dose activities is multiplied by the patient's Insulin Sensitivity Factor to convert it into a glucose change in mg/dL. Because insulin lowers glucose, this contribution is negative.

The biexponential pharmacodynamic profile models the characteristic shape of rapid-acting insulin action: a short delay after injection, a rising phase as the insulin is absorbed from the subcutaneous depot, a peak of activity, and a gradually declining tail. For Fiasp, the default rapid analogue, onset of meaningful activity is approximately 10–15 minutes after injection, peak activity occurs around 55 minutes, and the activity curve approaches zero at approximately 4–5 hours. The biexponential form reproduces this shape with two parameters that have direct physiological interpretations: one governing the absorption rate and one governing the elimination rate.

For lispro and aspart, the same biexponential form is used with different parameter values reflecting their slightly slower onset and longer tail relative to Fiasp. For MDI therapy with long-acting insulin analogues, a separate pharmacodynamic profile is used. Glargine, degludec, and detemir all have significantly flatter activity curves: their onset is delayed by one to two hours, their peak is much less pronounced, and their duration extends to 20–42 hours. Degludec in particular has a near-peakless profile with a duration approaching 42 hours.

**Insulin On Board (IOB) is computed using IOB calculation functions ported from the CGMSIM v3 codebase.** All insulin doses are accounted for and summed: declared long-acting basal insulin (for MDI therapy), mealtime boluses, scheduled infusion rates (for pump therapy), and temporary basal rates. The ported functions handle the pharmacodynamic profiles for each insulin type and return the total IOB at each tick, which is then used by both the insulin effect calculation and the AID controller.

### 3.3 The Carbohydrate Effect

Carbohydrates raise blood glucose by providing substrate for intestinal absorption. The carbohydrate effect at any tick is computed analogously to the insulin effect: all meal events within the absorption window are examined, the absorption activity of each meal is computed using an absorption curve, and the total is multiplied by a carbohydrate sensitivity factor to produce a positive glucose change in mg/dL.

The absorption curve models gastric emptying and intestinal absorption. It rises from zero at meal entry, peaks at a time determined by the gastric emptying rate parameter, and falls back toward zero as carbohydrates are fully absorbed. The total area under the curve for a given meal is proportional to its carbohydrate content in grams. A slow gastric emptying rate — representing a high-fat or high-fibre meal — produces a broader, flatter absorption peak and a longer tail, while a fast rate produces an early, sharp peak typical of rapidly absorbed carbohydrates.

The carbohydrate sensitivity factor is derived from the patient's insulin-to-carbohydrate ratio and ISF. When the therapy is miscalibrated — which is frequently the case in teaching scenarios — the actual glucose excursion differs from what the bolus advisor predicts. That discrepancy *is* the teaching point.

**Carbs On Board (COB) is computed using COB calculation functions ported from the CGMSIM v3 codebase.** The ported functions apply the absorption curve to all active meal entries and return the total COB at each tick.

### 3.4 Endogenous Glucose Production

Endogenous glucose production is the liver's continuous output of glucose into the circulation, independent of dietary carbohydrate intake. In type 1 diabetes, the portal insulin concentration is abnormally low because subcutaneous insulin does not replicate the portal insulin peak that occurs after pancreatic secretion, and the counter-regulatory response is often blunted after many years of disease. EGP is therefore an important contributor to glucose variability in T1D that learners focusing primarily on meal and insulin management tend to underestimate.

In CGMSIM, EGP is modelled as a sinusoidal function of simulation time with a 24-hour period. This captures the most clinically important feature of EGP in T1D: the **dawn phenomenon** — the rise in blood glucose in the early morning hours due to the circadian increase in cortisol and growth hormone, which stimulate hepatic glucose output. In a patient with an uncovered dawn phenomenon, fasting glucose rises between approximately 03:00 and 07:00 even with zero insulin on board and no carbohydrate intake. This is one of the most common and most educationally important patterns in T1D glucose management.

The sinusoidal EGP model is parameterised by three values: the basal EGP level (the average hepatic glucose contribution across the full 24-hour period); the amplitude (determining how large the dawn rise is); and the peak hour (the time of day at which EGP is maximal).

> 📝 **Note:** A glucose-dependent extension of the EGP model — counter-regulatory activation during hypoglycaemia, partial suppression during hyperglycaemia — is identified as a high-value future enhancement (Phase 4). In a patient with intact counter-regulation, a falling blood glucose triggers hepatic glucose output that partially attenuates the hypoglycaemic episode. In long-standing T1D this mechanism is absent, and hypoglycaemic episodes are both more severe and more prolonged. This difference is one of the most clinically important distinctions between a newly diagnosed patient and a patient with twenty or more years of disease.

### 3.5 CGM Noise

The CGM signal produced by the simulation is not the true blood glucose; it is a noisy approximation of interstitial glucose. This distinction matters for two reasons. First, it is physiologically accurate: real CGMs measure interstitial glucose, which lags behind blood glucose by approximately 5–15 minutes. Second, it is pedagogically important: AID controllers receive the noisy CGM signal as their input, not the true glucose. Learners who observe the controller making apparently suboptimal decisions are observing the same phenomenon that confuses patients and clinicians in real life — the algorithm is reacting to an imperfect signal.

CGMSIM v4 uses the stateful G6 sensor noise model based on the Vettoretti 2019 model, implemented using two AR(2) autoregressive processes plus deterministic drift polynomials. The noise value is recalculated at each tick by calling `getNextNoise()`, with the model's internal state carried forward from the previous tick.

**G6 Noise State Variables:** The complete state that must be serialized for session save/restore and comparison runs consists of:
- `v` — array [v_t-2, v_t-1] for the sensor-specific AR(2) process
- `cc` — array [cc_t-2, cc_t-1] for the common component AR(2) process
- `tCalib` — calibration timestamp in milliseconds (for deterministic drift polynomials)
- `rng` — the Ziggurat RNG state (single value: `jsr`)

The DexcomG6Noise class provides `getState()` and `setState()` methods that return and restore this complete state, making integration with the WebWorker's SAVE_STATE and RESET message handlers straightforward.

-----

## 4. Virtual Patient and Therapy Parameter Model

One of the most important design features of CGMSIM, carried forward unchanged into v4, is the explicit separation of the virtual patient's physiological parameters from the therapy settings programmed into the device. This separation is not merely organisational; it is the primary mechanism through which the simulation generates clinically instructive scenarios.

### 4.1 Why Two Layers Are Necessary

In real clinical practice, the most important and most frequently overlooked distinction in diabetes management is the difference between what a patient's body actually requires and what has been programmed into their device. A patient may have a true insulin-to-carbohydrate ratio of 1 unit per 10 grams of carbohydrate, but their pump may be programmed with 1 unit per 14 grams — a setting determined empirically years ago and never updated as sensitivity changed. This single miscalibration produces systematic postprandial hyperglycaemia at every meal, and the pattern is exactly what a skilled clinician looks for when reviewing a glucose trace: not random variability, but a consistent directional deviation pointing to a specific therapy setting being wrong.

Teaching this kind of pattern recognition is the core purpose of CGMSIM v4. To teach it, the simulation must represent both the physiological truth — what the body actually does — and the programmed reality — what the device has been told to do. The gap between these two defines the clinical problem. If the simulation only had one parameter set, it could not create the intentional discrepancies that make the most educationally valuable scenarios.

### 4.2 The Physiological Layer

The physiological layer defines the biological characteristics of the virtual patient. These parameters represent ground truth: they determine how the body actually responds to insulin, carbohydrates, and time of day, independent of therapy. Critically, these parameters are not directly observable from the CGM trace; the learner must infer them from the pattern of glucose responses over time, exactly as a clinician does in real practice.

|Parameter                           |Description and clinical rationale                                                                                                                                                                                                                         |
|------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Weight (kg)                         |Body weight. Used to scale insulin dose requirements, as insulin sensitivity is partially a function of body mass.                                                                                                                                         |
|Age (years)                         |Influences overall insulin sensitivity; older patients generally require more insulin per unit of body weight than children and adolescents.                                                                                                               |
|Gender                              |Influences basal metabolic rate and EGP amplitude, reflecting known sex differences in insulin sensitivity and hepatic glucose metabolism.                                                                                                                 |
|Diabetes duration (years)           |The most important determinant of counter-regulatory integrity in the planned glucose-dependent EGP extension. A patient with 30 years of T1D has a very different glucose profile from a newly diagnosed patient, even with identical programmed settings.|
|True ISF (mg/dL per unit)           |The actual insulin sensitivity factor — how much one unit of rapid-acting insulin lowers blood glucose in fasting conditions. Physiological truth. May vary across the day.                                                                                |
|True carbohydrate ratio (g per unit)|The actual ICR. Physiological truth. Frequently differs from what is programmed in the device.                                                                                                                                                             |
|EGP basal level                     |The average hepatic glucose contribution across the 24-hour period. Sets the floor of the sinusoidal EGP function.                                                                                                                                         |
|EGP amplitude                       |The magnitude of the dawn phenomenon. A high amplitude produces a large fasting glucose rise; a low amplitude produces a flat fasting baseline.                                                                                                            |
|EGP peak hour                       |The time of day at which hepatic glucose output is maximal. Typically 04:00–07:00 but varies between patients.                                                                                                                                             |
|Gastric emptying rate               |Controls the speed of carbohydrate absorption. Slow = high-fat meal simulation. Fast = rapidly absorbed carbohydrates.                                                                                                                                     |
|Insulin absorption variability      |Coefficient of variation on subcutaneous depot absorption. Adds realistic noise to bolus responses.                                                                                                                                                        |

### 4.3 The Therapy Profile Layer

The therapy profile defines what the patient's device has been programmed to do. In CGMSIM v3, this information is held in the Nightscout profile. In v4, it is configured directly in the instructor panel — the structure is identical, but no Nightscout instance is required.

The therapy profile is the layer the instructor explicitly manipulates when designing teaching scenarios. A perfectly calibrated therapy profile produces the least interesting teaching scenario. The most valuable scenarios are those where one or more settings are deliberately miscalibrated to produce a recognisable, clinically realistic glucose pattern.

|Setting                                   |Description and clinical rationale                                                                                                                                             |
|------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Therapy mode                              |MDI, conventional pump, or AID. Determines which delivery mechanism computes basal insulin delivery each tick.                                                                 |
|Programmed ISF (mg/dL per unit)           |The ISF as programmed. If higher than true ISF, patient is under-corrected; if lower, over-corrected.                                                                          |
|Programmed carbohydrate ratio (g per unit)|The ICR as programmed. If higher than true ICR, meal boluses are insufficient and postprandial hyperglycaemia results. If lower, post-meal hypoglycaemia.                      |
|Basal profile (24-hour schedule)          |Programmed basal rates in units per hour as a 24-hour step function. A flat overnight profile that does not increase during the pre-dawn hours will fail to cover the EGP rise.|
|Long-acting insulin type                  |For MDI: glargine, degludec, or detemir. Each has a distinct PD profile modelled separately.                                                                                   |
|Long-acting insulin dose (units)          |Total daily dose for MDI therapy.                                                                                                                                              |
|Long-acting insulin injection time        |Time of day of injection, in simulated time. Affects temporal distribution of basal coverage.                                                                                  |
|Rapid-acting analogue type                |Fiasp, lispro, or aspart. Determines which biexponential PD parameters are used for all bolus and pump basal deliveries.                                                       |
|Glucose target (AID)                      |Setpoint glucose concentration in mg/dL the AID controller attempts to maintain.                                                                                               |
|Bolus advisor target glucose              |Target glucose used by the bolus advisor when computing correction components.                                                                                                 |
|Bolus advisor correction threshold        |Glucose value above which the advisor will include a correction component.                                                                                                     |

### 4.4 Designed Mismatch Scenarios

The following are the initial library of pre-built teaching scenarios. Each is defined by a specific physiological configuration and a deliberate therapy profile miscalibration. The clinical consequence — the glucose pattern that results — is what the learner is asked to identify and explain. The instructor then corrects the miscalibration live and reruns the scenario to demonstrate the effect of the fix.

|Scenario                                                   |Configuration                                                                                                 |Expected glucose pattern and learning objective                                                                                                                                                                                       |
|-----------------------------------------------------------|--------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Dawn phenomenon, uncovered                                 |High EGP amplitude; EGP peak at 05:30. Flat overnight basal profile.                                          |Fasting glucose rises progressively from midnight, reaching 12–15 mmol/L by 07:00 with zero IOB. Learners identify the pattern, recognise it is not due to overnight carbohydrate intake, and propose increased basal rate from 03:00.|
|Over-aggressive ICR at dinner                              |True ICR: 12 g/unit. Programmed ICR: 8 g/unit.                                                                |Meal bolus for a 60 g dinner is 7.5 units instead of the physiologically appropriate 5. Post-dinner hypoglycaemia at approximately 90 minutes, consistently across simulated dinner events.                                           |
|Conservative ISF, persistent post-correction hyperglycaemia|True ISF: 40 mg/dL/unit. Programmed ISF: 60 mg/dL/unit.                                                       |Correction boluses are systematically insufficient. Glucose returns toward but does not reach target, remaining 3–4 mmol/L above target for 2–3 hours. Teaches risk of stacking inadequate correction boluses.                        |
|Delayed meal bolus in AID mode                             |Well-calibrated physiology and therapy. Meal bolus injected 30 minutes after carbohydrate entry.              |Postprandial spike followed by late hypoglycaemia as bolus overlaps with end of absorption. AID controller may add auto-correction worsening the hypo. Demonstrates critical importance of pre-meal bolus timing even in AID systems. |
|MDI vs AID on identical patient                            |Identical physiological parameters. Same meal scenario. Therapy mode changed from MDI to AID (PID controller).|Two runs side by side. MDI shows wider excursions and more time outside range. AID shows tighter control. Demonstrates measurable AID benefit without requiring data from a real clinical trial.                                      |
|Long-duration T1D, blunted counter-regulation *(Phase 4)*  |Diabetes duration 28 years. Counter-regulatory integrity near zero. Overnight basal slightly over-delivered.  |Nocturnal hypo occurs around 03:00. EGP counter-regulatory response absent; glucose continues to fall. AID suspends delivery but recovery is slow and incomplete. Demonstrates hypoglycaemia unawareness risk.                        |

-----

## 5. Automated Insulin Delivery Controller

In AID therapy mode, the decision about how much insulin to deliver at each simulation tick is made by a controller algorithm rather than by a static basal programme. The controller runs once per tick, receives the current CGM reading — the noisy sensor value, **not the true glucose** — and the current IOB, and outputs an insulin delivery amount in units per hour.

The fact that the controller receives the noisy CGM signal rather than true glucose is both physiologically accurate and pedagogically deliberate. Real AID systems have no access to true blood glucose; they operate entirely on sensor data. When the CGM signal contains a compression artefact, a calibration error, or an unusual noise pattern, the controller responds to that artefact as if it were a real glucose change. Demonstrating this in the simulation is a valuable teaching opportunity.

### 5.1 PID Controller

The PID controller is used for all CGMSIM v4 teaching sessions. It is simple, computationally efficient, and pedagogically transparent. A learner with no background in control theory can understand how it works within five minutes.

A PID controller computes its output as the sum of three terms:

- **Proportional term.** Responds to the current error: the difference between the current CGM reading and the target glucose. Provides the primary driving force but on its own will never fully eliminate the error — it is always reacting, never anticipating.
- **Integral term.** Responds to the accumulated error over time. Eliminates the steady-state offset that a pure proportional controller leaves. In the context of AID, the integral term is what allows the controller to correct for persistent errors caused by miscalibrated basal rates: if the programmed basal is too low, glucose will trend upward, the integral term will build, and the controller will add correction delivery until a new steady state is reached.
- **Derivative term.** Responds to the rate of change of the CGM signal. If glucose is rising rapidly, the derivative term adds extra insulin delivery in anticipation of where glucose will be in fifteen minutes. Because it acts on the noisy CGM signal, it is sensitive to sensor noise — exactly why real PID-based AID systems use CGM smoothing.

In addition to the three standard PID terms, CGMSIM's PID controller includes a fuzzy-logic microbolus layer developed in the v3 codebase. This layer adds small bolus corrections when both the PID output and the current glucose trajectory indicate a bolus is appropriate, making the controller more representative of modern commercial AID behaviour.

### 5.2 Controller Speed Cap

The PID controller has a maximum simulation speed of ×100, which is the lowest computational cost of all possible controller implementations. This speed is fast enough for maximum acceleration on any modern device.

> ⚡ **Design decision:** The ×100 speed cap is an initial estimate based on v3 experience. It must be validated by benchmarking on representative teaching hardware (a mid-range laptop) during Phase 1 development. If the PID controller runs at ×100 on a 2019 MacBook Pro with acceptable frame rates, the cap is confirmed. If not, it must be reduced.

-----

## 6. Temporal Control System

Temporal control is the defining feature of CGMSIM v4. It transforms the simulation from a passive, clock-driven observation tool into an active, instructor-driven teaching instrument.

### 6.1 Decoupling Simulation Time from Wall-Clock Time

In CGMSIM v3, simulation time and wall-clock time are identical: the cron job fires every five real minutes, and each firing represents exactly five minutes of simulated time. The simulation cannot run faster than real time and cannot be paused without losing the simulation state.

In CGMSIM v4, simulation time and wall-clock time are completely decoupled. The WebWorker maintains a simulation time counter that increments by exactly five minutes on each tick, regardless of how much real time has elapsed between ticks. The throttle parameter determines the relationship: at ×1 speed, one tick occurs every five real minutes; at ×100 speed, one tick occurs every three real seconds; when paused, no ticks occur at all but simulation state is preserved in memory indefinitely.

This decoupling is achieved in the WebWorker by driving the tick loop with a `setInterval` call whose interval duration is `(300,000 ms ÷ throttle factor)`. When the instructor moves the throttle slider, the worker receives a `SET_THROTTLE` message, cancels the existing `setInterval`, and restarts it with the new interval. The simulation state is entirely unaffected by this change.

### 6.2 The Speed Spectrum

|Speed setting |Real-time interval per tick|Practical use case                                                                                                                                                                                                                   |
|--------------|---------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Paused        |—                          |The `setInterval` is cancelled. Worker holds complete state in memory indefinitely. Instructor may freely adjust parameters, examine values, inject treatments. Resuming continues from the exact halted state with no discontinuity.|
|×0.25         |Every 20 real minutes      |Sub-real-time. Detailed examination of rapid glucose dynamics. A 30-minute postprandial excursion takes 2 real hours. Primarily useful for individual self-study.                                                                    |
|×0.5          |Every 10 real minutes      |Useful when walking through an event slowly while commenting in detail.                                                                                                                                                              |
|×1 (real time)|Every 5 real minutes       |Matches the CGM cadence of a real patient. A simulated day takes 24 real hours.                                                                                                                                                      |
|×5            |Every 60 real seconds      |A simulated day passes in approximately 4.8 real hours.                                                                                                                                                                              |
|×10           |Every 30 real seconds      |A simulated day passes in approximately 2.4 real hours.                                                                                                                                                                              |
|×50           |Every 6 real seconds       |A full 14-day simulated period completes in approximately 33 real minutes.                                                                                                                                                           |
|×100          |Every 3 real seconds       |A full 14-day period completes in approximately 17 real minutes. Maximum speed for standard teaching hardware with PID controller.                                                                                                   |

### 6.3 The Instructor Event System

Simulation time in CGMSIM v4 is unidirectional: it always moves forward, and events take effect immediately on the next tick. There is no retroactive history modification. Instructor events are typed messages sent from the main thread to the WebWorker via `postMessage`.

|Event type         |Description and parameters                                                                                                                                                                                                           |
|-------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|`BOLUS`            |Inject a specified number of units of rapid-acting insulin immediately into the active insulin pool. Parameters: amount (units); analogue type (defaults to therapy profile setting).                                                |
|`MEAL`             |Add a carbohydrate absorption event. Parameters: carbohydrate content (grams); gastric emptying rate modifier (optional; overrides patient default for this meal only).                                                              |
|`SET_BASAL`        |Override the programmed basal rate from current simulation time forward. In pump mode sets a temporary basal rate. Parameters: rate (units/hr); duration in simulated minutes (optional; omit to persist until changed).             |
|`SET_TARGET`       |Change the AID controller's glucose target from current time forward. For demonstrating exercise mode or pre-meal target reduction. Parameters: target glucose (mg/dL).                                                              |
|`SET_PATIENT_PARAM`|Modify any virtual patient physiological parameter with immediate effect. The primary mechanism for live what-if exploration.                                                                                                        |
|`SET_THERAPY_PARAM`|Modify any therapy profile setting with immediate effect. The primary mechanism for demonstrating therapy corrections live.                                                                                                          |
|`SET_THROTTLE`     |Change the simulation speed. Worker cancels current `setInterval` and restarts with new interval. Current tick completes normally before change takes effect.                                                                        |
|`PAUSE`            |Cancel the `setInterval`. Worker enters waiting state, preserving all simulation state in memory.                                                                                                                                    |
|`RESUME`           |Restart the `setInterval` at the current throttle setting. Next tick fires immediately.                                                                                                                                              |
|`SAVE_STATE`       |Serialise the complete WebWorker state to JSON and post to main thread for storage in IndexedDB. Triggered by explicit instructor action or configurable auto-save interval (default: every 10 simulated minutes), not on every tick.|
|`RESET`            |Restore the WebWorker state from a previously serialised snapshot. Used for loading saved scenarios, restoring pre-run state before a comparison run, and scenario reset.                                                            |

### 6.4 Comparison Runs

The comparison run feature allows the instructor to run the same scenario twice with different configurations and display the two resulting CGM traces side by side. This is one of the most powerful teaching tools in the application: it transforms an abstract parameter change into a visible, measurable outcome difference the whole class can observe simultaneously.

The implementation requires two independent WebWorker instances running in parallel. The two workers receive identical `RESET` events at the start of the comparison to ensure they begin from the same state. They then diverge based on different `SET_THERAPY_PARAM` or `SET_PATIENT_PARAM` events applied to one worker but not the other. Both workers post tick snapshots to the main thread, which renders the two CGM traces on the same canvas using different colours.

For comparison runs to be scientifically meaningful, the stochastic components must be identical. The G6 noise model is initialised with the same seed value in both workers so that its stateful evolution is identical between runs.

-----

## 7. System Architecture

CGMSIM v4 is a browser-first single-page application with an optional lightweight backend. The architectural principle is maximum functionality with minimum infrastructure: the simulation, the visualisation, and the instructor interface all run in the browser. In practice, CGMSIM v4 can be run entirely from a single HTML file served over localhost.

### 7.1 The WebWorker Simulation Engine

The WebWorker is the heart of CGMSIM v4. It runs the simulation tick loop, owns all simulation state, and is the only component that touches the physiological model. By running in a dedicated worker thread, it is completely isolated from the UI thread, which means that even at maximum simulation speed the interface remains responsive and animation does not stutter.

The WebWorker is a long-lived thread created when the application starts and destroyed when the browser tab is closed. It does not restart between simulation sessions; instead, a `RESET` event restores it to a known initial state. The worker has no network access and makes no external API calls. All simulation state is internal, and the only way to interact with it is through the typed message interface.

### 7.2 The Main Thread and UI

The main thread hosts the React application providing the instructor interface. It communicates with the WebWorker exclusively through the typed `postMessage` interface. Tick snapshots received from the worker are processed to update the UI. The main thread never directly accesses simulation state; it only sees the snapshot data the worker includes in each tick message.

Tick snapshots are deliberately minimal: they contain only the data the UI needs to render the current state. The full simulation state is never transmitted to the main thread except as part of an explicit `SAVE_STATE` serialisation. This keeps `postMessage` overhead low even at high tick rates.

### 7.3 The Canvas Renderer

The CGM trace is rendered on an HTML Canvas element using the 2D rendering context and a `requestAnimationFrame` loop targeting 60 fps. The renderer is entirely independent of the simulation tick rate: it reads the latest state from a shared buffer the main thread updates on receipt of each tick snapshot. If multiple ticks have occurred since the last animation frame — which happens at high simulation speeds — only the most recent tick state is rendered. Attempting to render every tick at ×100 would require 2,000 canvas redraws per second, far beyond the display refresh rate.

The renderer maintains a buffer of CGM readings for a 24-hour window, with the display showing 18 hours of historical data plus 6 hours of empty "future" space. For the first 18 hours of simulation, the trace grows from left to right with midnight fixed at the left edge. Once the simulation reaches 18:00, the entire window begins scrolling leftward to maintain the 18+6 hour split. The buffer is implemented as a circular array to avoid the cost of shifting elements on every tick.

Canvas layers (rendered in order): background with target range and threshold bands; carbohydrate activity fill; insulin activity fill; CGM trace line; bolus and meal event markers; axis labels and time indicators; display unit selector in corner. Target range and threshold colours follow ATTD international consensus standards: green (70–180 mg/dL / 3.9–10.0 mmol/L), amber (54–70 mg/dL / 3.0–3.9 mmol/L), red (<54 mg/dL / <3.0 mmol/L).

### 7.4 IndexedDB Session Persistence

Browser IndexedDB stores three categories of data:

- **SimulationState:** the serialised WebWorker state snapshot for session save and restore
- **SessionHistory:** the append-only log of all CGM readings and treatment events since session start
- **Scenarios:** named parameter sets loadable at session start

The serialised worker state snapshot is constructed by the `SAVE_STATE` message handler in the worker and written to IndexedDB via the `idb` library. On session load, the snapshot is retrieved and sent to the worker as a `RESET` message, restoring the simulation exactly.

Session export is provided as a JSON file download packaging the complete SessionHistory and current SimulationState into a single portable file that can be shared with colleagues.

### 7.5 Monorepo Package Structure

The project is structured as an npm workspaces monorepo with `packages/simulator` treated as an internal workspace package. It will be published as a standalone npm package only when the v4 architecture is proven stable enough to be considered a public interface.

|Package                        |Contents and responsibilities                                                                                                                                                                                                                                                                                                                            |
|-------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|`packages/simulator`           |The WebWorker simulation engine. Contains the physiological model, the PID controller, both noise models, the IOB and COB accumulators, the tick loop orchestration, and the worker message handler. No dependencies on browser APIs; fully unit-testable in Node.js. Primary candidate for future extraction as a shared dependency with CGMSIM v3.|
|`packages/ui`                  |The React frontend application. Built with Vite. Contains the Canvas renderer, the Zustand store, the instructor panel component tree, the throttle control, the event injection interface, and session management UI. Imports from `packages/simulator` only via the typed message interface; never directly imports simulation logic.                      |
|`packages/shared`              |Shared TypeScript type definitions only. Contains WebWorker message types (both inbound instructor events and outbound tick snapshots), the virtual patient parameter interface, the therapy profile interface, the session history record type, and the scenario JSON schema. No runtime code. Both `packages/simulator` and `packages/ui` import from here.|
|`packages/backend` *(Phase 3+)*|The optional Fastify server. Not required for the initial release. Contains the AI narrative endpoint and optional scenario persistence endpoints.                                                                                                                                                                                                           |

-----

## 8. User Interface Design

The UI is designed for a specific deployment context: a laptop or desktop connected to a projector in a classroom or conference room, operated by a clinician instructor simultaneously managing the simulation and addressing an audience. Everything must be legible at ten metres' distance, controls must be large enough to operate quickly without looking away from the audience, and the aesthetic must be credible to a clinical audience that expects professional-grade tools.

### 8.1 Overall Layout

The application uses a single-page layout with three functional zones. The **CGM trace** occupies the upper two-thirds of the viewport and is always visible. A **control strip** at the bottom contains the most frequently used controls: the throttle slider, pause/resume, the simulated time display, and quick-access injection buttons (standard meal, correction bolus). A **collapsible side panel** on the right provides access to full parameter configuration, scenario management, and session controls. The panel can be hidden during a live teaching session to give the CGM trace maximum screen space.

### 8.2 The CGM Trace Canvas

The trace canvas displays a 24-hour window spanning the full width of the screen, with each simulated day starting at 00:00 (midnight) at the left edge. The display is divided conceptually into an 18-hour filled region and a 6-hour empty region to the right, creating a visual "space to fill" that shows where the simulation is headed.

**Scrolling behavior:**
- For the first 18 hours of simulation (00:00 to 18:00), the trace grows from left to right with no scrolling. The timeline remains fixed with midnight at the left edge.
- Once the simulation reaches 18:00, the entire trace begins scrolling leftward so that the most recent 18 hours of data remain visible, with the next 6 hours displayed as empty space to the right.
- This maintains a constant visual window: 18 hours of historical data plus 6 hours of "future" space, totaling 24 hours across the screen width.

**Time perception at speed:** At ×100 simulation speed, 60 simulated minutes pass in 36 real seconds (0.6 minutes). A full 24-hour day scrolls across the screen in approximately 14.4 real minutes, which provides good visibility of glucose patterns while maintaining teaching session practicality.

The canvas includes a **display unit selector** in the corner, allowing the instructor to toggle between mg/dL and mmol/L. When mmol/L is selected, all glucose values on the canvas — the trace line, the axis labels, the target range bands, and the threshold markers — are converted and displayed in mmol/L (1 mmol/L = 18.0182 mg/dL). The conversion is purely presentational; all internal computation remains in mg/dL.

Available overlays (each independently toggleable):

- Target range band (70–180 mg/dL / 3.9–10.0 mmol/L, configurable): shaded green
- Level 1 hypoglycaemia band (54–70 mg/dL / 3.0–3.9 mmol/L): shaded amber
- Level 2 hypoglycaemia band (<54 mg/dL / <3.0 mmol/L): shaded red
- Insulin activity curve: filled area below the glucose axis, scaled to IOB
- Carbohydrate absorption curve: filled area above baseline, scaled to COB
- Basal rate profile: step chart on secondary axis
- Bolus events: vertical markers at time of injection
- Meal events: icons at time of carbohydrate entry

The trace line itself changes colour as it enters the hypoglycaemic ranges, creating a strong visual alert legible on a projected screen at distance.

### 8.3 The Throttle Control

A prominent horizontal slider with labelled stops at each speed setting. Stops above the active controller's ceiling are visually disabled and the slider cannot be moved past them. When the instructor selects a different controller, the slider automatically snaps back to the highest available speed if the current speed exceeds the new ceiling. Adjacent to the throttle slider is the simulated time display, formatted as `D+HH:MM`, allowing the instructor and audience to maintain temporal orientation during fast playback.

### 8.4 The Instructor Panel

The collapsible instructor panel is organised into four tabs:

- **Patient tab:** all virtual patient physiological parameters with numeric input fields and range sliders. These parameters (true ISF, true ICR, EGP settings, gastric emptying rate) define the biological ground truth and cannot be changed during a running simulation.
- **Therapy tab:** all therapy profile settings including therapy mode selector, 24-hour basal profile editor (table of time-value pairs matching real insulin pump interfaces), and bolus advisor settings. These parameters can be changed on the fly with immediate effect on the next tick.
- **Events tab:** manual injection controls — bolus entry with insulin type selector, and meal entry with carbohydrate content and absorption rate
- **Session tab:** scenario save and load, comparison run setup, and session export

Therapy profile parameter changes take effect immediately via `SET_THERAPY_PARAM` events to the worker with no smoothing or ramping applied. The abrupt change in therapy settings is pedagogically appropriate for demonstrating corrections. There is no separate apply button; the simulation responds to therapy parameter changes in real time, enabling live what-if explorations without pausing. No visual indication of parameter changes is required beyond the parameter value updating in the instructor panel.

### 8.5 Visual Design Principles

The application uses a dark theme as its default. This provides two advantages in a teaching context: it is easier on the eyes during a multi-hour workshop session, and dark-themed UIs project more clearly in rooms with imperfect blackout. The CGM trace is rendered as a glowing line against the dark background using a subtle glow effect — a slightly wider, lower-opacity copy of the trace line underneath the main line — making it visually striking and immediately readable at the back of a lecture theatre.

Typography uses a large base size throughout. All interactive controls meet minimum touch targets of 44×44 pixels even though the primary input device is a mouse, to accommodate instructors using a trackpad or pointing device from a distance.

-----

## 9. Technology Stack

The technology stack minimises infrastructure requirements, prioritises performance and bundle size for standalone browser deployment, and avoids introducing unnecessary complexity that would complicate future maintenance.

### 9.1 Language: TypeScript Throughout

TypeScript with strict mode enabled is used throughout the entire codebase: WebWorker simulation engine, UI layer, shared type definitions, and optional backend. The simulation model in particular benefits significantly from TypeScript's type system: the virtual patient interface, the therapy profile interface, the WebWorker state type, and the message interface types are all non-trivial data structures that would be difficult to maintain correctly without compile-time checking. The investment in comprehensive typing pays off during the porting of the v3 engine, where TypeScript catches many of the subtle unit and range errors common in physiological model implementations.

> 📦 **CGMSIM v3 functions:** The essential physiological model functions from CGMSIM v3 will be extracted from the `@lsandini/cgmsim-lib` package and ported to TypeScript for `packages/simulator`. Only the core computation functions are needed — deltaBG, insulin pharmacodynamics, carbohydrate absorption, IOB/COB calculations, and the PID controller — without the Nightscout integration layer. The G6 noise model is ported separately from the provided JavaScript modules.

### 9.2 Build Tooling: Vite

Vite is the build tool and development server for all packages. Vite's native support for WebWorker bundling via the `?worker` import syntax is the primary reason for choosing it: the WebWorker can be imported directly into the main thread module and Vite handles all bundling, code-splitting, and URL generation automatically. This eliminates the manual worker registration boilerplate that older build tools require. Vite's hot module replacement is also significantly faster than webpack-based alternatives, which matters during active development when simulation parameters are being tuned frequently.

Vite is used in library mode for `packages/simulator` to produce a clean ESM bundle, and in standard SPA mode for `packages/ui` to produce the final static HTML/JS/CSS bundle.

### 9.3 UI Framework: Vanilla TypeScript with Optional React Migration

The initial implementation uses **vanilla TypeScript with no UI framework**. This provides the lightest possible bundle, fastest load time, and most direct control over the instructor interface. The instructor panel is fundamentally a set of form inputs with event handlers — a use case that doesn't require framework complexity.

**Phase 1-2 approach:**
- Pure TypeScript modules for UI components
- Direct DOM manipulation via typed element references
- Event delegation for form interactions
- Simple state object for UI-relevant values (throttle, current CGM, panel visibility)
- No virtual DOM, no reconciliation overhead, no framework bundle

**Migration path:** If UI complexity grows beyond simple forms and the development velocity would benefit from React's component model, the architecture supports migration:
- The WebWorker message interface is framework-agnostic
- The Canvas renderer is already isolated from any framework
- Form handling can be wrapped in React components incrementally

The CGM trace canvas is explicitly **not** managed by any framework; it uses a direct ref to the Canvas element and a `requestAnimationFrame` loop. This ensures 60fps rendering is never blocked by framework reconciliation.

### 9.4 Canvas Rendering

The CGM trace uses the raw HTML Canvas 2D API. No charting library is used for the real-time animated trace. Charting libraries such as Chart.js and D3, while excellent for static charts, introduce abstractions that work against the low-latency frame-rate-driven rendering required by an animated simulation. The custom Canvas renderer gives complete control over layered compositing, the glow effect on the trace line, the rolling buffer management, and the precise timing of frame updates.

### 9.5 WebWorker Implementation Details

The WebWorker is a TypeScript module compiled by Vite into a separate worker bundle. It exports nothing; it is entirely self-contained. At very high simulation speeds (×100), the `setInterval` interval is 3,000 ms, well within the range that browsers handle accurately. If the CPU is saturated by tick computation, the interval may slip. The worker does not attempt to compensate for slipped ticks by running multiple ticks in catch-up mode; it simply runs the next tick when it fires and advances by exactly one 5-minute tick interval. This maintains simulation state consistency: displayed simulation speed may be slightly less than nominal on slow hardware, but the glucose trace remains physiologically valid.

### 9.4 Persistence: IndexedDB via idb

Browser IndexedDB is accessed via the `idb` library, providing a clean Promise-based TypeScript API over the native IndexedDB interface. Three object stores: `SimulationState` (keyed by session ID), `SessionHistory` (keyed by session ID and tick timestamp), and `Scenarios` (keyed by scenario name).

### 9.5 Development Environment

|Aspect            |Detail                                                                                                                                                                                                                                                                                                    |
|------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
|Operating system  |WSL2 Ubuntu 22.04 on Windows, consistent with the existing CGMSIM v3 development environment.                                                                                                                                                                                                             |
|IDE               |VS Code with Claude Code for AI-assisted development.                                                                                                                                                                                                                                                     |
|Package management|npm workspaces monorepo. All packages share a single `node_modules` at the root. The simulator package is the only one that can be run independently in Node.js for unit testing.                                                                                                                         |
|Testing           |Vitest for unit tests on simulation logic. The physiological correctness of the deltaBG computation, IOB/COB accumulators, and controller outputs is the highest-priority test target. Playwright for end-to-end browser tests covering the throttle control, pause/resume, and event injection workflows.|
|Version control   |Git. Separate repository from CGMSIM v3 to maintain clean separation of concerns, with shared simulation logic in `packages/simulator`.                                                                                                                                                                   |
|Deployment        |The frontend is a static bundle served by any web server. For teaching sessions on a local machine, Vite's preview server is sufficient. For shared access, the static bundle is served by the existing Traefik reverse proxy on Oracle Cloud, consistent with v3 infrastructure.                         |

-----

## 10. Phased Implementation Plan

The implementation is structured in three phases, each delivering a functional, demonstrable increment. No phase depends on features from a later phase, and each phase ends with a version of the application that could be shown to users or collaborators.

### Phase 1 — Core Simulation Loop and Animated Trace

**Goal:** simulation engine running in a WebWorker, animated CGM trace visible in the browser, throttle control functional.

- Port the deltaBG computation function from the CGMSIM v3 codebase into `packages/simulator`, adapting it to the WebWorker execution model. Extract the essential physiological functions from `@lsandini/cgmsim-lib` (deltaBG, insulin PD profiles, carb absorption, IOB/COB, PID controller) and port to TypeScript, removing Nightscout dependencies.
- Integrate the IOB and COB calculation functions. These functions handle all insulin delivery types (long-acting basal, mealtime boluses, scheduled infusions, temporary basals) and carbohydrate absorption, returning total IOB and COB at each tick.
- Port the G6 noise model with its stateful carry-forward requirement. Define the state structure explicitly so it can be serialised and deserialised correctly.
- Implement the WebWorker message handler for core event types: `SET_THROTTLE`, `PAUSE`, `RESUME`, `BOLUS`, `MEAL`, `SAVE_STATE`, `RESET`.
- Implement the Canvas CGM trace renderer with the 24-hour display window (18 hours filled + 6 hours empty space), scrolling behavior that activates at 18:00, AGP colour scheme for target range and thresholds, the insulin and carbohydrate activity overlays, and the mg/dL ↔ mmol/L display unit selector.
- Implement the throttle slider UI with speed caps enforced for the PID controller.
- Hard-code a single virtual patient and therapy profile for Phase 1 testing. No parameter configuration UI required yet.

> ✅ **End-of-Phase-1 milestone:** open the application in a browser, press play, watch a glucose trace animate across the screen. Adjust the throttle slider and observe the trace scrolling faster or slower. Pause and resume cleanly. Inject a bolus from the keyboard and watch the glucose fall over the following simulated hour.

### Phase 2 — Instructor Panel, All Therapy Modes, and Session Persistence

**Goal:** full parameter configurability, MDI and pump therapy modes, IndexedDB persistence.

- Build the instructor panel component tree with Patient, Therapy, Events, and Session tabs.
- Implement all virtual patient parameter inputs and the `SET_PATIENT_PARAM` message handler in the worker.
- Implement all therapy profile parameter inputs and the `SET_THERAPY_PARAM` message handler.
- Implement the MDI therapy mode: long-acting insulin depot model for glargine, degludec, and detemir; manual bolus delivery only; bolus advisor output display.
- Implement the conventional pump therapy mode: basal profile delivery as 5-minute micro-boluses, temporary basal rate support, suspend function.
- Implement the 24-hour basal profile editor as a table of time-value pairs, matching the interface familiar from real insulin pump devices.
- Implement IndexedDB persistence: SimulationState and SessionHistory stores, auto-save on a 10-simulated-minute interval, manual save and load from the Session tab.

> ✅ **End-of-Phase-2 milestone:** configure a virtual patient and therapy profile manually, run the simulation at ×50 speed while injecting meals and boluses via the Events tab, observe the glucose pattern develop in real time, pause to adjust therapy parameters, resume, observe the change. Save the session, reload it in a fresh browser tab, confirm the simulation resumes from the saved state.

### Phase 3 — Comparison Runs, Production Polish, and Optional Backend

**Goal:** comparison run feature, full visual polish ready for a real teaching session, optional backend.

- Implement the dual WebWorker comparison run architecture: spawn a second worker, initialise both from the same saved state, apply divergent parameter changes, render both traces on the same canvas in different colours with a legend.
- Apply the full visual design: dark theme, glow effect on CGM trace, full AGP colour scheme, projected-screen typography sizing.
- Implement session JSON export and import.
- Implement the collapsible panel hide/show for full-screen trace mode during live teaching.
- Benchmark the PID controller speed cap on representative teaching hardware and adjust if needed.
- Implement glucose-dependent EGP extension: counter-regulatory integrity parameter (0 to 1), sigmoid response curve below the hypoglycaemia threshold, partial suppression above the hyperglycaemia threshold.
- **(Optional)** Implement scenario mode: JSON-based predefined treatment sequences for fast-forward demonstrations, with bundled scenario library for the teaching scenarios described in §4.4.
- **(Optional)** Implement the Fastify backend: AI narrative generation endpoint and scenario persistence endpoints for cross-device sharing.

> ✅ **End-of-Phase-3 milestone:** first release candidate suitable for use in a real teaching session. Run a comparison of MDI versus AID on the same patient, display both traces side by side, present the result to a test audience.

-----

## 11. Open Questions and Decisions Pending

*All architectural and design questions have been resolved and integrated into their respective sections of this document. Phase 1 implementation can proceed.*