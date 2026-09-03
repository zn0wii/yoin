#!/usr/bin/env bash
#
# 编译 Yoin 的 Windows 安装包。
#
# 用法:
#   ./scripts/build-win.sh              # 默认打 NSIS 安装包(setup .exe)
#   ./scripts/build-win.sh msi          # 打 MSI
#   ./scripts/build-win.sh nsis,msi     # 两种都打
#
# 产物位于 src-tauri/target/release/bundle/ 下,脚本结束时列出路径和大小。
# 前端构建由 tauri.conf.json 的 beforeBuildCommand(pnpm build)自动完成。

set -euo pipefail
cd "$(dirname "$0")/.."

BUNDLES="${1:-nsis}"

echo "==> 编译 Windows 安装包 (bundles: ${BUNDLES})"
pnpm tauri build --bundles "${BUNDLES}"

echo
echo "==> 产物:"
find src-tauri/target/release/bundle -type f \( -name "*.exe" -o -name "*.msi" \) -exec ls -lh {} +
