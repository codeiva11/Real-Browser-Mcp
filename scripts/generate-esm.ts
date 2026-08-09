import * as fs from 'fs';
import * as path from 'path';

// Read CJS source directly from project root lib/cjs
const cjsDir = path.join(__dirname, '..', '..', 'lib', 'cjs');
// Write ESM directly to project root lib/esm so package.json paths work
const esmDir = path.join(__dirname, '..', '..', 'lib', 'esm');

function convertCjsToEsm(content: string, _filename: string): string {
  let out = content;
  out = out.replace(/\/\/ @ts-nocheck\n/g, '');
  out = out.replace(/export\s*\{\s*\};\n/g, '');
  out = out.replace(/^export\s*\{[^}]+\};?\s*$/gm, '');

  const moduleExportsMatch = out.match(/module\.exports\s*=\s*\{\s*([^}]+)\s*\};/);
  const exportedNames: string[] = moduleExportsMatch
    ? moduleExportsMatch[1].split(',').map((n: string) => n.trim()).filter(Boolean)
    : [];

  out = out.replace(/const\s+\{\s*([^}]+)\s*\}\s*=\s*require\(([^)]+)\);/g, (_: string, names: string, mod: string) => {
    let modPath = mod.replace(/['"]/g, '');
    if (modPath.endsWith('.js')) modPath = modPath.replace(/\.js$/, '.mjs');
    return `import { ${names.trim()} } from '${modPath}';`;
  });

  out = out.replace(/from\s+'(\.[^']+)'/g, (match: string, modPath: string) => {
    if (modPath.endsWith('.mjs')) return match;
    return `from '${modPath}.mjs'`;
  });

  out = out.replace(/module\.exports\s*=\s*\{\s*[^}]+\s*\};/g, '');

  for (const name of exportedNames) {
    const fnRegex = new RegExp(`^(\\s*)async function ${name}\\(`, 'gm');
    out = out.replace(fnRegex, `$1export async function ${name}(`);
    const constRegex = new RegExp(`^(\\s*)const ${name}\\s*=\\s*async`, 'gm');
    out = out.replace(constRegex, `$1export const ${name} = async`);
  }

  out = out.replace(/:\s*\{[^}]*\}/g, '');
  out = out.replace(/:\s*Promise<[^>]*>/g, '');
  out = out.replace(/:\s*Array<[^>]*>/g, '');
  out = out.replace(/:\s*(string|number|boolean|any|void|null|undefined)\b/g, '');
  out = out.replace(/\)\s*:\s*\w+/g, ')');
  out = out.replace(/as\s+(any|string|number|boolean)\b/g, '');

  return out;
}

function processDir(cjsSubDir: string, esmSubDir: string): void {
  if (!fs.existsSync(esmSubDir)) fs.mkdirSync(esmSubDir, { recursive: true });
  // Remove stale declaration artifacts (*.d.mjs) left by earlier build steps.
  // They are not emitted by this script and nothing references them, so they
  // would otherwise accumulate in the published package forever.
  for (const stale of fs.readdirSync(esmSubDir)) {
    if (stale.endsWith('.d.mjs')) fs.unlinkSync(path.join(esmSubDir, stale));
  }
  for (const entry of fs.readdirSync(cjsSubDir, { withFileTypes: true })) {
    const cjsPath = path.join(cjsSubDir, entry.name);
    const esmName = entry.name.replace(/\.ts$/, '.mjs');
    const esmPath = path.join(esmSubDir, esmName);
    if (entry.isDirectory()) {
      processDir(cjsPath, esmPath);
    } else if (entry.name.endsWith('.ts')) {
      const content = fs.readFileSync(cjsPath, 'utf-8');
      const esm = convertCjsToEsm(content, entry.name);
      fs.writeFileSync(esmPath, esm);
    }
  }
}

processDir(cjsDir, esmDir);

const indexEsm = `import { pageController } from "./module/pageController.mjs";
import { createConnect } from "../../dist/src/shared/lib-core.js";

export const connect = createConnect(pageController);
`;
fs.writeFileSync(path.join(esmDir, 'index.mjs'), indexEsm);

// Validate output: every .ts file in lib/cjs must have a corresponding .mjs,
// and every generated file must be non-empty (catches silent conversion
// failures before they ship).
let converted = 0;
let failed = false;
function validateDir(cjsSubDir: string, esmSubDir: string): void {
  for (const entry of fs.readdirSync(cjsSubDir, { withFileTypes: true })) {
    const cjsPath = path.join(cjsSubDir, entry.name);
    const esmName = entry.name.replace(/\.ts$/, '.mjs');
    const esmPath = path.join(esmSubDir, esmName);
    if (entry.isDirectory()) {
      validateDir(cjsPath, esmPath);
    } else if (entry.name.endsWith('.ts')) {
      if (!fs.existsSync(esmPath)) {
        console.error(`❌ Missing ESM output for ${cjsPath}`);
        failed = true;
        continue;
      }
      const content = fs.readFileSync(esmPath, 'utf8');
      if (!content.trim()) {
        console.error(`❌ Empty ESM output for ${cjsPath}`);
        failed = true;
        continue;
      }
      converted++;
    }
  }
}
validateDir(cjsDir, esmDir);

if (failed) {
  console.error(`❌ ESM generation failed validation (${converted} files ok)`);
  process.exit(1);
}

console.log(`✅ ESM files auto-generated from CJS source (${converted} files)`);
