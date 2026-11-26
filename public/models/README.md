# 默认模型放这里

页面启动时会加载 `public/models/battery.glb` 当默认模型。

**这个文件不在仓库里**（78 MB，塞进 git 会让所有人克隆时都多拉一份，GitHub 也会报警告）。想跑起来，把自己的模型放进来：

```bash
# 仓库根目录执行
mkdir -p public/models
cp "你的模型.glb" public/models/battery.glb
```

文件名保持 `battery.glb` 就不用改代码。想换名字，改两处：

- `src/three/Studio.js` 里 `loadDefault('/models/battery.glb')`
- `src/App.vue` 里 `boot()` 的 `DEFAULT_MODEL`

支持 glTF/GLB、FBX、OBJ、STL、PLY。**不放这个文件也能用**——页面照样能开，只是首屏没有默认模型，把模型拖进窗口即可加载（左下「导入其它模型」同理）。
