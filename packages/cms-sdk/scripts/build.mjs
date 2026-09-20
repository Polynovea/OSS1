import ts from 'typescript';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(here,'..');
const configPath=resolve(root,'tsconfig.json');
const raw=ts.readConfigFile(configPath,(p)=>readFileSync(p,'utf8'));
if(raw.error){console.error(ts.flattenDiagnosticMessageText(raw.error.messageText,'\n'));process.exit(1);}
const parsed=ts.parseJsonConfigFileContent(raw.config,ts.sys,root,undefined,configPath);
const program=ts.createProgram({rootNames:parsed.fileNames,options:parsed.options});
const pre=ts.getPreEmitDiagnostics(program);
if(pre.length){for(const d of pre)console.error(ts.flattenDiagnosticMessageText(d.messageText,'\n'));process.exit(1);}
const emit=program.emit();
if(emit.emitSkipped||emit.diagnostics.length){for(const d of emit.diagnostics)console.error(ts.flattenDiagnosticMessageText(d.messageText,'\n'));process.exit(1);}
console.log(`SDK build passed (${program.getSourceFiles().filter(f=>!f.isDeclarationFile).length} source files).`);