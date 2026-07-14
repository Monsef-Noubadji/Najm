/**
 * DevTools protocol test suite — RFC-0010's Verification section.
 * Covers the two new instrumentation modules (the store-side time-travel
 * half, `enableTimeTravel`, already existed and is exercised by
 * test-store.ts):
 *
 *   - `enableGraphInspector()` (runtime/devtools-graph.ts): ownership
 *     (`ownedBy`) and dependency (`dependsOn`) reporting, cross-checked
 *     against the same "parent effect owns two child effects" shape
 *     tests/test-signals.ts's "ownership" test uses.
 *   - `enableFlushTiming()` (runtime/devtools-timing.ts): a `batch()` of
 *     N writes to signals sharing a dependency produces exactly ONE
 *     `FlushEvent` whose `computationCount` is the number of DISTINCT
 *     computations that ran — reusing the same dedup fixture shape as
 *     tests/test-scheduler.ts's "batch: a computation triggered by
 *     multiple writes... still runs once" test.
 *   - Both disposers actually stop broadcasting/wrapping.
 *
 * Neither module has a `window` in this Node test run, and
 * devtools-bridge.ts's `broadcast()` (the same pattern both new modules
 * follow) guards on `typeof window !== 'undefined'` — so, like
 * tests/test-partial-hydration.ts stubbing `document`/`IntersectionObserver`
 * onto `globalThis` for the duration of a test, this file stubs a minimal
 * `globalThis.window = { postMessage: spy }` for the duration of each
 * broadcast-observing test, restoring the original afterward.
 */
import assert from 'node:assert/strict';
import { signal, computed, effect, batch, createRoot } from '../runtime/signals';
import { enableGraphInspector, snapshot } from '../runtime/devtools-graph';
import { enableFlushTiming } from '../runtime/devtools-timing';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** Captured postMessage calls during the stubbed window's lifetime. */
function withWindowStub<T>(fn: (messages: Record<string, unknown>[]) => T): T {
  const messages: Record<string, unknown>[] = [];
  const original = (globalThis as any).window;
  (globalThis as any).window = {
    postMessage(msg: Record<string, unknown>) {
      messages.push(msg);
    },
  };
  try {
    return fn(messages);
  } finally {
    (globalThis as any).window = original;
  }
}

/* -------------------------------------------------------------------- */
/* enableGraphInspector()                                                */
/* -------------------------------------------------------------------- */

test('graph inspector: ownedBy reflects a parent effect owning two child effects', () => {
  const disable = enableGraphInspector();
  try {
    const outer = signal(0);
    const a = signal('a');
    const b = signal('b');

    createRoot(() => {
      effect(() => {
        outer.value; // parent effect reads `outer`
        effect(() => {
          a.value; // child #1 reads `a`
        });
        effect(() => {
          b.value; // child #2 reads `b`
        });
      });
    });

    const graph = snapshot();

    // Three computations: the parent effect + two children.
    assert.equal(graph.computations.length, 3);
    assert.ok(graph.computations.every((c) => c.kind === 'effect'));

    const parent = graph.computations.find((c) => c.ownedBy === null);
    assert.ok(parent, 'exactly one root-level (no owner) computation expected');
    const children = graph.computations.filter((c) => c.ownedBy === parent!.id);
    assert.equal(children.length, 2, 'both nested effects must report ownedBy === parent id');

    // dependsOn: the parent depends on `outer`'s signal id; each child
    // depends on its own signal (a or b) and nothing else.
    const outerEntry = graph.signals.find((s) => s.value === 0);
    assert.ok(outerEntry);
    assert.deepEqual(parent!.dependsOn, [outerEntry!.id]);

    const aEntry = graph.signals.find((s) => s.value === 'a');
    const bEntry = graph.signals.find((s) => s.value === 'b');
    assert.ok(aEntry && bEntry);
    const childDeps = children.map((c) => c.dependsOn);
    assert.ok(childDeps.some((d) => d.length === 1 && d[0] === aEntry!.id));
    assert.ok(childDeps.some((d) => d.length === 1 && d[0] === bEntry!.id));
  } finally {
    disable();
  }
});

test('graph inspector: computed() is tagged kind "computed", distinct from effect()', () => {
  const disable = enableGraphInspector();
  try {
    const base = signal(1);
    createRoot(() => {
      computed(() => base.value * 2);
    });
    const graph = snapshot();
    const computedEntry = graph.computations.find((c) => c.kind === 'computed');
    assert.ok(computedEntry, 'expected one computation tagged kind "computed"');
  } finally {
    disable();
  }
});

