import * as fs from 'fs';
import * as path from 'path';

// This script generates the ESM (`lib/esm`) variant used by the package
// `exports`/`module` entry points. The CJS source is produced by `tsc`
// into `dist/`, so we transpile from there.
const cjsDir = path.join(__dirname, '..', 'src', 'shared');
const esmDir = path.join(__dirname, '..', '..', 'lib', 'esm');

function convertCjsToEsm(content: string, _filename: string): string {
  let out = content;
  out = out.replace(/\/\/ @ts-nocheck\n/g, '');
  out = out.replace(/export\s*\{\s*\};\n/g, '');
  out = out.replace(/^export\s*\{[^}]+\};?\s*$/gm, '');

  const moduleExportsMatch = out.match(/module\.exports\s*=\s*\{([^}]+)\s*\};/);
  const exportedNames: string[] = moduleExportsMatch
    ? moduleExportsMatch[1].split(',').map((n: string) => n.trim()).filter(Boolean)
    : [];

  out = out.replace(/const\s+\{\s*([^}]+)\s*\}\s*=\s*require\(([^)]+)\);/g, (_: string, names: string, mod: string) => {
    let modPath = mod.replace(/['"]/g, '');
    if (modPath.endsWith('.js')) modPath = modPath.replace(/\.js$/, '.mjs');
    return `import { ${names.trim()} } from '${modPath}';`;
  });

  // Bare require() calls used by tsc CJS output (e.g. `const x_1 = require("./y");`)
  out = out.replace(/const\s+([A-Za-z0-9_]+)\s*=\s*require\((['"])([^'"]+)\2\);/g, (_: string, varName: string, _q: string, mod: string) => {
    let modPath = mod;
    if (modPath.endsWith('.js')) modPath = modPath.replace(/\.js$/, '.mjs');
    return `import * as ${varName} from '${modPath}';`;
  });

  out = out.replace(/from\s+'(\.[^']+)'/g, (match: string, modPath: string) => {
    if (modPath.endsWith('.mjs')) return match;
    return `from '${modPath}.mjs'`;
  });

  out = out.replace(/module\.exports\s*=\s*\{[^}]+\s*\};/g, '');

  // Handle `exports.NAME = NAME;` style re-exports produced by tsc CJS output
  const reExportMatch = out.match(/exports\.([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_]+)\s*;/g);
  if (reExportMatch) {
    for (const m of reExportMatch) {
      const mm = m.match(/exports\.([A-Za-z0-9_]+)\s*=\s*([A-Za-z0-9_]+)/);
      if (mm) {
        out = out.replace(m, `export { ${mm[1]} };`);
      }
    }
  }

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
  for (const entry of fs.readdirSync(cjsSubDir, { withFileTypes: true })) {
    const cjsPath = path.join(cjsSubDir, entry.name);
    const esmName = entry.name.replace(/\.js$/, '.mjs');
    const esmPath = path.join(esmSubDir, esmName);
    if (entry.isDirectory()) {
      processDir(cjsPath, esmPath);
    } else if (entry.name.endsWith('.js')) {
      const content = fs.readFileSync(cjsPath, 'utf-8');
      const esm = convertCjsToEsm(content, entry.name);
      fs.writeFileSync(esmPath, esm);
    }
  }
}

if (!fs.existsSync(cjsDir)) {
  console.error('⚠️  dist/src/shared not found. Run `tsc` (npm run build) before generate-esm.');
  process.exit(0);
}

processDir(cjsDir, esmDir);

const indexEsm = `import { pageController } from "./page-controller.mjs";
import { createConnect } from "../../dist/src/shared/lib-core.js";

export const connect = createConnect(pageController);
`;
fs.writeFileSync(path.join(esmDir, 'index.mjs'), indexEsm);

console.log('✅ ESM files auto-generated from dist CJS source');
