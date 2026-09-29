// i-have-adhd — OpenCode plugin.
//
// Mirrors the Claude Code / Codex behaviour for OpenCode: the skill in
// `skills/i-have-adhd/SKILL.md` is the single source of truth for the ruleset.
//
//   • On demand   — registers the skills directory and a `/i-have-adhd`
//                   command so the ruleset applies for the rest of the session.
//   • Always-on   — when the opt-in flag file exists, the full ruleset is
//                   appended to the system prompt every turn (the OpenCode
//                   equivalent of the SessionStart hook in hooks/always-on.sh).
//
// Opt in to always-on:   touch ~/.config/opencode/.i-have-adhd-always
// Opt back out:          rm ~/.config/opencode/.i-have-adhd-always
//
// One default export serves both plugin APIs. V2 calls `setup(ctx)`; V1 calls
// `server()`. V1 object entrypoints require OpenCode 1.18.29 or newer, so
// 1.18.28 and older need the previous plugin file. The two APIs are separate —
// `server()` restates the V1 hooks rather than translating `setup`.
//
// V2 install — add to opencode.json(c), plural field, directory path:
//   { "plugins": ["/absolute/path/to/i-have-adhd"] }
// V1 install — add to opencode.json, singular field, file path:
//   { "plugin": ["/absolute/path/to/i-have-adhd/.opencode/plugins/i-have-adhd.mjs"] }

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsDir = path.resolve(__dirname, '../../skills');
const skillPath = path.join(skillsDir, 'i-have-adhd', 'SKILL.md');
const commandPath = path.join(__dirname, '..', 'command', 'i-have-adhd.md');

const SKILL_ID = 'i-have-adhd';
const FALLBACK_DESCRIPTION =
  'Shape output for a reader with ADHD: lead with the next action, number ' +
  'multi-step work, restate state across turns, suppress tangents, give ' +
  'specific time estimates, make wins visible.';

// JSON is valid YAML frontmatter; share native command metadata without a YAML dependency.
// Returns the full definition: V1 registers it as `config.command[...]`, while V2
// reads only `description` because `Command.Info` has no other fields.
async function commandDefinition() {
  const raw = await fs.promises.readFile(commandPath, 'utf8');
  const match = raw.match(/^---[^\S\r\n]*\r?\n([\s\S]*?)\r?\n---[^\S\r\n]*(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('Missing command frontmatter');
  return { ...JSON.parse(match[1]), template: match[2].trim() };
}

// Always-on opt-in flag, mirroring Claude Code's ~/.claude/.i-have-adhd-always
// but under OpenCode's config dir so the two tools stay independent.
const flagPath = path.join(
  process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'),
  'opencode',
  '.i-have-adhd-always',
);

// Read SKILL.md and strip a leading YAML frontmatter block (--- ... ---).
// Regex and trailing-newline trim match hooks/always-on.mjs so always-on
// injections behave identically across harnesses (see tests/test_always_on_hooks.py).
function rulesetBody() {
  return fs
    .readFileSync(skillPath, 'utf8')
    .replace(/^---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---[^\S\r\n]*(?:\r?\n|$)/, '')
    .replace(/(?:\r?\n)+$/, '');
}

// Shared by both APIs: the text to inject, or null when the flag is absent or
// the ruleset cannot be read. The callers differ only in how they append — V1
// mutates the last string in `output.system`, V2 pushes a typed text part.
function alwaysOnInjection() {
  let on = false;
  try { on = fs.existsSync(flagPath); } catch (e) {}
  if (!on) return null;

  let body;
  try { body = rulesetBody(); } catch (e) { return null; }

  const header =
    'ADHD MODE ACTIVE (always-on). The ruleset below applies to every ' +
    'response. "stop adhd mode" or "normal mode" turns it off for this ' +
    'session; delete ' + flagPath + ' to turn always-on off for good.';
  return header + '\n\n' + body;
}

export default {
  id: SKILL_ID,

  // OpenCode V2.
  async setup(ctx) {
    // Make the skill discoverable, so the `skill` tool and the /i-have-adhd
    // command can both load it.
    try {
      const content = rulesetBody();
      await ctx.skill.transform((editor) => {
        if (editor.get(SKILL_ID)) return;
        editor.add({
          id: SKILL_ID,
          name: SKILL_ID,
          description: FALLBACK_DESCRIPTION,
          path: skillPath,
          content,
        });
      });
    } catch (e) {
      // Missing or malformed SKILL.md must not break command registration.
    }

    // Register /i-have-adhd. A global install loads the plugin from a path with
    // no project-scope `.opencode/command/` directory, so the plugin has to
    // supply the command itself (see #140).
    try {
      const command = await commandDefinition();
      await ctx.command.transform((editor) => {
        editor.add({
          name: SKILL_ID,
          description: command.description || FALLBACK_DESCRIPTION,
          execute: async ({ sessionID, prompt, delivery }) => {
            await ctx.session.prompt({
              ...prompt,
              sessionID,
              text: prompt.text ? `${command.template}\n\n${prompt.text}` : command.template,
              delivery,
            });
          },
        });
      });
    } catch (e) {
      // Missing or malformed command files must not break skill discovery.
    }

    // Always-on: append the ruleset to the system prompt every turn while the
    // flag file exists. "stop adhd mode" turns it off for the session (the
    // model honours the skill's own Persistence rules); deleting the flag
    // turns always-on off for good.
    try {
      await ctx.session.hook('context', (event) => {
        const injected = alwaysOnInjection();
        if (!injected) return;
        event.system.push({ type: 'text', text: injected });
      });
    } catch (e) {
      // Always-on injection is optional; never break plugin load.
    }
  },

  // OpenCode V1 (1.18.29+). The APIs are separate: this restates the V1 hooks
  // rather than translating `setup`.
  async server() {
    return {
      config: async (config) => {
        config.skills = config.skills || {};
        config.skills.paths = config.skills.paths || [];
        if (!config.skills.paths.includes(skillsDir)) config.skills.paths.push(skillsDir);

        // Global installs need a command entry; preserve native or user-defined commands.
        try {
          config.command = config.command || {};
          if (!config.command[SKILL_ID]) {
            config.command[SKILL_ID] = await commandDefinition();
          }
        } catch (e) {
          // Missing or malformed command files must not break skill discovery.
        }
      },

      'experimental.chat.system.transform': async (_input, output) => {
        const injected = alwaysOnInjection();
        if (!injected) return;

        if (output.system.length > 0) {
          output.system[output.system.length - 1] += '\n\n' + injected;
        } else {
          output.system.push(injected);
        }
      },
    };
  },
};