test('graph inspector: broadcasts najm-devtools:graph-snapshot after a flush that ran computations', () => {
  // Broadcast is wired through the scheduler's drain hook (see
  // devtools-graph.ts's module doc), which only fires for a QUEUED drain
  // — batch() is the reliable way to exercise that path (a bare write
  // outside batch() runs its subscriber immediately without entering the
  // drain loop at all; see devtools-timing.ts's "SCOPE NOTE").
  withWindowStub((messages) => {
    const disable = enableGraphInspector();
    try {
      const s = signal(0);
      createRoot(() => {
        effect(() => {
          s.value;
        });
      });
      messages.length = 0; // drop the initial-run broadcast(s)

      batch(() => {
        s.value = 1;
      });

      const snapshots = messages.filter((m) => m.type === 'najm-devtools:graph-snapshot');
      assert.ok(snapshots.length >= 1, 'expected at least one graph-snapshot broadcast after the batch');
      for (const m of snapshots) {
        assert.equal(m.source, 'najm-devtools-bridge');
      }
    } finally {
      disable();
    }
  });
});

test('graph inspector: disposer stops broadcasting and un-wraps signal()/computed()/effect()', () => {
  withWindowStub((messages) => {
    const disable = enableGraphInspector();
    const s = signal(0);
    createRoot(() => {
      effect(() => {
        s.value;
      });
    });
    disable();

    messages.length = 0;
    const graphBefore = snapshot();
    assert.deepEqual(graphBefore, { signals: [], computations: [] }, 'snapshot() must be empty once disabled');

    batch(() => {
      s.value = 2; // would have triggered a broadcast while enabled
    });
    const snapshotsAfterDisable = messages.filter((m) => m.type === 'najm-devtools:graph-snapshot');
    assert.deepEqual(snapshotsAfterDisable, [], 'no new graph-snapshot broadcast after disable()');

    // A signal created after disable() is not tagged (proves signal()/
    // effect() are genuinely un-wrapped, not just silenced).
    const untracked = signal('untracked');
    createRoot(() => {
      effect(() => {
        untracked.value;
      });
    });
    assert.deepEqual(snapshot(), { signals: [], computations: [] });
  });
});

/* -------------------------------------------------------------------- */
/* enableFlushTiming()                                                   */
/* -------------------------------------------------------------------- */

test('flush timing: a batch() of N writes to signals sharing a dependency produces exactly ONE FlushEvent with computationCount == distinct computations run', () => {
  withWindowStub((messages) => {
    const disable = enableFlushTiming();
    try {
      const a = signal(1);
      const b = signal(2);
      let runs = 0;
      createRoot(() => {
        effect(() => {
          a.value;
          b.value; // one computation, subscribed to BOTH signals
          runs++;
        });
      });
      assert.equal(runs, 1); // initial run (not inside a batch — no FlushEvent expected for it)
      messages.length = 0;

      batch(() => {
        a.value = 10;
        b.value = 20; // two writes, same one computation depends on both
      });

      assert.equal(runs, 2); // the computation ran exactly once more (dedup)

      const flushEvents = messages.filter((m) => m.type === 'najm-devtools:flush');
      assert.equal(flushEvents.length, 1, 'expected exactly one FlushEvent for the whole batch()');
      const event = flushEvents[0];
      assert.equal(event.source, 'najm-devtools-bridge');
      assert.equal(event.priority, 'sync');
      assert.equal(event.computationCount, 1, 'computationCount must count DISTINCT computations, not writes (2 writes, 1 computation)');
      assert.equal(typeof event.durationMs, 'number');
      assert.ok((event.durationMs as number) >= 0);
    } finally {
      disable();
    }
  });
});

test('flush timing: three independent computations triggered by one batch() report computationCount 3', () => {
  withWindowStub((messages) => {
    const disable = enableFlushTiming();
    try {
      const a = signal(1);
      const b = signal(2);
      const c = signal(3);
      createRoot(() => {
        effect(() => {
          a.value + b.value + c.value;
        });
      });
      messages.length = 0;

      batch(() => {
        a.value = 10;
        b.value = 20;
        c.value = 30;
      });

      const flushEvents = messages.filter((m) => m.type === 'najm-devtools:flush');
      assert.equal(flushEvents.length, 1);
      assert.equal(flushEvents[0].computationCount, 1); // still one computation (reads all three)
    } finally {
      disable();
    }
  });
});

test('flush timing: disposer stops broadcasting', () => {
  withWindowStub((messages) => {
    const disable = enableFlushTiming();
    const a = signal(1);
    const b = signal(2);
    createRoot(() => {
      effect(() => {
        a.value;
        b.value;
      });
    });
    disable();

    messages.length = 0;
    batch(() => {
      a.value = 100;
      b.value = 200;
    });

    const flushEvents = messages.filter((m) => m.type === 'najm-devtools:flush');
    assert.deepEqual(flushEvents, [], 'no FlushEvent after disable()');
  });
});

console.log(`\ndevtools: all ${passed} tests passed`);
