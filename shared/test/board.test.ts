import { describe, expect, it } from 'vitest';
import {
  advanceRound,
  canAdvanceRound,
  cellKey,
  decodeCellSet,
  deathCountdown,
  encodeCellSet,
  gridDistance,
  initiativeOrder,
  overlayCell,
  parseCellKey,
  parseTileValue,
  shapeCells,
  tokenCells,
  type InitiativeEntry,
} from '../src/board.js';
import { BOARD_COVERS, BOARD_STATUSES } from '../src/boardStatus.js';
import { TILE_MATERIALS } from '../src/boardTiles.js';

describe('cellKey / parseCellKey', () => {
  it('round-trips a coordinate through the string form', () => {
    expect(cellKey(12, 7)).toBe('12,7');
    expect(parseCellKey('12,7')).toEqual({ x: 12, y: 7 });
  });

  it('handles negative coordinates', () => {
    expect(cellKey(-3, -1)).toBe('-3,-1');
    expect(parseCellKey('-3,-1')).toEqual({ x: -3, y: -1 });
  });

  it('rejects junk instead of throwing', () => {
    expect(parseCellKey('nonsense')).toBeNull();
    expect(parseCellKey('1,2,3')).toBeNull();
    expect(parseCellKey('')).toBeNull();
  });
});

describe('encodeCellSet / decodeCellSet', () => {
  it('round-trips a sparse cell set through the JSON-array wire form', () => {
    const cells = new Set(['1,1', '2,2', '3,3']);
    const wire = encodeCellSet(cells);
    expect(wire).toEqual(['1,1', '2,2', '3,3']);
    expect(decodeCellSet(wire)).toEqual(cells);
  });

  it('round-trips the empty set', () => {
    expect(decodeCellSet(encodeCellSet(new Set()))).toEqual(new Set());
  });
});

describe('parseTileValue', () => {
  it('parses a flat colour', () => {
    expect(parseTileValue('#8b2635')).toEqual({ kind: 'color', hex: '#8b2635' });
  });

  it('parses a built-in texture', () => {
    expect(parseTileValue('t:gras')).toEqual({ kind: 'texture', key: 'gras' });
  });

  it('parses a reserved GM-uploaded asset reference', () => {
    expect(parseTileValue('a:mein-slug')).toEqual({ kind: 'asset', slug: 'mein-slug' });
  });

  it('is tolerant of junk rather than throwing', () => {
    expect(parseTileValue('')).toBeNull();
    expect(parseTileValue('gras')).toBeNull();
    expect(parseTileValue('#zzzzzz')).toBeNull();
    expect(parseTileValue('#fff')).toBeNull(); // three-digit hex not accepted — the app always writes six
    expect(parseTileValue('t:')).toBeNull();
    expect(parseTileValue('a:')).toBeNull();
  });
});

