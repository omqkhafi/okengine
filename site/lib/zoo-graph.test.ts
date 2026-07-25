/**
 * Gate: the landing diagram's zoo numbers are counted from curated seam data,
 * so the data has to stay well-formed and the argument it carries has to hold.
 */

import { describe, expect, test } from 'bun:test';
import { ELEMENTS, ZOO_CONCERN_GROUPS, ZOO_CONCERNS } from './elements';
import {
  TREE_CHANGE_COST,
  treeEdgeCount,
  zooBusiest,
  zooDegree,
  zooPassCost,
  ZOO_SEAM_PAIRS,
  ZOO_SEAMS,
  zooSeamCount,
} from './zoo-graph';

const TOTAL = ZOO_CONCERNS.length;

describe('the drawn concern set', () => {
  test('is the whole §5 table, not a sample of it', () => {
    const replaced = ELEMENTS.flatMap((element) => element.replaces.split(' · '));
    expect(ZOO_CONCERNS.map((concern) => concern.label)).toEqual(replaced);
  });

  test('every concern names the element whose `replaces` list it came from', () => {
    for (const concern of ZOO_CONCERNS) {
      const element = ELEMENTS.find((candidate) => candidate.name === concern.element);
      expect(element?.replaces.split(' · ')).toContain(concern.label);
    }
  });

  test('no label appears twice, so a seam can never be ambiguous', () => {
    const labels = ZOO_CONCERNS.map((concern) => concern.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  test('the eight groups partition the ring into contiguous, non-empty arcs', () => {
    expect(ZOO_CONCERN_GROUPS).toHaveLength(ELEMENTS.length);
    let cursor = 0;
    for (const group of ZOO_CONCERN_GROUPS) {
      expect(group.start).toBe(cursor);
      expect(group.end).toBeGreaterThan(group.start);
      for (let index = group.start; index < group.end; index += 1) {
        expect(ZOO_CONCERNS[index]?.element).toBe(group.element);
      }
      cursor = group.end;
    }
    expect(cursor).toBe(TOTAL);
  });
});

describe('zoo seams', () => {
  test('every seam names two distinct known concerns', () => {
    const labels = new Set(ZOO_CONCERNS.map((concern) => concern.label));
    for (const [from, to] of ZOO_SEAMS) {
      expect(labels.has(from)).toBe(true);
      expect(labels.has(to)).toBe(true);
      expect(from).not.toBe(to);
    }
  });

  test('no pair is listed twice, in either direction', () => {
    const keys = ZOO_SEAM_PAIRS.map((seam) => seam.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('`b` is always the later arrival, so a step`s new seams grow out of it', () => {
    for (const seam of ZOO_SEAM_PAIRS) expect(seam.a).toBeLessThan(seam.b);
  });

  test('no concern is stranded — each owns at least two seams', () => {
    for (let index = 0; index < TOTAL; index += 1) {
      expect(zooDegree(index, TOTAL)).toBeGreaterThanOrEqual(2);
    }
  });

  test('no concern is wired to everything — the busiest touches under half the ring', () => {
    // A node joined to all the others would be a hub, and the zoo's whole
    // problem is that it has no hub.
    expect(zooBusiest(TOTAL).seams).toBeLessThan(TOTAL / 2);
  });

  test('the tangle stays a tangle: the mean concern owns more than three seams', () => {
    expect(zooPassCost(TOTAL) / TOTAL).toBeGreaterThan(3);
  });
});

describe('the stepped pass', () => {
  test('each step adds one element`s concerns, and every step adds seams', () => {
    let previous = 0;
    for (const group of ZOO_CONCERN_GROUPS) {
      expect(zooSeamCount(group.end)).toBeGreaterThan(previous);
      previous = zooSeamCount(group.end);
    }
  });

  test('seams only ever accumulate as concerns arrive', () => {
    for (let visible = 3; visible <= TOTAL; visible += 1) {
      expect(zooSeamCount(visible)).toBeGreaterThanOrEqual(zooSeamCount(visible - 1));
    }
  });

  test('the collapse has not paid for itself at the opening frame', () => {
    // Honest framing the copy relies on: an element costs a trunk before it
    // carries anything, so the okengine shape opens dearer than the tangle.
    const opening = ZOO_CONCERN_GROUPS[0]!.end;
    expect(zooSeamCount(opening)).toBeLessThanOrEqual(treeEdgeCount(opening));
  });

  test('at full width the zoo owns at least twice the edges', () => {
    expect(zooSeamCount(TOTAL)).toBeGreaterThanOrEqual(2 * treeEdgeCount(TOTAL));
  });

  test('one change costs far more in the zoo than the fixed two', () => {
    const busiest = zooBusiest(TOTAL);
    expect(busiest.seams).toBeGreaterThan(4 * TREE_CHANGE_COST);
    expect(zooPassCost(TOTAL)).toBeGreaterThan(TREE_CHANGE_COST * TOTAL);
  });
});

describe('the headline numbers', () => {
  /*
   * Every number the band puts on screen is derived from the data above, which
   * means a plausible-looking seam edit can move the argument without anyone
   * noticing. These are the numbers the surrounding copy is written around —
   * "forty tools", the opening frame, the full-width contrast — so changing one
   * has to be a deliberate act with the prose changed alongside it.
   */
  const OPENING = ZOO_CONCERN_GROUPS[0]!.end;

  test('forty concerns, eight steps', () => {
    expect(TOTAL).toBe(40);
    expect(ZOO_CONCERN_GROUPS).toHaveLength(8);
    expect(OPENING).toBe(6);
  });

  test('the opening frame is 5 seams against 7 edges', () => {
    expect(zooSeamCount(OPENING)).toBe(5);
    expect(treeEdgeCount(OPENING)).toBe(7);
  });

  test('full width is 136 seams against 48 edges', () => {
    expect(zooSeamCount(TOTAL)).toBe(136);
    expect(treeEdgeCount(TOTAL)).toBe(48);
  });

  test('the busiest node is database, at 15 seams against a fixed 2', () => {
    expect(zooBusiest(TOTAL)).toEqual({ label: 'database', seams: 15 });
    expect(TREE_CHANGE_COST).toBe(2);
  });
});
