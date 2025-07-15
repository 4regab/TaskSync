
# TaskSync Quick Start & Usage

## How to Use TaskSync in Your Chat Workflow

1. **Add TaskSync Protocol as Context**
   - Drag only the TaskSync instructions file (e.g., `tasksync.md`) into your chat as context. This gives your AI assistant access to the TaskSync rules it must follow.

2. **Strictly Follow the Protocol**
   - Instruct your AI: `Strictly follow tasksync.md`.
   - This ensures the agent operates with infinite monitoring, proper logging, and task continuation priority.

3. **Add Your Tasks**
   - Open or create `tasks.txt` (in `.github/`, `.cursor/rules/`, or `.global/` depending on your IDE.
   - Write your tasks, corrections, or urgent overrides in plain text. See `EXAMPLES.md` for templates and best practices.

4. **Start TaskSync**
   - After adding your tasks, send a message in chat: `Strictly follow tasksync.md, add tasks in tasks.txt and then send.`
   - TaskSync will now begin executing your tasks, monitoring for changes, and logging all activity.

5. **Add New Instructions Anytime**
   - You can add new tasks or corrections to `tasks.txt` at any time—before or after the current task is done.
   - TaskSync will always finish the current task (unless you use an urgent override), then process new instructions automatically.
   - This saves you from sending repeated requests—just update `tasks.txt` and TaskSync will handle the rest.

6. **Session Never Ends Automatically**
   - TaskSync will continue monitoring and executing tasks indefinitely until you explicitly say `stop`, `end`, `terminate`, or `quit`.

---

## Example Workflow

1. Drag only the TaskSync instructions file (e.g., `tasksync.md`) into your chat as context.
2. Instruct: `Strictly follow tasksync.md, add tasks in tasks.txt and then send.`
3. Add your tasks to `tasks.txt`.
4. TaskSync starts, logs progress, and lets you add new instructions at any time.

---

For full protocol details, see [`docs/PROTOCOL.md`](./PROTOCOl.md).
For ready-to-use task templates and best practices, see [`docs/EXAMPLES.md`](./EXAMPLES.md).

---
This protocol empowers you to maximize the value of premium coding IDEs by enabling autonomous, persistent file-driven task execution with:

- **Infinite monitoring** without automatic termination
- **Real-time status logging** directly in tasks.txt file  
- **Complete file reading** (minimum 1000 lines per operation)
- **Count-based monitoring** for transparency and debugging
- **Manual termination only** - you control when to stop
- **Robust error handling** with continuous operation
- **Seamless instruction integration** without losing context

**For best results, always keep `tasks.txt` up to date.**
