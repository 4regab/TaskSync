# TaskSync V2 
**Save premium requests on your AI coding IDEs.** This simple prompt instructions helps your AI work better and use less premium requests and give the agent new instructions while its currently working.

## What This Does
TaskSync is an **autonomous agent protocol** that creates persistent agents. Instead of typing lots of messages back and forth, you write tasks in a tasks.txt file. Your AI agent continuously monitors this file using PowerShell word count checks, executes tasks autonomously, and maintains persistent operation until manually terminated.

## How TaskSync Helps
**Add new task in one request** - You can provide new instructions to the agent without sending a new chat message by simply adding tasks to the tasks.txt file.

**Task continuation priority** - completes current tasks before processing new instructions (unless urgent override detected)

**Dual file system** - uses `tasks.txt` for instructions and separate `log.txt` for status tracking

**Real-time status logging** - it writes progress monitoring into dedicated log.txt 

**Never terminates automatically** - maintains persistent operation until you explicitly stop it

**Self-correcting behavior** - when AI makes mistakes, it reads your corrections and fixes its mistakes

**Works with any AI IDEs** - GitHub Copilot, Cursor, Windsurf, Trae IDE, and more  

## How It Works

https://github.com/user-attachments/assets/a4737779-b877-4e12-8990-1a70a7b09dcc

1. **Drag the tasksync instructions** to chat and ask the agent to strictly follow the tasksync.md.
2. **Add tasks in your `tasks.txt` file**
3. **Write Tasks** - it checks `tasks.txt` for updates automatically using PowerShell word count
4. **Change `tasks.txt` anytime** to follow next instructions or make it fix its mistakes.
**ENJOY Getting better results with way fewer premium requests!**

---

## 🚀 Quick Start

**Click install or copy-paste the installation commands for other IDEs:**

---

### 🎯 GitHub Copilot (VS Code)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode%3Achat-instructions%2Finstall%3Furl%3Dhttps%3A%2F%2Fraw.githubusercontent.com%2F4regab%2FTaskSync%2Fmain%2F.github%2Finstructions%2Ftasksync.instructions.md) [![Install in VS Code](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Achat-instructions%2Finstall%3Furl%3Dhttps%3A%2F%2Fraw.githubusercontent.com%2F4regab%2FTaskSync%2Fmain%2F.github%2Finstructions%2Ftasksync.instructions.md)
```bash
git clone --filter=blob:none --sparse https://github.com/4regab/TaskSync.git
cd TaskSync
git sparse-checkout set .github
```

**Create files**:
```text
Create tasks.txt and log.txt inside the folder. Add your tasks in tasks.txt.
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
- **PowerShell Word Count Monitoring**: Efficient `Get-Content .global\tasks.txt | Measure-Object -Word` checks
- **Task Continuation Priority**: Complete current tasks before processing new instructions (unless urgent override)
- **Dual File System**: AI uses `tasks.txt` for instructions and separate `log.txt` for status tracking
- **Status Logging**: AI writes check counts directly into dedicated log.txt file with each monitoring cycle
- **Count-Based Monitoring**: Systematic counting from Check #1 incrementing indefinitely
- **Urgent Override Detection**: Keywords like "stop current task", "correction", "fix" interrupt current work
- **Complete File Reading**: Always reads entire files (minimum 1000 lines) for comprehensive analysis
- **Real-Time Communication**: Edit `tasks.txt` anytime to communicate with AI during execution
- **Autonomous Execution**: Independent task completion with persistent operation
- **State Management**: Active → Monitoring → Manual Termination Only

---

## ⚙️ Configuration & Timing

### Monitoring Intervals

**State 1 (Active Task Execution):**
- **Interval**: 180 seconds (180000ms) fixed
- **Command**: `Get-Content [tasks.txt] | Measure-Object -Word`
- **Purpose**: Monitor for new instructions while working on current tasks

**State 2 (Monitoring Mode):**
- **Interval**: 30 seconds (30000ms) fixed  
- **Command**: `Start-Sleep -Seconds 30; Get-Content [tasks.txt] | Measure-Object -Word`
- **Purpose**: Rapid response after task completion

### Performance Recommendations

- **180 seconds (3 minutes)**: Balanced performance without overwhelming the AI
- **30 seconds**: Quick response for new tasks after completion
- **Shorter intervals**: More responsive but may impact AI performance
- **Longer intervals**: Better performance but slower response to changes
---

## 🔧 Usage Examples

**Real-time task communication with separate log file - edit `tasks.txt` anytime:**

## 🔧 Example content of tasks.txt`

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

## 🤝 Contributing

Feel free to submit PR! See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for development setup, coding standards, and submission guidelines.

## 📚 Documentation

- [Complete Protocol](docs/PROTOCOL.md)
- [Usage Examples](docs/EXAMPLES.md)  
- [Implementation Guide](docs/USAGE.md)
- [Contributing Guidelines](docs/CONTRIBUTING.md)

## 📊 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=4regab/TaskSync&type=Date)](https://www.star-history.com/#4regab/TaskSync&Date)

⭐ Drop a star if you find this useful!
