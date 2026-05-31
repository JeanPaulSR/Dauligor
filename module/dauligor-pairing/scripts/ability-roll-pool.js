// Shared ability-score roll pool for the Character Creator.
//
// Two ability-score generation models live in step 1 of the creator:
//
//   • Point Buy — a homebrew budget (32 points, each score 8–16 before
//     racial bonuses). The cost table + helpers live here so the wizard
//     and any future caller share one source of truth.
//
//   • Shared Roll Pool — a WORLD-level public pool of 4d6-drop-lowest
//     sets. Every player may roll one set into the pool; ANY player may
//     then choose ANY set (freely shareable, per owner direction). The DM
//     can also enter sets manually (rolled at the table elsewhere).
//
// Why a world setting: world-scoped settings propagate to every connected
// client automatically (Foundry emits a socket update + fires the
// setting's `onChange`), so the pool stays in sync across the table with
// no bespoke broadcast. The catch is that ONLY a GM can write a world
// setting — so non-GM players relay their rolled set to the GM via
// socketlib (`executeAsGM`). The GM client appends it and the resulting
// setting write fans back out to everyone.
//
// The setting itself is registered in main.js (registerSettings); its
// `onChange` calls `Hooks.callAll("dauligor-pairing.rollPoolChanged")`,
// which the creator listens on to re-render the ability step live.

import { MODULE_ID, SETTINGS } from "./constants.js";
import { log, notifyWarn, warn } from "./utils.js";

// ── Point Buy ─────────────────────────────────────────────────────────
//
// Homebrew: 32-point budget, scores 8–16. The cost table extends the
// standard 5e curve arithmetically (+2 per step past 13: 14=7, 15=9,
// 16=11). Editing these three values + the table is all it takes to
// retune point buy.

export const POINT_BUY = Object.freeze({
  budget: 32,
  min: 8,
  max: 16,
  cost: Object.freeze({ 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9, 16: 11 }),
});

/** Point-buy cost of a single score, or null if out of the 8–16 band. */
export function pointBuyCost(score) {
  const n = Number(score);
  return Object.prototype.hasOwnProperty.call(POINT_BUY.cost, n) ? POINT_BUY.cost[n] : null;
}

/** Total points spent across a `{ str, dex, … }` score map. */
export function pointBuySpent(scores) {
  return Object.values(scores ?? {}).reduce((total, score) => {
    const cost = pointBuyCost(score);
    return total + (cost ?? 0);
  }, 0);
}

/** Remaining budget for a score map (can go negative while editing). */
export function pointBuyRemaining(scores) {
  return POINT_BUY.budget - pointBuySpent(scores);
}

// ── Roll pool ─────────────────────────────────────────────────────────

const ROLL_POOL_CHANGED_HOOK = `${MODULE_ID}.rollPoolChanged`;

// socketlib handle, wired by initRollPoolSocket() from import-service's
// initializeSocket(). Null when socketlib is unavailable — in that case
// non-GM submits fall back to a warning (GM-only pool management).
let _socket = null;

/**
 * Register the roll-pool socket handlers on the module's shared socketlib
 * channel. Called once from import-service.initializeSocket() so the
 * module keeps a single registered socketlib module (socketlib only
 * allows one registration per module id).
 */
export function initRollPoolSocket(socket) {
  _socket = socket;
  socket.register("rollPoolSubmit", _applySubmitAsGm);
  socket.register("rollPoolRemove", _applyRemoveAsGm);
  socket.register("rollPoolClear", _applyClearAsGm);
  log("Registered ability roll-pool socket handlers");
}

