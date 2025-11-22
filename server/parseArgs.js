// parseArgs.js - module to parse command line arguments for cometserver.js.
//   mission name can be provided as first positional arg or via --mission flag
//   other flags can be long (--flag or --flag=value) or short (-abc)
//   positional args (other than mission) go into _ array

function parseArgs(defaults = {}, argv = process.argv.slice(2)) {
  const out = { ...defaults, _: [] };
  let missionSet = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];

    // --mission value  OR  --mission=value
    if (a.startsWith('--mission')) {
      const [, val] = a.split('=');
      out.mission = val !== undefined ? val : argv[++i];
      missionSet = true;
      continue;
    }

    // Long flags (--key=value or --key value or boolean --key)
    if (a.startsWith('--')) {
      const [key, val] = a.slice(2).split('=');

      if (val !== undefined) {
        // Case: --key=value
        out[key] = val;
      } else {
        // Case: --key value OR boolean --key
        const next = argv[i + 1];
        if (next && !next.startsWith('-')) {
          out[key] = next;
          i++;           // <-- skip the consumed value
        } else {
          out[key] = true;
        }
      }
      continue;
    }

    // Short flags (-v or -abc)
    if (a.startsWith('-') && a.length > 1) {
      a.slice(1).split('').forEach(flag => (out[flag] = true));
      continue;
    }

    // First positional argument → mission (only if none provided)
    if (!missionSet) {
      out.mission = a;
      missionSet = true;
      continue;
    }

    // Other positionals go to _.push()
    out._.push(a);
  }

  return out;
}

module.exports = parseArgs;
