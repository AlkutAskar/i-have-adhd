// Test driver for the OpenCode plugin. Imports the plugin at argv[2], calls the
// API named by argv[3], and prints a JSON summary so tests can assert on it:
//
//   skill     V2: runs `setup(ctx)` and prints the registered skills.
//   command   V2: runs `setup(ctx)` and prints the registered commands, with
//              `template` holding the prompt the command would submit.
//   context   V2: runs `setup(ctx)`, fires the `context` session hook against an
//              empty system prompt, and prints the resulting system text.
//   v1-config   V1: calls `server()` and prints the config after its `config`
//              hook runs twice, checking registration, overrides, and idempotency.
//   v1-context  V1: calls `server()` and fires
//              `experimental.chat.system.transform` against an empty system
//              prompt, printing the resulting system text.
//
// One default export serves both APIs: V2 calls `setup(ctx)`, V1 calls
// `server()`. A `context` or `v1-context` run prints nothing when the hook
// injects nothing (always-on flag absent).
import { pathToFileURL } from 'node:url';

const pluginPath = process.argv[2];
const mode = process.argv[3];
const { default: definition } = await import(pathToFileURL(pluginPath).href);

const skills = new Map();
const commands = new Map();
const hooks = new Map();
const prompts = [];

const editorFor = (store) => ({
  list: () => [...store.values()],
  get: (id) => store.get(id),
  add: (entry) => store.set(entry.id ?? entry.name, entry),
});

const v2ctx = {
  skill: {
    transform: async (cb) => {
      cb(editorFor(skills));
      return { dispose: async () => {} };
    },
  },
  command: {
    transform: async (cb) => {
      cb(editorFor(commands));
      return { dispose: async () => {} };
    },
  },
  session: {
    hook: async (name, handler) => {
      hooks.set(name, handler);
      return { dispose: async () => {} };
    },
    prompt: async (input) => {
      prompts.push(input);
    },
  },
};

const joined = (event) => event.system.map((part) => part.text ?? String(part)).join('\n---SEP---\n');

if (mode === 'v1-config' || mode === 'v1-context') {
  const v1 = await definition.server();
  if (mode === 'v1-config') {
    const config = JSON.parse(process.argv[4] || '{}');
    await v1.config(config);
    await v1.config(config);
    process.stdout.write(JSON.stringify(config));
  } else {
    const output = { system: [] };
    await v1['experimental.chat.system.transform']({}, output);
    process.stdout.write(output.system.join('\n---SEP---\n'));
  }
} else {
  await definition.setup(v2ctx);

  if (mode === 'skill') {
    process.stdout.write(JSON.stringify([...skills.values()]));
  } else if (mode === 'command') {
    const out = [...commands.values()].map((command) => ({
      name: command.name,
      description: command.description,
    }));
    const entry = [...commands.values()][0];
    if (entry) {
      await entry.execute({ sessionID: "ses_test", prompt: { text: "" }, delivery: "steer" });
      out[0].template = prompts[prompts.length - 1]?.text;
    }
    process.stdout.write(JSON.stringify(out));
  } else {
    const handler = hooks.get('context');
    if (!handler) process.exit(0);
    const event = { system: [] };
    await handler(event);
    process.stdout.write(joined(event));
  }
}
