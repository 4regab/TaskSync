# TaskSync
**Save premium requests on your AI coding IDEs.** This simple prompt instructions helps your AI work better and use less premium requests and give the agent new instructions while its currently working.
## What This Does
TaskSync is an **autonomous agent protocol** that creates persistent agent. Instead of typing lots of messages back and forth, you write tasks in a `tasks.txt` file. Your AI agent continuously monitors this file, executes tasks autonomously, and maintains persistent operation until manually terminated.

## How TaskSync Helps
**Tasks monitoring** - continuously checks your `tasks.txt` file every 60 seconds to 5 minutes for new tasks.

**Dual file system** - AI uses `tasks.txt` for instructions and separate `log.txt` for status tracking

**Real-time status logging** - AI writes progress monitoring into dedicated `log.txt` with count-based monitoring

**Never terminates automatically** - maintains persistent operation until you explicitly stop it

**Self-correcting behavior** - when AI makes mistakes, it reads your corrections and fixes its mistakes

**Works with any AI IDEs** - GitHub Copilot, Cursor, Windsurf, Trae IDE, and more  

## How It Works

https://github.com/user-attachments/assets/77f953ae-8c67-48bc-8673-4ec66486f35d

1. **Drag the tasksync instructions** to chat and ask the agent to follow the tasksync.
2. **Add tasks in your `tasks.txt` file**
3. **Write what you want** - it checks `tasks.txt` for updates automatically
4. **Change `tasks.txt` anytime** to follow next instructions or make it fix its mistakes.

**Start saving money today.** Get the better results with way fewer premium requests.

---

## 🚀 Quick Start

**Click install or copy-paste the installation commands for other IDEs:**

---

### 🎯 GitHub Copilot (VS Code)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode%3Achat-instructions%2Finstall%3Furl%3Dhttps%3A%2F%2Fraw.githubusercontent.com%2F4regab%2FTaskSync%2Fmain%2F.github%2Finstructions%2Ftasksync.instructions.md) [![Install in VS Code](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Achat-instructions%2Finstall%3Furl%3Dhttps%3A%2F%2Fraw.githubusercontent.com%2F4regab%2FTaskSync%2Fmain%2F.github%2Finstructions%2Ftasksync.instructions.md)
```text
Create tasks.txt and log.txt file inside instructions folder. Add your tasks in tasks.txt.
```
---

### 🎯 Cursor IDE

```bash
git clone --filter=blob:none --sparse https://github.com/4regab/TaskSync.git
cd TaskSync
git sparse-checkout set .cursor
```
---

### 🎯 Global (Any IDE)

```bash
git clone --filter=blob:none --sparse https://github.com/4regab/TaskSync.git
cd TaskSync
git sparse-checkout set .global
```
---
### 🎯 IDE-Specific Documentation
- **[GitHub Copilot (VS Code)](.github/)** - `.github/instructions/` setup for maximum premium usage
- **[Cursor IDE](.cursor/)** - Modern `.cursor/rules/*.mdc` setup
- **[Global](.global/)** - `global_rules.md` for any IDE

---
### TaskSync Protocol Features

- **Infinite Monitoring**: AI never terminates automatically - operates continuously until manually stopped
- **Dual File System**: AI uses `tasks.txt` for instructions and separate `log.txt` for status tracking
- **Status Logging**: AI writes check counts directly into dedicated `log.txt` file with each monitoring cycle
- **Count-Based Monitoring**: Systematic counting from Check #1 incrementing indefinitely
- **File Editing Protocol**: Mandatory physical file editing with each monitoring check
- **Complete File Reading**: Always reads entire files (minimum 1000 lines) for comprehensive analysis
- **Real-Time Communication**: Edit `tasks.txt` anytime to communicate with AI during execution
- **Autonomous Execution**: Independent task completion with persistent operation
- **State Management**: Active → Monitoring → Manual Termination Only
---

## 🔧 Usage Examples

**Real-time task communication with separate log file - edit `tasks.txt` anytime:**

## 🔧 Example content of `tasks.txt`

```text
# Current Priority
Fix the authentication bug in login.tsx
Add TypeScript types for user profile

# New Feature Request  
Create a dashboard component with charts

# Quick Corrections
The button color should be blue, not red
Use const instead of let in the helper functions
```
---

## ⚠️ Known Issues

### AI Model Termination Behavior
**Issue**: AI models tend to end conversations quickly, especially after completing tasks.

**Solution**: Continuously add new tasks to `tasks.txt` before the AI finishes its current work to maintain persistent operation.

**Best Practices**:
- Queue multiple tasks in `tasks.txt` from the beginning
- Add new tasks while AI is working on current ones  
- Use the STATUS LOG to monitor AI progress and add tasks proactively
- Keep a backlog of improvements, optimizations, or additional features ready

**Example of Continuous Task Management**:

```text
# Current Task
Fix authentication bug in login.tsx

# Queued Tasks (add these before current task completes)
Add TypeScript types for user profile
Implement password reset functionality
Add unit tests for authentication
Optimize login page performance
Add accessibility improvements

```

**Monitoring Tip**: Watch the STATUS LOG check numbers - if they stop incrementing, the AI may have ended the session despite the infinite monitoring protocol.

---

## 🤝 Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for development setup, coding standards, and submission guidelines.

## 📚 Documentation

- [Complete Protocol](docs/PROTOCOL.md)
- [Usage Examples](docs/EXAMPLES.md)  
- [Implementation Guide](docs/USAGE.md)
- [Contributing Guidelines](docs/CONTRIBUTING.md)
