// commandRegistry.js
//
// Usage:
//   const registry = require('./commandRegistry');
//   registry.register('/servercheck or /sc', 'per-server Usage/Limit or Expired report', ['superadmin', 'admin']);
//   registry.register('/removekey <key>', 'removes an Outline key from the server AND DB', ['superadmin', 'admin'], '[Outline]');
//
// A single shared list every command handler file adds itself to when it
// loads (call this once, at module top-level — NOT inside the exported
// register-with-bot function, so it runs exactly once at require-time
// regardless of how many times/roles the command itself gets invoked).
//
// /admin reads from this list at request time, filters by the caller's
// role and groups by category, instead of a hardcoded string — so a new
// command shows up in /admin automatically the moment its handler file
// adds a register() call, with no second file to keep in sync.
//
// Categories (the optional 4th argument of register()):
//   'Admin' | 'Account' | 'Keys' | '[Outline]' | '[WG]' | 'Servers' | 'Other'
// A command registered WITHOUT a category is looked up in
// DEFAULT_CATEGORY_BY_COMMAND below (so handler files you have not touched
// still land in the right section); anything unknown goes to 'Other'.
//
// Registering the same command twice (same first word of the usage string)
// REPLACES the earlier entry instead of listing it twice.

// Order + display titles used by /admin.
const CATEGORIES = [
    { key: 'Admin',     title: '👑 Admin' },
    { key: 'Account',   title: '👤 Account' },
    { key: 'Keys',      title: '🔑 Keys (Outline + WG)' },
    { key: '[Outline]', title: '🅾️ [Outline]' },
    { key: '[WG]',      title: '🔌 [WG]' },
    { key: 'Servers',   title: '🖥️ Servers & Usage' },
    { key: 'Other',     title: '📦 Other' }
];

// Category for commands whose handler file does not pass one to register().
// Keys are the command name in lower case, exactly as typed after the slash.
// To move a command, edit its line here (vi commandRegistry.js).
const DEFAULT_CATEGORY_BY_COMMAND = {
    '/admin': 'Admin',
    '/admincommand': 'Admin',
    '/broadcast': 'Admin',
    '/sendmessage': 'Admin',

    '/listusers': 'Account',
    '/lu': 'Account',

    '/keystatus': 'Keys',

    '/removekeyexpired': '[Outline]',

    '/wgremovekey': '[WG]',
    '/wgremovekeyexpired': '[WG]',

    '/servercheck': 'Servers',
    '/sc': 'Servers',
    '/usagewarning': 'Servers',
    '/usagewarninginfo': 'Servers'
};

const commands = [];

// Usage:
//   keyOf('/servercheck or /sc')  -> '/servercheck'
function keyOf(usage) {
    return String(usage).trim().split(/\s+/)[0].toLowerCase();
}

// Usage:
//   register(usageString, descriptionString, rolesArray, category?)
//
// rolesArray should be a subset of ['superadmin', 'admin', 'moderator'].
// category is optional (see the top of this file).
function register(usage, description, roles, category) {
    const key = keyOf(usage);
    const i = commands.findIndex(c => keyOf(c.usage) === key);
    if (i >= 0) {
        commands[i] = { usage, description, roles, category: category || commands[i].category };
    } else {
        commands.push({ usage, description, roles, category });
    }
}

// Usage:
//   getAll() -> every registered command as { usage, description, roles, category }
//   (category is always filled in: explicit -> default map -> 'Other')
function getAll() {
    return commands.map(c => ({
        ...c,
        category: c.category || DEFAULT_CATEGORY_BY_COMMAND[keyOf(c.usage)] || 'Other'
    }));
}

module.exports = { register, getAll, CATEGORIES };
