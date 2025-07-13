# TaskSync
This Instructions helps your AI work smarter and saves you 80-90% of premium requests. Just write tasks in a tasks.txt file, and AI will check it automatically every 60 seconds to 5 minutes. When you want to change something, edit the file - no need to start new chats or waste more requests.

## Why You Need This
- Every time you chat with AI, it costs money. Most people waste requests because:
- AI doesn't understand what you want
- You have to explain the same thing many times  
- AI forgets what you're building

## How TaskSync Helps
✅ **Write once, let AI work** - Put your tasks in `tasks.txt` and AI does everything  
✅ **AI checks for updates automatically** - Change your tasks.txt file anytime, AI will see it  
✅ **No more explaining** - AI remembers your whole project  
✅ **AI fixes itself** - When AI makes mistakes, it reads your notes and fixes them  
✅ **Works with any AI tool** - GitHub Copilot, Cursor, Windsurf, Trae IDE, and more  
✅ **Save 80-90% of your premium AI requests.** Instead of 50 messages, you might only need 5-10.

## How It Works
1. **Copy the prompt** to chat
2. **Add a tasks.txt file** 
3. **Write what you want** 
4. **Let AI work alone** - it checks for updates automatically
5. **Change tasks.txt anytime** to guide or fix the AI mistakes

**Start saving money today.** Get the better results with way fewer premium requests.

---

## �🚀 Quick Start

**Choose your IDE and copy-paste the installation commands:**

---

### 🎯 GitHub Copilot (VS Code)

```bash
git clone --filter=blob:none --sparse https://github.com/4regab/TaskSync.git
cd TaskSync
git sparse-checkout set .github
```

**Files created:** `.github/instructions/protocol.instructions.md` and `tasks.txt`

---

### 🎯 Cursor IDE

```bash
git clone --filter=blob:none --sparse https://github.com/4regab/TaskSync.git
cd TaskSync
git sparse-checkout set .cursor
```

**Files created:** `.cursor/rules/tasksync.mdc` and `tasks.txt`

### 🎯 Global (Any IDE)

```bash
git clone --filter=blob:none --sparse https://github.com/4regab/TaskSync.git
cd TaskSync
git sparse-checkout set .global
```
---

### 🔗 Alternative Installation Methods

<details>
<summary>Click to expand Git Submodule method</summary>

```bash
git submodule add https://github.com/4regab/TaskSync.git .tasksync

# Then copy files for your IDE:
# GitHub Copilot: cp -r .tasksync/.github .github ; cp .tasksync/.github/instructions/tasks.txt tasks.txt
# Cursor: cp -r .tasksync/.cursor/.cursor .cursor ; cp .tasksync/.cursor/tasks.txt tasks.txt
# Windsurf: cp .tasksync/.windsurf/.windsurfrules . ; cp .tasksync/.windsurf/tasks.txt .
# Trae: cp .tasksync/.trae/.traerules . ; cp .tasksync/.trae/tasks.txt .
# Universal: cp .tasksync/.global/global_rules.md . ; cp .tasksync/.global/tasks.txt .

git add . ; git commit -m "Add TaskSync protocol"
```

</details>

<details>
<summary>Click to expand Direct Git Integration method</summary>

```bash
git remote add tasksync https://github.com/4regab/TaskSync.git
git fetch tasksync main

# GitHub Copilot (VS Code):
git show tasksync/main:.github/instructions/protocol.instructions.md > .github/instructions/protocol.instructions.md
git show tasksync/main:.github/instructions/tasks.txt > tasks.txt

# Cursor IDE:
git show tasksync/main:.cursor/.cursor/rules/tasksync.mdc > .cursor/rules/tasksync.mdc
git show tasksync/main:.cursor/tasks.txt > tasks.txt

git add . ; git commit -m "Integrate TaskSync protocol"
```

</details>

---

### 🎯 IDE-Specific Documentation
- **[GitHub Copilot (VS Code)](.github/)** - `.github/instructions/` setup for maximum premium usage
- **[Cursor IDE](.cursor/)** - Modern `.cursor/rules/*.mdc` setup
- **[Windsurf IDE](.windsurf/)** - `.windsurfrules` setup  
- **[Trae IDE](.trae/)** - `.traerules` setup
- **[Universal](.global/)** - `global_rules.md` for any IDE

---

## 📁 Repository Structure

```
TaskSync/
├── .github/          # GitHub Copilot (VS Code) instructions 
├── .cursor/          # Cursor IDE (.cursor/rules/tasksync.mdc)
├── .windsurf/        # Windsurf IDE (.windsurfrules)  
├── .trae/            # Trae IDE (.traerules)
├── .global/          # Universal (global_rules.md)
└── docs/             # Documentation
```

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
- **Security First**: No hardcoded secrets, OWASP compliance

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

