/**
 * A genuine React component — hooks, JSX, the works — hosted inside a
 * Mono meta-island. The default export is what Mono sees: a functional
 * component speaking Mono's ABI, produced by the adapter.
 */
import { useState } from 'react';
import { defineReactIsland } from 'mono/interop/react';

function ReactCounter({ start = 0 }: { start?: number }) {
  const [count, setCount] = useState(start);
  return (
    <div className="meta-island react">
      <span className="who">⚛️ React island (useState inside Mono)</span>
      <button onClick={() => setCount(count + 1)}>count: {count}</button>
    </div>
  );
}

export default defineReactIsland(ReactCounter);
