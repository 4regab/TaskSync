# Usage Guide: Autonomous Agent with Persistent Task File Monitoring

## 1. Agent Initialization

- **Start the agent** in your IDE with the TaskSync protocol.
- **Confirm understanding**: The agent should acknowledge the protocol and request your initial task.
- **Begin infinite monitoring**: The agent immediately starts watching `tasks.txt` and never terminates automatically.

## 2. Task Assignment & Execution

- **Assign a task** by providing a clear objective (e.g., "Implement user authentication").
- The agent:
  - Focuses on the assigned task with full attention.
  - Tracks progress and provides periodic updates.
  - Ensures all requirements are met before marking the task complete.
  - **Continuously monitors**: Checks `tasks.txt` every 60 seconds during active work.

## 3. Continuous File Monitoring with Status Logging

- **Active Work**: Every 60 seconds to 5 minutes, the agent reads the entire `tasks.txt` file (minimum 1000 lines).
- **After Completion**: The agent checks `tasks.txt` continuously every 30 seconds, waiting indefinitely for new instructions.
- **Status Logging**: The agent **physically edits** `tasks.txt` to add status entries in the format:
  ```
  --- STATUS LOG ---
  Check #[X]: - Read tasks.txt containing [Y] lines. [Status message]
  ```
- **Count-Based Monitoring**: Each check increments from #1 indefinitely.
- **No Automatic Termination**: Agent operates in perpetual monitoring mode until manually stopped.

## 4. Instruction Integration

- **Upon detecting new content in `tasks.txt`**:
  - The agent parses the file for new tasks, corrections, or process changes.
  - Highest priority is given to corrections and new tasks.
  - The agent immediately integrates these into its workflow, even if mid-task.

## 5. Communication Protocol

- **Internal State Reporting**: Each response begins with an internal state summary:

  ```text
  [INTERNAL: Current state - {Active/Monitoring}]
  [INTERNAL: Next check scheduled every 60 seconds to 5 minutes]
  ```

- **File Status Logging**: The agent writes all check statuses directly into `tasks.txt` file in STATUS LOG section.
- **Complete File Confirmation**: Agent demonstrates full file reading by processing entire content (minimum 1000 lines).
- **User Transparency**: The agent informs you of significant changes or new instructions found in `tasks.txt`.
- **Stealth Monitoring**: Routine checks do not interrupt your workflow unless new instructions found.
- **Progress Updates**: For long tasks, the agent provides periodic status reports.
- **No Timeout Warnings**: Agent operates indefinitely - no automatic termination.

## 6. File Status Update Protocol

The agent follows this strict process for each monitoring check:

1. **Read entire tasks.txt file** from first to last line
2. **Extract original content** (everything before "--- STATUS LOG ---")
3. **Count lines of original content** only (excluding status logs)  
4. **Remove existing STATUS LOG** section completely
5. **Create new STATUS LOG** section with only current check entry
6. **Save updated file** with format:

   ```text
   [Original task instructions and content above]

   --- STATUS LOG ---
   Check #[X]: - Read tasks.txt containing [Y] lines. [Status message]
   ```

7. **Report to user**: "Updated tasks.txt containing [Y] lines with Check #[X] status"

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
- **Status logging**: All check statuses written directly into tasks.txt file
- **Line count verification**: Accurate counting and reporting of tasks.txt original content lines
- **Instruction integration**: Seamless incorporation of `tasks.txt` guidance
- **User experience**: Smooth interaction without monitoring disruption
- **Infinite monitoring**: Continuous tasks.txt monitoring without automatic termination
- **Manual termination only**: Session ends only when user explicitly requests

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