## 🔍 Verification

```bash
# Verify installation
ls -la .cursor/rules/tasksync.mdc .windsurfrules .traerules tasks.txt 2>/dev/null

# Check file headers
head -1 .cursor/rules/tasksync.mdc 2>/dev/null || echo "No Cursor rules found"

# Verify git integration
git log --oneline --grep="TaskSync" -n 3
```

---

## 🔄 Updates

```bash
# Update TaskSync rules (if using git remote method)
git fetch tasksync main
git show tasksync/main:.cursor/.cursor/rules/tasksync.mdc > .cursor/rules/tasksync.mdc
git add .cursor/rules/tasksync.mdc ; git commit -m "Update TaskSync rules"

# Update submodule
git submodule update --remote .tasksync
cp -r .tasksync/.cursor/.cursor .cursor
```

---

## 🆘 Troubleshooting

**AI not responding to tasks.txt changes?**
- Ensure file is saved properly
- Check AI is in Active/Monitoring state  
- Verify 60-second monitoring interval
- Try adding a timestamp comment

**Rule file not loading?**
- **Cursor**: Confirm `.cursor/rules/tasksync.mdc` exists with proper YAML frontmatter
- **Windsurf**: Check `.windsurfrules` is in project root
- **Trae**: Verify `.traerules` filename and location
- Restart IDE if needed

**Git issues?**
```bash
# Fix remote URL
git remote set-url tasksync https://github.com/4regab/TaskSync.git

# Reset submodule  
git submodule deinit .tasksync ; git submodule update --init
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
=======
# TaskSync
**Save money on your AI coding IDEs.** This simple prompt insutrctions helps your AI work better and use less premium requests.

## What This Does
TaskSync is just **prompt instructions** that make your AI smarter. Instead of typing lots of messages back and forth, you write what you want in a simple text file called `tasks.txt`. Your AI reads this file and does the work by itself.

## Why You Need This
**Premium AI tools are expensive.** Every time you chat with AI, it costs money. Most people waste requests because:
- AI doesn't understand what you want
- You have to explain the same thing many times  
- AI forgets what you're building
- You need to watch AI and fix its mistakes

## How TaskSync Helps
✅ **Write once, let AI work** - Put your ideas in `tasks.txt` and AI does everything  
✅ **AI checks for updates automatically** - Change your tasks.txt file anytime, AI will see it  
✅ **No more explaining** - AI remembers your whole project  
✅ **AI fixes itself** - When AI makes mistakes, it reads your notes and fixes them  
✅ **Works with any AI tool** - GitHub Copilot, Cursor, Windsurf, Trae IDE, and more  
✅ **Save 80-90% of your premium AI requests.** Instead of 50 messages, you might only need 5-10.

## How It Works
1. **Copy the prompt** to your AI tool
2. **Create a tasks.txt file** in your project
3. **Write what you want** in simple words
4. **Let AI work alone** - it checks for updates automatically
5. **Change tasks.txt anytime** to guide or fix the AI

## You Can Control How Often AI Checks

Don't want AI checking every 60 seconds? You can tell it to check every 2 minutes, 5 minutes, or whatever works for you.

## Perfect For

- Building websites and apps
- Long coding projects  
- When you're on a budget
- Anyone tired of wasting AI requests

**Start saving money today.** Get the better results with way fewer premium requests.

---

## �🚀 Quick Start

**Choose your IDE and copy-paste the installation commands:**

---

### 🎯 GitHub Copilot (VS Code)

```bash
git clone --filter=blob:none --sparse https://github.com/4regab/TaskSync.git
cd TaskSync
git sparse-checkout set .github
cp -r .github ../
cp .github/instructions/tasks.txt ../
cd ..
rm -rf TaskSync
```

**Files created:** `.github/instructions/protocol.instructions.md` and `tasks.txt`

---

### 🎯 Cursor IDE

```bash
git clone --filter=blob:none --sparse https://github.com/4regab/TaskSync.git
cd TaskSync
git sparse-checkout set .cursor
cp -r .cursor/.cursor ../
cp .cursor/tasks.txt ../
cd ..
rm -rf TaskSync
```

**Files created:** `.cursor/rules/tasksync.mdc` and `tasks.txt`

---

### 🎯 Windsurf IDE

```bash
git clone --filter=blob:none --sparse https://github.com/4regab/TaskSync.git
cd TaskSync
git sparse-checkout set .windsurf
cp .windsurf/.windsurfrules ../
cp .windsurf/tasks.txt ../
cd ..
rm -rf TaskSync
```

**Files created:** `.windsurfrules` and `tasks.txt`

---

### 🎯 Trae IDE

```bash
git clone --filter=blob:none --sparse https://github.com/4regab/TaskSync.git
cd TaskSync
git sparse-checkout set .trae
cp .trae/.traerules ../
cp .trae/tasks.txt ../
cd ..
rm -rf TaskSync
```

**Files created:** `.traerules` and `tasks.txt`

---

### 🎯 Universal (Any IDE)

```bash
git clone --filter=blob:none --sparse https://github.com/4regab/TaskSync.git
cd TaskSync
git sparse-checkout set .global
cp .global/global_rules.md ../
cp .global/tasks.txt ../
cd ..
rm -rf TaskSync
```

**Files created:** `global_rules.md` and `tasks.txt`

---

### 🔗 Alternative Installation Methods

<details>
<summary>Click to expand Git Submodule method</summary>

```bash
git submodule add https://github.com/4regab/TaskSync.git .tasksync

