# 贡献指南

感谢你对「直播助手」项目的关注！

## 如何贡献

### 报告 Bug

如果你发现了 Bug，请：

1. 检查 [Issues](https://github.com/touchfish/live-stream-assistant/issues) 是否已有相关问题
2. 如果没有，创建新 Issue 并提供：
   - 问题描述
   - 复现步骤
   - 预期行为
   - 实际行为
   - 系统环境（操作系统、Node 版本、Python 版本）
   - 错误日志（如果有）

### 提交功能请求

1. 在 Issues 中搜索是否有类似的功能请求
2. 如果没有，创建新 Issue 并描述：
   - 功能需求
   - 使用场景
   - 预期效果

### 提交代码

1. **Fork 项目**
   ```bash
   git clone https://github.com/你的用户名/live-stream-assistant.git
   cd live-stream-assistant
   ```

2. **创建功能分支**
   ```bash
   git checkout -b feature/your-feature-name
   # 或
   git checkout -b fix/your-bug-fix
   ```

3. **开发和测试**
   - 遵循现有代码风格
   - 添加必要的注释
   - 测试你的更改

4. **提交更改**
   ```bash
   git add .
   git commit -m "feat: 添加某某功能"
   # 或
   git commit -m "fix: 修复某某问题"
   ```

   提交信息规范：
   - `feat:` 新功能
   - `fix:` Bug 修复
   - `docs:` 文档更新
   - `style:` 代码格式调整
   - `refactor:` 重构
   - `test:` 测试相关
   - `chore:` 构建/工具链更新

5. **推送到远程**
   ```bash
   git push origin feature/your-feature-name
   ```

6. **创建 Pull Request**
   - 在 GitHub 上创建 PR
   - 描述你的更改内容
   - 关联相关 Issue（如果有）

## 开发规范

### 代码风格

- **TypeScript/JavaScript**: 使用 2 空格缩进
- **Python**: 遵循 PEP 8 规范
- **Vue**: 遵循 Vue 3 Composition API 风格指南

### 目录结构约定

- `app/electron/`: Electron 主进程代码
- `app/src/components/`: Vue 组件
- `app/src/lib/`: 业务逻辑
- `core/fetcher/`: 弹幕采集器
- `core/vendor/`: 第三方依赖

### 测试

- 提交代码前请确保本地测试通过
- 重要功能请添加测试用例

## 许可证

提交代码即表示你同意你的贡献将使用 CC BY-NC-SA 4.0 许可证。

## 联系方式

- Email: touchfish.cc@outlook.com
- GitHub Issues: https://github.com/touchfish/live-stream-assistant/issues

感谢你的贡献！