/** Read the current pool (always an array). */
export function getRollPool() {
  try {
    const raw = game.settings.get(MODULE_ID, SETTINGS.abilityRollPool);
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function _writePool(pool) {
  return game.settings.set(MODULE_ID, SETTINGS.abilityRollPool, pool);
}

/** Subscribe to pool changes (fires on every client on any write). */
export function onRollPoolChanged(callback) {
  Hooks.on(ROLL_POOL_CHANGED_HOOK, callback);
  return () => Hooks.off(ROLL_POOL_CHANGED_HOOK, callback);
}

/**
 * Roll one 4d6-drop-lowest set of six scores using Foundry's Roll API
 * (so Dice So Nice etc. animate, and the maths is auditable). Returns
 * the six totals as a plain number[]; does NOT touch the pool.
 */
export async function rollAbilitySet() {
  const rolls = [];
  for (let i = 0; i < 6; i += 1) {
    // 4d6, keep highest 3 — the canonical "drop the lowest" formula.
    const roll = await new Roll("4d6kh3").evaluate();
    rolls.push(roll.total);
  }
  return rolls;
}

function _sum(rolls) {
  return (Array.isArray(rolls) ? rolls : []).reduce((t, n) => t + (Number(n) || 0), 0);
}

function _makeEntry({ rolls, source }) {
  return {
    id: foundry.utils.randomID(),
    userId: source === "manual" ? null : (game.user?.id ?? null),
    userName: source === "manual" ? "DM (manual)" : (game.user?.name ?? "Unknown"),
    rolls: rolls.map((n) => Number(n) || 0),
    total: _sum(rolls),
    source,
    createdAt: Date.now(),
  };
}

/**
 * Roll a new set for the CURRENT user and submit it to the pool. Each
 * player gets one rolled set — re-submitting replaces the caller's prior
 * rolled set (manual DM sets are untouched). GM writes directly; players
 * relay to the GM over socketlib.
 */
export async function submitRolledSet(rolls) {
  const entry = _makeEntry({ rolls, source: "rolled" });
  if (game.user?.isGM) return _applySubmitAsGm(entry);
  if (_socket) return _socket.executeAsGM("rollPoolSubmit", entry);
  notifyWarn("socketlib is unavailable, so your roll can't reach the GM's shared pool. Ask the GM to enable it.");
  return null;
}

/** GM-only: append a manually-entered set (rolled away from the VTT). */
export async function addManualSet(rolls) {
  if (!game.user?.isGM) {
    notifyWarn("Only the GM can add manual roll sets.");
    return null;
  }
  return _applySubmitAsGm(_makeEntry({ rolls, source: "manual" }));
}

/** Remove a single set by id. GM writes directly; players relay. */
export async function removeSet(setId) {
  if (!setId) return null;
  if (game.user?.isGM) return _applyRemoveAsGm(setId);
  if (_socket) return _socket.executeAsGM("rollPoolRemove", setId);
  notifyWarn("socketlib is unavailable; ask the GM to remove that set.");
  return null;
}

/** GM-only: empty the entire pool. */
export async function clearPool() {
  if (!game.user?.isGM) {
    notifyWarn("Only the GM can clear the roll pool.");
    return null;
  }
  return _applyClearAsGm();
}

// ── GM-side appliers (run on the GM client) ─────────────────────────────

async function _applySubmitAsGm(entry) {
  if (!game.user?.isGM) return null;
  if (!entry || !Array.isArray(entry.rolls) || entry.rolls.length !== 6) {
    warn("rollPoolSubmit: rejected malformed entry", entry);
    return null;
  }
  // One rolled set per player: drop the submitter's previous rolled set.
  // Manual sets (userId null) are never deduped.
  const pool = getRollPool().filter(
    (e) => !(e.source === "rolled" && entry.source === "rolled" && e.userId && e.userId === entry.userId)
  );
  pool.push(entry);
  await _writePool(pool);
  return entry.id;
}

async function _applyRemoveAsGm(setId) {
  if (!game.user?.isGM) return null;
  const pool = getRollPool().filter((e) => e.id !== setId);
  await _writePool(pool);
  return setId;
}

async function _applyClearAsGm() {
  if (!game.user?.isGM) return null;
  await _writePool([]);
  return true;
}
