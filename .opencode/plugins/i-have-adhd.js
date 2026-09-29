// OpenCode V2 entry point for i-have-adhd.
//
// OpenCode V2 auto-discovers direct `.ts` and `.js` files in a discovered
// `.opencode/plugins/` directory, but not `.mjs`, and a `plugins` config entry
// must name a directory — 2.0.18 rejects a file path with "configured plugin
// path must be a directory" and silently ignores a directory path.
//
// This mirror re-exports the implementation so a local checkout works on V2
// with no config entry. The module keeps its own `__dirname`, so its
// `../../skills` and `../command/i-have-adhd.md` lookups still resolve inside
// the checkout.
//
// OpenCode V1 does not auto-discover `.opencode/plugins/`, so V1 keeps using
// the explicit path in `opencode.json`:
//   { "plugin": ["/absolute/path/to/i-have-adhd/.opencode/plugins/i-have-adhd.mjs"] }
export { default } from './i-have-adhd.mjs';
