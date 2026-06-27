#!/bin/bash
# 启动桌宠。双击或在终端运行： ./run.sh
cd "$(dirname "$0")"
export PATH="$PWD/.toolchain/node-v20.18.0-darwin-arm64/bin:$PATH"
# 从 VS Code / Claude 这类 Electron 应用启动的终端会带上这个变量，
# 它会让 Electron 退化成普通 Node，必须清掉。
unset ELECTRON_RUN_AS_NODE
exec npm start
