// A single executable is one CommonJS script: `import.meta.url` there is the executable's own file URL.
exports.__afbinImportMetaUrl = require('node:url').pathToFileURL(__filename).href;
