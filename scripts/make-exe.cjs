// 编译 Windows 启动器：scripts/make-icon.cjs → public/app.ico → 点云实验室.exe
// 用系统自带的 csc.exe（.NET Framework 4.x，Win10/11 都有），不需要装 VS / SDK
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const CSC_CANDIDATES = [
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
  path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework', 'v4.0.30319', 'csc.exe')
]

const win = (p) => p.split('/').join('\\')

function findCsc() {
  for (const c of CSC_CANDIDATES) if (fs.existsSync(c)) return c
  return null
}

// 1) 图标
execFileSync(process.execPath, [path.join(__dirname, 'make-icon.cjs')], { cwd: ROOT, stdio: 'inherit' })

// 2) 编译
const csc = findCsc()
if (!csc) {
  console.error('找不到 csc.exe（.NET Framework 4.x）—— 这一步只能在 Windows 上做')
  process.exit(1)
}

const args = [
  '-nologo',
  '-target:exe',
  '-platform:anycpu',
  '-optimize+',
  '-win32icon:' + win(path.join(ROOT, 'public', 'app.ico')),
  '-out:' + win(path.join(ROOT, '点云实验室.exe')),
  win(path.join(ROOT, 'tools', 'launcher.cs'))
]

execFileSync(csc, args, { cwd: ROOT, stdio: 'inherit' })

const exe = path.join(ROOT, '点云实验室.exe')
const size = fs.statSync(exe).size
console.log('wrote 点云实验室.exe', (size / 1024).toFixed(1) + ' KB')
