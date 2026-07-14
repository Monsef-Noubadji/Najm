/**
 * RFC-0006 error boundary test suite — run with `npm test`.
 * Proves withErrorBoundary() isolates a component's ssr()/hydrate()
 * failures WITHOUT making isolation the default: an unwrapped
 * component's throw must still propagate (today's "fail the whole
 * page" behavior, unchanged for anyone who didn't opt in).
 */
import assert from 'node:assert/strict';
import { withErrorBoundary } from '../runtime/error-boundary';
import { renderToHtml, renderComponent } from '../runtime/ssr';
import type { ComponentView, FunctionalComponent } from '../runtime/mount';

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

/** A component whose ssr()/hydrate() throw unconditionally. */
function makeThrowingComponent(message: string): FunctionalComponent {
  return (): ComponentView => ({
    ssr(): string {
      throw new Error(message);
    },
    hydrate(): void {
      throw new Error(message);
    },
  });
}

/** A component that renders normally. */
function makeHealthyComponent(html: string): FunctionalComponent {
  return (): ComponentView => ({
    ssr: async () => html,
    hydrate: async () => {},
  });
}

await test('withErrorBoundary: ssr() throwing is caught, onError fallback returned instead', async () => {
  const boom = makeThrowingComponent('ssr boom');
  const wrapped = withErrorBoundary(boom, (error, phase) => {
    assert.ok(error instanceof Error);
    assert.equal((error as Error).message, 'ssr boom');
    assert.equal(phase, 'ssr');
    return '<div class="fallback">recovered</div>';
  });

  const html = await renderToHtml(wrapped, {});
  assert.equal(html, '<div class="fallback">recovered</div>');
});

await test('withErrorBoundary: successful ssr() passes through unchanged, onError never called', async () => {
  const healthy = makeHealthyComponent('<p>all good</p>');
  let onErrorCalled = false;
  const wrapped = withErrorBoundary(healthy, () => {
    onErrorCalled = true;
    return '<div>should not appear</div>';
  });

  const html = await renderToHtml(wrapped, {});
  assert.equal(html, '<p>all good</p>');
  assert.equal(onErrorCalled, false);
});

await test('withErrorBoundary: works through renderComponent() (the real call site)', async () => {
  const boom = makeThrowingComponent('renderComponent boom');
  const wrapped = withErrorBoundary(boom, (_error, phase) => `<i>fallback for ${phase}</i>`);

  const html = await renderComponent(wrapped, {});
  assert.equal(html, '<i>fallback for ssr</i>');
});

await test('unwrapped component: ssr() throwing still propagates (isolation is opt-in, not default)', async () => {
  const boom = makeThrowingComponent('unwrapped boom');
  await assert.rejects(() => renderToHtml(boom, {}), /unwrapped boom/);
});

await test('unwrapped component via renderComponent(): still propagates too', async () => {
  const boom = makeThrowingComponent('unwrapped via renderComponent');
  await assert.rejects(() => renderComponent(boom, {}), /unwrapped via renderComponent/);
});

await test('withErrorBoundary: onError receives the actual thrown error object, not a stringified copy', async () => {
  const customError = new class extends Error {
    code = 'CUSTOM_CODE';
  }('custom failure');
  const boom: FunctionalComponent = () => ({
    ssr(): string {
      throw customError;
    },
    hydrate(): void {},
  });

  let received: unknown;
  const wrapped = withErrorBoundary(boom, (error) => {
    received = error;
    return '<div>fallback</div>';
  });

  await renderToHtml(wrapped, {});
  assert.equal(received, customError);
  assert.equal((received as any).code, 'CUSTOM_CODE');
});

await test('withErrorBoundary: hydrate() throwing is caught by onError with phase "hydrate", then rethrown for client.ts isolation', async () => {
  const boom = makeThrowingComponent('hydrate boom');
  let seenPhase: string | undefined;
  const wrapped = withErrorBoundary(boom, (error, phase) => {
    seenPhase = phase;
    assert.equal((error as Error).message, 'hydrate boom');
    return '<div>fallback</div>';
  });

  const view = wrapped({});
  await assert.rejects(() => Promise.resolve(view.hydrate(null as unknown as Element)), /hydrate boom/);
  assert.equal(seenPhase, 'hydrate');
});

await test('withErrorBoundary: a throw during the component\'s SETUP phase (before ssr() even exists) is also caught', async () => {
  // Matches src/components/Crasher.najm's real shape: `if (props.bad)
  // throw ...` sits in the function body BEFORE `return { template }`,
  // so it throws while comp(props) itself runs, not inside inner.ssr().
  // RFC-0002: setup + first render are one inseparable pass, so this
  // must still be treated as "this component's ssr() failed."
  const setupThrows: FunctionalComponent = (props) => {
    if ((props as any)?.bad) throw new Error('setup boom');
    return { ssr: async () => '<p>ok</p>', hydrate: async () => {} };
  };
  const wrapped = withErrorBoundary(setupThrows, (error, phase) => {
    assert.equal((error as Error).message, 'setup boom');
    assert.equal(phase, 'ssr');
    return '<div class="fallback">setup recovered</div>';
  });

  const html = await renderToHtml(wrapped, { bad: true });
  assert.equal(html, '<div class="fallback">setup recovered</div>');
});

await test('withErrorBoundary: healthy hydrate() passes through, onError never called', async () => {
  let hydrateRan = false;
  const healthy: FunctionalComponent = () => ({
    ssr: async () => '<p>ok</p>',
    hydrate: async () => {
      hydrateRan = true;
    },
  });
  let onErrorCalled = false;
  const wrapped = withErrorBoundary(healthy, () => {
    onErrorCalled = true;
    return '<div>fallback</div>';
  });

  const view = wrapped({});
  await view.hydrate(null as unknown as Element);
  assert.equal(hydrateRan, true);
  assert.equal(onErrorCalled, false);
});

console.log(`\nerror-boundary: all ${passed} tests passed`);
