// 裂缝领域规则验证：esbuild 打包 TS 后用 node 运行（localStorage 在无浏览器环境自动走内存兜底）。
const esbuild = require('esbuild')
const { execFileSync } = require('node:child_process')
const path = require('node:path')

const outfile = path.join(__dirname, '.verify-bundle.mjs')

esbuild
  .build({
    entryPoints: [path.join(__dirname, 'verify-crack.ts')],
    bundle: true,
    platform: 'node',
    format: 'esm',
    outfile,
  })
  .then(() => {
    execFileSync(process.execPath, [outfile], { stdio: 'inherit' })
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