describe('gridDistance (Chebyshev)', () => {
  it('is symmetric', () => {
    const a = { x: 2, y: 3 };
    const b = { x: 7, y: 1 };
    expect(gridDistance(a, b)).toBe(gridDistance(b, a));
  });

  it('a pure diagonal step costs the same as a pure straight step', () => {
    expect(gridDistance({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(1);
    expect(gridDistance({ x: 0, y: 0 }, { x: 1, y: 0 })).toBe(1);
  });

  it('is the max of the two axis deltas, not their sum — the case Euclidean/Manhattan would fail', () => {
    expect(gridDistance({ x: 0, y: 0 }, { x: 5, y: 3 })).toBe(5);
  });

  it('is zero for the same cell', () => {
    expect(gridDistance({ x: 4, y: 4 }, { x: 4, y: 4 })).toBe(0);
  });
});

describe('tokenCells', () => {
  it('a size-1 token occupies exactly its own cell', () => {
    expect(tokenCells({ x: 3, y: 5, size: 1 })).toEqual([{ x: 3, y: 5 }]);
  });

  it('a size-2 token occupies a 2x2 block anchored at its top-left cell', () => {
    expect(tokenCells({ x: 3, y: 5, size: 2 })).toEqual([
      { x: 3, y: 5 }, { x: 4, y: 5 },
      { x: 3, y: 6 }, { x: 4, y: 6 },
    ]);
  });

  it('a size-3 token covers nine cells', () => {
    expect(tokenCells({ x: 0, y: 0, size: 3 })).toHaveLength(9);
  });
});

describe('overlayCell', () => {
  it('recovers the cell a label was created at (center-anchored, x = cell.x + 0.5)', () => {
    expect(overlayCell({ x: 3.5, y: 5.5 })).toEqual({ x: 3, y: 5 });
  });

  it('floors any off-center position onto the cell it visually sits in', () => {
    expect(overlayCell({ x: 3.9, y: 5.1 })).toEqual({ x: 3, y: 5 });
  });
});

describe('shapeCells', () => {
  it('a rectangle covers every cell in its bounding box, from either corner order', () => {
    const a = shapeCells({ kind: 'rectangle', from: { x: 1, y: 1 }, to: { x: 3, y: 2 } });
    const b = shapeCells({ kind: 'rectangle', from: { x: 3, y: 2 }, to: { x: 1, y: 1 } });
    expect(a).toHaveLength(6);
    expect(a).toEqual(b);
    expect(a).toContainEqual({ x: 2, y: 1 });
  });

  it('a zero-radius circle covers only the cell its origin is centered on', () => {
    // Coordinates follow the same grid-line convention as tokenCells: an
    // integer is a cell BOUNDARY (token x=3 anchors cell 3, spanning 3..4), so
    // the center of cell (5,5) is at the half-integer point (5.5, 5.5) — not
    // at the integer corner, which is equidistant from four cells instead.
    const cells = shapeCells({ kind: 'circle', origin: { x: 5.5, y: 5.5 }, radius: 0 });
    expect(cells).toEqual([{ x: 5, y: 5 }]);
  });

  it('a circle is symmetric around its origin', () => {
    // Cell coverage compares to a cell's CENTER (x+0.5, y+0.5), so an origin at
    // a half-integer point is the one that lands exactly on the lattice's own
    // symmetry — an integer origin sits at a cell corner, not its center, and
    // would make this assertion fail for a reason that has nothing to do with
    // whether the shape is actually round.
    const cells = shapeCells({ kind: 'circle', origin: { x: 0.5, y: 0.5 }, radius: 2.5 });
    const xs = cells.map((c) => c.x);
    expect(Math.min(...xs)).toBe(-Math.max(...xs));
  });

  it('a large-enough circle includes a cell straight out along an axis but excludes its diagonal counterpart at the same Chebyshev distance', () => {
    // Radius 2 from a cell-center origin at (0.5, 0.5): straight neighbour center
    // is 2 away (inside), the equivalent diagonal corner is further (outside) —
    // exactly the roundness Chebyshev-based movement doesn't have.
    const cells = shapeCells({ kind: 'circle', origin: { x: 2, y: 2 }, radius: 2 });
    expect(cells).toContainEqual({ x: 2, y: 0 });
    expect(cells).not.toContainEqual({ x: 0, y: 0 });
  });
});

describe('initiativeOrder', () => {
  it('sorts by value descending', () => {
    const entries = [{ value: 5 }, { value: 12 }, { value: 8 }];
    expect(initiativeOrder(entries).map((e) => e.value)).toEqual([12, 8, 5]);
  });

  it('breaks ties by keeping original relative order (stable sort)', () => {
    const a = { value: 10, id: 'a' };
    const b = { value: 10, id: 'b' };
    const c = { value: 15, id: 'c' };
    expect(initiativeOrder([a, b, c]).map((e) => e.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('canAdvanceRound', () => {
  it('is blocked while any entry is not done', () => {
    expect(canAdvanceRound([{ done: true }, { done: false }])).toBe(false);
  });

  it('is allowed once every entry is done', () => {
    expect(canAdvanceRound([{ done: true }, { done: true }])).toBe(true);
  });

  it('is allowed on an empty board', () => {
    expect(canAdvanceRound([])).toBe(true);
  });
});

describe('advanceRound', () => {
  const base: InitiativeEntry = { tokenId: 1, value: 10, done: true, deathCountdown: null };

  it('bumps the round and clears every done flag', () => {
    const res = advanceRound(3, [base, { ...base, tokenId: 2 }]);
    expect(res.round).toBe(4);
    expect(res.entries.every((e) => e.done === false)).toBe(true);
  });

  it('ticks an active death countdown down by one', () => {
    const res = advanceRound(1, [{ ...base, deathCountdown: 3 }]);
    expect(res.entries[0].deathCountdown).toBe(2);
    expect(res.died).toEqual([]);
  });

  it('reports a token whose countdown reaches zero this tick', () => {
    const res = advanceRound(1, [{ ...base, tokenId: 42, deathCountdown: 1 }]);
    expect(res.entries[0].deathCountdown).toBe(0);
    expect(res.died).toEqual([42]);
  });

  it('leaves a token with no countdown untouched', () => {
    const res = advanceRound(1, [{ ...base, deathCountdown: null }]);
    expect(res.entries[0].deathCountdown).toBeNull();
    expect(res.died).toEqual([]);
  });
});

describe('deathCountdown', () => {
  it('starts a countdown at the Todesschwelle when LP drops to 0 with none running', () => {
    expect(deathCountdown(0, 5, null)).toBe(5);
  });

  it('starts a countdown when LP is negative too', () => {
    expect(deathCountdown(-3, 5, null)).toBe(5);
  });

  it('clears the countdown once LP rises back above 0', () => {
    expect(deathCountdown(1, 5, 2)).toBeNull();
  });

  it('leaves an already-running countdown alone — ticking is advanceRound\'s job', () => {
    expect(deathCountdown(0, 5, 2)).toBe(2);
  });

  it('stays clear while healthy', () => {
    expect(deathCountdown(10, 5, null)).toBeNull();
  });
});

describe('board catalogues', () => {
  it('every tile material key is unique', () => {
    const keys = TILE_MATERIALS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every status key is unique', () => {
    const keys = BOARD_STATUSES.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every cover key is unique', () => {
    const keys = BOARD_COVERS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('no status key collides with a cover key — they are deliberately different slots', () => {
    const statusKeys = new Set(BOARD_STATUSES.map((s) => s.key));
    for (const cover of BOARD_COVERS) expect(statusKeys.has(cover.key)).toBe(false);
  });
});
