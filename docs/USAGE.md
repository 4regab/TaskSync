
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

For full protocol details, see [`tasksync.md`](./tasksync.md).
For ready-to-use task templates and best practices, see [`docs/EXAMPLES.md`](./EXAMPLES.md).

---

# Legacy/Advanced Details

## 2. Task Assignment & Execution

- **Assign a task** by providing a clear objective (e.g., "Implement user authentication").
- The agent:
  - Focuses on the assigned task with full attention.
  - Tracks progress and provides periodic updates.
  - Ensures all requirements are met before marking the task complete.
  - **Task continuation priority**: Completes current tasks before processing new instructions (unless urgent override).
  - **PowerShell monitoring**: Checks tasks.txt word count every 180 seconds (180000ms) during active work.
  - **Status logging**: Writes monitoring status to separate log.txt file.

## 3. PowerShell Word Count Monitoring System

- **Efficient monitoring**: Uses `Get-Content [path]\tasks.txt | Measure-Object -Word` to detect changes
- **Change detection**: Only reads full file content when word count changes from baseline
- **Urgent override detection**: Keywords like "stop current task", "correction", "fix" interrupt current work
- **File locations**: 
  - **tasks.txt**: Contains only task instructions (user-editable)
  - **log.txt**: Contains monitoring history (agent-managed)

**Active Work (State 1)**: Every 180 seconds (180000ms), the agent checks word count and reads full file if changes detected.
**After Completion (State 2)**: **MANDATORY SLEEP COMMAND** - `Start-Sleep -Seconds 30; Get-Content [path]\tasks.txt | Measure-Object -Word` every 30 seconds (30000ms).
**Status Logging**: The agent **physically creates/updates** log.txt to add status entries in the format:

```text
=== TASKSYNC MONITORING LOG ===
Session: #1
Baseline word count: 47

--- MONITORING STATUS ---
Check #1: Word count: 47 words (baseline). Initial task received.
Check #2: Word count: 47 words (no change). Task in progress.
Check #3: Word count: 63 words (CHANGE DETECTED). Reading tasks.txt...
```

- **Count-Based Monitoring**: Each check increments from #1 indefinitely.
- **No Automatic Termination**: Agent operates in perpetual monitoring mode until manually stopped.
- **CRITICAL ENFORCEMENT**: Agent must use Start-Sleep command in State 2 before each check.

## 4. Task Continuation Priority System

- **Primary Rule**: Complete current task OR reach explicit stopping point before processing new instructions
- **Completion Criteria**: Task is ready for new instructions when:
  1. Current task fully completed to specification
  2. User provides explicit correction or redirection
  3. tasks.txt contains urgent override: "stop current task", "correction", or "fix"
- **Exception**: Urgent override commands take immediate priority

## 5. Instruction Integration

- **Upon detecting word count change in `.github/tasks.txt`**:
  - The agent reads the full file content FIRST
  - Parses for new tasks, corrections, or process changes
  - Identifies urgent override keywords
  - Highest priority is given to corrections and urgent tasks
  - Writes status to log.txt SECOND
  - Integrates instructions seamlessly (unless urgent override interrupts current work)

## 6. Communication Protocol

- **Internal State Reporting**: Each response begins with an internal state summary:

  ```text
  [INTERNAL: State - {Active/Monitoring}]
  [INTERNAL: Next check scheduled in {60-300s}]
  ```

- **PowerShell Command Execution**: The agent uses PowerShell commands for efficient monitoring:
  - State 1: `Get-Content .github\tasks.txt | Measure-Object -Word`
  - State 2: `Start-Sleep -Seconds 30; Get-Content .github\tasks.txt | Measure-Object -Word`
- **Complete File Reading**: Agent reads entire file content only when word count changes (minimum 1000 lines for comprehensive analysis).
- **User Transparency**: The agent informs you of significant changes or new instructions found in `.github/tasks.txt`.
- **Stealth Monitoring**: Routine word count checks do not interrupt your workflow unless changes detected.
- **Progress Updates**: For long tasks, the agent provides periodic status reports.
- **No Timeout Warnings**: Agent operates indefinitely - no automatic termination.

## 7. Log File Management Protocol

The agent follows this strict process for each monitoring check:

1. **Run PowerShell word count check**: `Get-Content .github\tasks.txt | Measure-Object -Word`
2. **Compare with baseline**: Only proceed if word count changed
3. **IF CHANGE: Read full tasks.txt content FIRST** (entire file from first to last line)
4. **Process new instructions immediately**
5. **Write status entry to log.txt SECOND** with incremental check number
6. **Save updated log.txt** with format:

   ```text
   === TASKSYNC MONITORING LOG ===
   Session: #1
   Baseline word count: 47

   Check #1: Word count: 47 words (baseline). Initial task received.
   Check #2: Word count: 47 words (no change). Task in progress.
   Check #3: Word count: 63 words (CHANGE DETECTED). Reading tasks.txt...
   ```

7. **Report to user**: "Updated log.txt with Check #[X] status - [Y] words"

**Log File Structure:**
- **Header**: Session information and task file reference
- **Monitoring Status**: Chronological list of all monitoring checks
- **Check Format**: `Check #[X]: - Read tasks.txt containing [Y] lines. [Status message]`
- **Incremental Counting**: Continuous counting from Check #1 indefinitely

## 7. Error Handling

- **File access errors**: Agent continues operation, retries on next interval, logs error in status
- **Parsing errors**: You are notified of `tasks.txt` formatting issues, logged in status  
- **Conflicting instructions**: Agent prioritizes most recent instructions, asks for clarification if needed
- **Timer failures**: Agent maintains manual awareness of monitoring intervals
- **File write errors**: Agent attempts to continue monitoring even if status logging fails
- **No automatic termination**: Agent never ends session automatically - only manual termination allowed

