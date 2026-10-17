#!/bin/zsh
cd "${0:A:h}"
if command -v node >/dev/null 2>&1; then
  node server.mjs
elif [[ -x "/Applications/Visual Studio Code.app/Contents/MacOS/Code" ]]; then
  ELECTRON_RUN_AS_NODE=1 "/Applications/Visual Studio Code.app/Contents/MacOS/Code" server.mjs
else
  echo "Instala Node.js 22 o superior para iniciar el editor local."
  read -r "?Pulsa Intro para cerrar."
fi
