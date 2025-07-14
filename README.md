# TaskSync
**Save premium requests on your AI coding IDEs.** This simple prompt instructions helps your AI work better and use less premium requests and give the agent new instructions while its currently working.
## What This Does
TaskSync is an **autonomous agent protocol** that creates persistent AI assistants. Instead of typing lots of messages back and forth, you write tasks in a `tasks.txt` file. Your AI agent continuously monitors this file, executes tasks autonomously, and maintains persistent operation until manually terminated.

## How TaskSync Helps
✅ **Infinite AI monitoring** - continuously checks your `tasks.txt` file every 30-60 seconds forever
✅ **Autonomous task execution** - AI works independently without constant user interaction  
✅ **Real-time status logging** - AI writes progress directly into `tasks.txt` with count-based monitoring
✅ **Never terminates automatically** - maintains persistent operation until you explicitly stop it
✅ **Self-correcting behavior** - when AI makes mistakes, it reads your corrections and fixes them
✅ **Works with any AI tool** - GitHub Copilot, Cursor, Windsurf, Trae IDE, and more  

## How It Works

https://github.com/user-attachments/assets/5f307fcd-052b-4b6b-940e-a0e946913c77

1. **Drag the tasksync instructions** to chat
2. **Add tasks in your `tasks.txt` file**
3. **Write what you want** - it checks `tasks.txt` for updates automatically
4. **Change `tasks.txt` anytime** to follow next instructions or make it fix its mistakes.

**Start saving money today.** Get the better results with way fewer premium requests.

---

## 🚀 Quick Start

**Choose your IDE and copy-paste the installation commands:**

---

### 🎯 GitHub Copilot (VS Code)

[![Install in VS Code](https://img.shields.io/badge/VS_Code-Install-0098FF?style=flat-square&logo=visualstudiocode&logoColor=white)](https://vscode.dev/redirect?url=vscode%3Achat-instructions%2Finstall%3Furl%3Dhttps%3A%2F%2Fraw.githubusercontent.com%2F4regab%2FTaskSync%2Fmain%2F.github%2Finstructions%2Ftasksync.instructions.md) [![Install in VS Code](https://img.shields.io/badge/VS_Code_Insiders-Install-24bfa5?style=flat-square&logo=visualstudiocode&logoColor=white)](https://insiders.vscode.dev/redirect?url=vscode-insiders%3Achat-instructions%2Finstall%3Furl%3Dhttps%3A%2F%2Fraw.githubusercontent.com%2F4regab%2FTaskSync%2Fmain%2F.github%2Finstructions%2Ftasksync.instructions.md)

Make tasks.txt inside the instructions folder and add your tasks/instructions there.
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
- **Status Logging**: AI writes check counts directly into `.github/instructions/tasks.txt` file with each monitoring cycle
- **Count-Based Monitoring**: Systematic counting from Check #1 incrementing indefinitely
- **File Editing Protocol**: Mandatory physical file editing with each monitoring check
- **Complete File Reading**: Always reads entire files (minimum 1000 lines) for comprehensive analysis
- **Real-Time Communication**: Edit `.github/instructions/tasks.txt` anytime to communicate with AI during execution
- **Autonomous Execution**: Independent task completion with persistent operation
- **State Management**: Active → Monitoring → Manual Termination Only
---

## 🔧 Usage Examples

**Real-time task communication with status logging - edit `tasks.txt` anytime:**

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

--- STATUS LOG ---
Check #1: - Read tasks.txt containing 8 lines. No new instructions found.
```

**Multi-Step Project with continuous monitoring:**

```text  
# Project Setup
1. Set up Next.js project with TypeScript
2. Configure Tailwind CSS and shadcn/ui
3. Create user authentication system
4. Add comprehensive testing

# Current Focus
Working on step 2 - focus on responsive design

--- STATUS LOG ---
Check #15: - Read tasks.txt containing 9 lines. Continuing step 2 implementation.
```

**Code Review with persistent operation:**

```text
# Review Tasks
Review codebase for performance issues
Implement optimization recommendations  
Add documentation for public APIs

# Priority: Security audit of API endpoints

--- STATUS LOG ---
Check #7: - Read tasks.txt containing 7 lines. Security audit in progress.
```

---

## ⚠️ Known Issues

### AI Model Termination Behavior
**Issue**: AI models tend to end conversations quickly, especially after completing tasks.

**Solution**: Continuously add new tasks to `.github/instructions/tasks.txt` before the AI finishes its current work to maintain persistent operation.

**Best Practices**:
- Queue multiple tasks in `.github/instructions/tasks.txt` from the beginning
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

--- STATUS LOG ---
Check #5: - Read tasks.txt containing 9 lines. Authentication bug fix 80% complete.
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
