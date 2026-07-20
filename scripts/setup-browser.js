const { spawnSync } = require('child_process');

function run(command) {
  // Pass the full command as a single string with shell:true so `npx` resolves
  // correctly across Windows/Linux/macOS without spawning deprecation warnings.
  const res = spawnSync(command, { stdio: 'inherit', shell: true });
  return res.status === 0;
}

// Skip auto-download in CI / Docker builds (those fetch the browser explicitly).
if (process.env.CI || process.env.SKIP_BROWSER_SETUP) {
  console.log('\n⏩ Skipping Patchright Chromium auto-download (CI/Docker env detected).\n');
  process.exit(0);
}

console.log('\n📥 Setting up hardened browser (Patchright Chromium)...\n');

const ok = run('npx patchright install chromium');

if (!ok) {
  console.warn(
    '\n⚠️  Could not auto-download Patchright Chromium during install.\n' +
    '   The server will still install, but you must run the following before using it:\n' +
    '       npx patchright install chromium\n'
  );
} else {
  console.log('\n✅ Patchright Chromium is ready.\n');
}
