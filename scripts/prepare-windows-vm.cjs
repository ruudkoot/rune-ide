// Edit only the IDE's staged VM copy; never the source toolchain.
const fs = require('node:fs');
(async () => {
  const resedit = await require('resedit/cjs').load();
  const file = process.argv[2];
  const exe = resedit.NtExecutable.from(fs.readFileSync(file));
  const resources = resedit.NtExecutableResource.from(exe);
  const manifests = resources.entries.filter(entry => entry.type === 24);
  if (manifests.length) throw new Error('The input VM already has a manifest; reconcile it with the IDE UTF-8 manifest before packaging');
  resources.entries.push({ type: 24, id: 1, lang: 1033, codepage: 65001, bin: fs.readFileSync(process.argv[3]) });
  resources.outputResource(exe);
  fs.writeFileSync(file, Buffer.from(exe.generate()));
})().catch(error => { console.error(error.message); process.exitCode = 1; });
