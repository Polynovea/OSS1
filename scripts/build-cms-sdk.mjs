import ts from 'typescript';
import { resolve } from 'node:path';

const configPath = resolve('packages/cms-sdk/tsconfig.json');
const read = ts.readConfigFile(configPath, ts.sys.readFile);
if (read.error) {
  console.error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  process.exit(1);
}
const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, resolve('packages/cms-sdk'));
const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
const emit = program.emit();
const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emit.diagnostics];
if (diagnostics.length) {
  for (const diagnostic of diagnostics) {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
    if (diagnostic.file && diagnostic.start !== undefined) {
      const pos = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      console.error(`${diagnostic.file.fileName}:${pos.line + 1}:${pos.character + 1} ${message}`);
    } else console.error(message);
  }
  process.exit(1);
}
console.log(`CMS SDK build passed (${parsed.fileNames.length} source file${parsed.fileNames.length === 1 ? '' : 's'}).`);