# Then copy files for your IDE:
# GitHub Copilot: cp -r .tasksync/.github .github ; cp .tasksync/.github/instructions/tasks.txt tasks.txt
# Cursor: cp -r .tasksync/.cursor/.cursor .cursor ; cp .tasksync/.cursor/tasks.txt tasks.txt
# Windsurf: cp .tasksync/.windsurf/.windsurfrules . ; cp .tasksync/.windsurf/tasks.txt .
# Trae: cp .tasksync/.trae/.traerules . ; cp .tasksync/.trae/tasks.txt .
# Universal: cp .tasksync/.global/global_rules.md . ; cp .tasksync/.global/tasks.txt .

git add . ; git commit -m "Add TaskSync protocol"
```

</details>

<details>
<summary>Click to expand Direct Git Integration method</summary>

```bash
git remote add tasksync https://github.com/4regab/TaskSync.git
git fetch tasksync main

# GitHub Copilot (VS Code):
git show tasksync/main:.github/instructions/protocol.instructions.md > .github/instructions/protocol.instructions.md
git show tasksync/main:.github/instructions/tasks.txt > tasks.txt

# Cursor IDE:
git show tasksync/main:.cursor/.cursor/rules/tasksync.mdc > .cursor/rules/tasksync.mdc
git show tasksync/main:.cursor/tasks.txt > tasks.txt

git add . ; git commit -m "Integrate TaskSync protocol"
```

</details>

---

### 🎯 IDE-Specific Documentation
- **[GitHub Copilot (VS Code)](.github/)** - `.github/instructions/` setup for maximum premium usage
- **[Cursor IDE](.cursor/)** - Modern `.cursor/rules/*.mdc` setup
- **[Windsurf IDE](.windsurf/)** - `.windsurfrules` setup  
- **[Trae IDE](.trae/)** - `.traerules` setup
- **[Universal](.global/)** - `global_rules.md` for any IDE

---

## 📁 Repository Structure

```
TaskSync/
├── .github/          # GitHub Copilot (VS Code) instructions 
├── .cursor/          # Cursor IDE (.cursor/rules/tasksync.mdc)
├── .windsurf/        # Windsurf IDE (.windsurfrules)  
├── .trae/            # Trae IDE (.traerules)
├── .global/          # Universal (global_rules.md)
└── docs/             # Documentation
```

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
- **Security First**: No hardcoded secrets, OWASP compliance

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

## 🔍 Verification

```bash
# Verify installation
ls -la .cursor/rules/tasksync.mdc .windsurfrules .traerules tasks.txt 2>/dev/null

# Check file headers
head -1 .cursor/rules/tasksync.mdc 2>/dev/null || echo "No Cursor rules found"

# Verify git integration
git log --oneline --grep="TaskSync" -n 3
```

---

## 🔄 Updates

```bash
# Update TaskSync rules (if using git remote method)
git fetch tasksync main
git show tasksync/main:.cursor/.cursor/rules/tasksync.mdc > .cursor/rules/tasksync.mdc
git add .cursor/rules/tasksync.mdc ; git commit -m "Update TaskSync rules"

# Update submodule
git submodule update --remote .tasksync
cp -r .tasksync/.cursor/.cursor .cursor
```

---

## 🆘 Troubleshooting

**AI not responding to tasks.txt changes?**
- Ensure file is saved properly
- Check AI is in Active/Monitoring state  
- Verify 60-second monitoring interval
- Try adding a timestamp comment

**Rule file not loading?**
- **Cursor**: Confirm `.cursor/rules/tasksync.mdc` exists with proper YAML frontmatter
- **Windsurf**: Check `.windsurfrules` is in project root
- **Trae**: Verify `.traerules` filename and location
- Restart IDE if needed

**Git issues?**
```bash
# Fix remote URL
git remote set-url tasksync https://github.com/4regab/TaskSync.git

# Reset submodule  
git submodule deinit .tasksync ; git submodule update --init
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
>>>>>>> de134b1b6cab3497d2f5e0ea5f2b0d11db76b88e
