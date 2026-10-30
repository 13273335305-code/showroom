# 设计台 AO 可见度检查

AO 的加载、线性颜色空间和物理 UV 绑定正常。当前夜景的环境强度为 0.05，主灯为 2.7、补光为 5；Three 原生 AO 仅遮蔽间接光，因此上传的面料 AO 在直射灯下很弱。

上传/资产库面料 AO 继续使用原有间接光遮蔽，并以 50% 权重遮蔽直射漫反射和绒毛光。直射镜面高光和模型内置烘焙 AO 沿用原有行为。复用现有 AO 采样、UV 和强度，强度计算限制在 0–1，白图与强度 0 保持中性。材质编辑器和设计台通过共享材质钩子使用相同效果。

固定夜景、灰度 64/255 的测试区域：关闭 AO 时平均 RGB 为 72，原算法为 64.33，调整后为 42.33。这是诊断贴图的渲染数据，不代表任意实际面料的改善幅度。

- `node checks/ambient-occlusion.test.cjs`：通过三种光照、纯直射灯、白图、强度 0、移除、强度饱和、内置 AO、UV0/UV2 与偏移、着色器组合、真实拖拽、项目保存重开、手机视口及编辑器上传检查。云端读写使用测试替身。
- `node checks/procedural-relief.test.cjs`：通过程序化法线/AO 生成、物理 UV、材质包保存恢复、失效清除及手机布局检查。
- `node checks/normal-convention.test.cjs`：通过 GLB/FBX 法线、材质替换、项目恢复及缓存模型检查。
- `node --test checks/fabric-sheen.test.mjs checks/material-package.test.mjs checks/material-placement.test.mjs checks/material-assignments.test.mjs checks/physical-textures.test.mjs`：9 项通过。
- 现有 `checks/texture-sampling.test.cjs` 的独立 GPU 采样/着色器检查通过；后续编辑器流程在等待保存按钮可用时超时。该脚本未提供登录测试替身，完整流程的结果不计为通过；本次新增 AO 测试已独立覆盖编辑器、材质替换和项目恢复。

可视对比：`outputs/ao-comparison.png`，使用同一测试球体、视角、灯光与基础色，只有 AO 强度不同；条纹为诊断 AO。
