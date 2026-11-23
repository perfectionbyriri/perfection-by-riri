// In-memory KV for the one-shot verification run: the customer index lives
// only for the duration of the job and is discarded afterwards.
export function createMemoryKV() {
  const store = new Map();
  return {
    async get(key) {
      return store.has(key) ? store.get(key) : null;
    },
    async put(key, value) {
      store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
    },
    async delete(key) {
      store.delete(key);
    }
  };
}
