const fs = require('fs');
const files = process.argv.slice(2);
for (const f of files) {
  let html;
  try { html = fs.readFileSync(f, 'utf8'); } catch (e) { console.log('skip', f, e.message); continue; }
  // Replicate the Kotlin regex: (eval\(function\(p,a,c,k,e,d\).*?\))\s*</script  with DOT_MATCHES_ALL
  const m = html.match(/(eval\(function\(p,a,c,k,e,d\)[\s\S]*?\))\s*<\/script/);
  console.log('\n=== ' + f + ' ===');
  console.log('KOTLIN-REGEX block match:', !!m, m ? ('len=' + m[1].length) : '');
  if (!m) continue;
  const blk = m[1];
  try {
    const unpacked = String(eval(blk.replace(/^eval/, '')));
    console.log('unpacked len:', unpacked.length);
    const m3 = unpacked.match(/https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/i);
    const file = unpacked.match(/"file"\s*:\s*"([^"]+)"/);
    const mp4 = unpacked.match(/https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*/i);
    console.log('m3u8 in unpacked:', m3 ? m3[0] : null);
    console.log('file: match  :', file ? file[1] : null);
    console.log('mp4 in unpacked:', mp4 ? mp4[0] : null);
    console.log('snippet:', unpacked.slice(0, 260));
  } catch (e) {
    console.log('eval err:', e.message);
  }
}
