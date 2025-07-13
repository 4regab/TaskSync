# TaskSync
**Save money on your AI coding IDEs.** This simple prompt insutrctions helps your AI work better and use less premium requests.

## What This Does
TaskSync is just **prompt instructions** that make your AI smarter. Instead of typing lots of messages back and forth, you write tasks in `tasks.txt`. Your AI agent reads this file and does the work by itself.

## How TaskSync Helps
✅ **AI checks for updates automatically** - Change your tasks.txt file anytime, AI will see it and follows the new instructions.  
✅ **AI fixes itself** - When AI makes mistakes, it reads your notes and fixes them  
✅ **Works with any AI tool** - GitHub Copilot, Cursor, Windsurf, Trae IDE, and more  

## How It Works

https://github.com/user-attachments/assets/5f307fcd-052b-4b6b-940e-a0e946913c77

1. **Drag the tasksync instructions** to chat
2. **Add tasks in tasks.txt file** 
3. **Write what you want** 
4. **Let AI work alone** - it checks for updates automatically
5. **Change tasks.txt anytime** to follow next insutructions or make it fix its mistakes.

**Start saving money today.** Get the better results with way fewer premium requests.

---

## 🚀 Quick Start

**Choose your IDE and copy-paste the installation commands:**

---

### 🎯 GitHub Copilot (VS Code)

```bash
git clone --filter=blob:none --sparse https://github.com/4regab/TaskSync.git
cd TaskSync
git sparse-checkout set .github
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

## 🛠️ How It Works

1. **Copy rule file** to your project root
2. **Edit `tasks.txt`** anytime to give AI new instructions in real-time
3. **AI monitors** `tasks.txt` every 60 seconds
4. **Autonomous execution** with state management

### TaskSync Protocol Features
- **Real-Time Communication**: Edit `tasks.txt` anytime to communicate with AI
- **Autonomous Execution**: Independent task completion  
- **State Management**: Active → Monitoring → Terminating
---

## 🔧 Usage Examples

**Real-time task communication - edit `tasks.txt` anytime:**

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

**Multi-Step Project:**
```text  
# Project Setup
1. Set up Next.js project with TypeScript
2. Configure Tailwind CSS and shadcn/ui
3. Create user authentication system
4. Add comprehensive testing

# Current Focus
Working on step 2 - focus on responsive design
```

**Code Review:**
```text
# Review Tasks
Review codebase for performance issues
Implement optimization recommendations  
Add documentation for public APIs

# Priority: Security audit of API endpoints
```

---

## 🤝 Contributing

See [CONTRIBUTING.md](docs/CONTRIBUTING.md) for development setup, coding standards, and submission guidelines.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 📚 Documentation

- [Complete Protocol](docs/PROTOCOL.md)
- [Usage Examples](docs/EXAMPLES.md)  
- [Implementation Guide](docs/USAGE.md)
- [Contributing Guidelines](docs/CONTRIBUTING.md)