## 8. Manual Termination Protocol

- **Only Manual Termination**: User must explicitly say "stop", "end", "terminate", or "quit"
- **Infinite Operation**: Agent continues monitoring and file editing forever until stopped
- **No Timeout**: Agent never automatically terminates due to inactivity
- **Graceful Closure**: If user requests termination, agent provides final summary of completed work
- **Default Behavior**: Always continue monitoring - termination is the exception, not the rule

## 9. Success Criteria

- **Task completion**: Primary objectives met to specification
- **Monitoring reliability**: Consistent monitoring intervals maintained  
- **Complete file reading**: Read entire tasks.txt from first to last line (minimum 1000 lines)
- **Log file management**: All check statuses written to separate `log.txt` file with proper formatting
- **Line count verification**: Accurate counting and reporting of tasks.txt content lines
- **Instruction integration**: Seamless incorporation of `tasks.txt` guidance
- **User experience**: Smooth interaction without monitoring disruption
- **Infinite monitoring**: Continuous tasks.txt monitoring without automatic termination
- **Manual termination only**: Session ends only when user explicitly requests
- **Dual file separation**: Clean separation between task instructions and monitoring logs

## 10. Best Practices

- **Keep `tasks.txt` in your project root** for easy access and monitoring.
- **Write clear, actionable instructions** in `tasks.txt` for best results.
- **Use corrections and clarifications** in `tasks.txt` to steer the agent without restarting sessions.
- **Leverage infinite monitoring** for continuous, unattended task execution—ideal for long-running projects.
- **Monitor STATUS LOG entries** for transparency and debugging agent behavior.
- **Count-based monitoring**: Track agent activity through incrementing check numbers.
- **Complete file reading**: Ensure your tasks.txt has comprehensive instructions (agent reads minimum 1000 lines).
- **Manual termination only**: Remember agent never stops automatically - you control when to end.

## 11. Example Workflow

1. **Start the agent** in your IDE with TaskSync protocol.
2. **Assign a task**: "Refactor the login component for accessibility."
3. **Edit `tasks.txt`**: Add "Switch to OAuth2 for authentication."
4. The agent detects the new instruction, integrates it, and continues.
5. **Monitor STATUS LOG**: See "Check #15: - Read tasks.txt containing 8 lines. OAuth2 implementation in progress."
6. **Agent continues indefinitely** until you explicitly say "stop" or "terminate".

## 12. Advanced Usage

- **Automate `tasks.txt` updates** via scripts or CI/CD for complex workflows.
- **Chain tasks** by appending new objectives to `tasks.txt` as previous ones complete.
- **Integrate with team workflows**: Multiple users can update `tasks.txt` for collaborative task management.
- **Monitor agent activity**: Track progress through STATUS LOG check numbers and line counts.
- **Long-running projects**: Leverage infinite monitoring for projects spanning days or weeks.
- **Persistent operation**: Agent maintains context and continues work across extended periods.

## 13. Troubleshooting

- **Agent not responding?** Check `tasks.txt` formatting and file permissions. Look for STATUS LOG entries to verify monitoring activity.
- **Missed instructions?** Ensure the agent is running and monitoring intervals are not disrupted. Check increment in STATUS LOG check numbers.
- **No STATUS LOG updates?** Agent may have file write permissions issues. Verify tasks.txt is writable.
- **Agent stopped unexpectedly?** TaskSync agents don't automatically terminate - check for system/IDE issues.
- **Want to end session?** You must explicitly say "stop", "end", "terminate", or "quit" - agent runs forever otherwise.

### AI Model Early Termination

**Common Issue**: AI models tend to end conversations quickly after task completion, despite infinite monitoring protocol.

**Root Cause**: AI models have inherent tendency to conclude sessions when they perceive tasks as "complete."

**Prevention Strategies**:
- **Queue Tasks in Advance**: Add multiple tasks to `tasks.txt` before AI finishes current work
- **Continuous Task Flow**: Maintain a steady pipeline of work items
- **Proactive Monitoring**: Use STATUS LOG check numbers to detect if monitoring stops
- **Task Overlap**: Start new tasks while current ones are 80% complete

**Recovery Actions**:
```text
# If monitoring stops, immediately add to tasks.txt:
# URGENT: Resume monitoring and continue with pending tasks
# NEW PRIORITY: [Next task to work on]
# REMINDER: Maintain infinite monitoring per protocol

--- STATUS LOG ---
Check #1: - Read tasks.txt containing [X] lines. Monitoring resumed.
```

## 14. Template for `tasks.txt` with Status Logging

```text
# Example tasks.txt

Implement user registration with email verification.
# Correction: Use JWT for session management.
# New Task: Add password reset functionality.

--- STATUS LOG ---
Check #23: - Read tasks.txt containing 3 lines. Implementing password reset functionality.
```

## 15. Reference: Internal State Example

```text
[INTERNAL: Current state - Active]
[INTERNAL: Next check scheduled every 60 seconds to 5 minutes]
```

## 16. Summary

This protocol empowers you to maximize the value of premium coding IDEs by enabling autonomous, persistent file-driven task execution with:

- **Infinite monitoring** without automatic termination
- **Real-time status logging** directly in tasks.txt file  
- **Complete file reading** (minimum 1000 lines per operation)
- **Count-based monitoring** for transparency and debugging
- **Manual termination only** - you control when to stop
- **Robust error handling** with continuous operation
- **Seamless instruction integration** without losing context

**For best results, always keep `tasks.txt` up to date and remember: the agent runs forever until you explicitly terminate it.**
