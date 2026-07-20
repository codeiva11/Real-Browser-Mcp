import * as fs from 'fs';
import * as path from 'path';

const cjsDir = path.join(__dirname, '..', 'lib', 'cjs');
const esmDir = path.join(__dirname, '..', 'lib', 'esm');

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

console.log('✅ ESM files auto-generated from CJS source');
