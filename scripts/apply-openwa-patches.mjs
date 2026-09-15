// Reaplica as correções do @open-wa/wa-automate depois do `npm install`.
// A versão publicada no npm (4.76.0) não detecta o QR do WhatsApp Web atual e trava
// esperando `window.Debug`; os arquivos corrigidos ficam em openwa-patches/ no repositório.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PKG = "@open-wa/wa-automate";

const moduleDir = path.join(process.cwd(), "node_modules", PKG);
const pkgJson = path.join(moduleDir, "package.json");
if (!fs.existsSync(pkgJson)) {
  console.log(`[openwa-patches] ${PKG} não instalado; nada a aplicar.`);
  process.exit(0);
}

const version = JSON.parse(fs.readFileSync(pkgJson, "utf8")).version;
const patchDir = path.join(ROOT, "openwa-patches", `${PKG}@${version}`);
if (!fs.existsSync(patchDir)) {
  console.warn(`[openwa-patches] Sem correções para ${PKG}@${version}. O servidor OpenWA pode não gerar QR.`);
  process.exit(0);
}

function copyTree(src, dest) {
  let count = 0;
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      count += copyTree(from, to);
    } else {
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(from, to);
      count++;
    }
  }
  return count;
}

const applied = copyTree(patchDir, moduleDir);
console.log(`[openwa-patches] ${applied} arquivo(s) corrigido(s) aplicados em ${PKG}@${version}.`);
