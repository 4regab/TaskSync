# Usage Guide: Autonomous Agent with Task File Monitoring

## 1. Agent Initialization

- **Start the agent** in your IDE with this protocol.
- **Confirm understanding**: The agent should acknowledge the protocol and request your initial task.
- **Begin monitoring**: The agent immediately starts watching `tasks.txt` for new instructions.

## 2. Task Assignment & Execution

- **Assign a task** by providing a clear objective (e.g., "Implement user authentication").
- The agent:
  - Focuses on the assigned task with full attention.
  - Tracks progress and provides periodic updates.
  - Ensures all requirements are met before marking the task complete.

## 3. Continuous File Monitoring

- **Active Work**: Every 60 seconds, the agent reads the entire `tasks.txt` file.
- **After Completion**: The agent checks `tasks.txt` continuously, waiting for new instructions or corrections.
- **Timeout**: If no new instructions are found after 5 minutes, the session ends gracefully.

## 4. Instruction Integration

- **Upon detecting new content in `tasks.txt`**:
  - The agent parses the file for new tasks, corrections, or process changes.
  - Highest priority is given to corrections and new tasks.
  - The agent immediately integrates these into its workflow, even if mid-task.

## 5. Communication Protocol

- **Internal State Reporting**: Each response begins with an internal state summary:
  ```
  [INTERNAL: Current state - {Active/Monitoring/Terminating}]
  [INTERNAL: Last tasks.txt check - {timestamp}]
  [INTERNAL: Next check scheduled - {timestamp}]
  ```
- **User Transparency**: The agent informs you of significant changes or new instructions found in `tasks.txt`.
- **Stealth Monitoring**: Routine checks do not interrupt your workflow.
- **Progress Updates**: For long tasks, the agent provides periodic status reports.
- **Timeout Warnings**: You are alerted as the 5-minute timeout approaches.

## 6. Error Handling

- **File Access Issues**: The agent retries on the next interval.
- **Parsing Errors**: You are notified of any formatting issues in `tasks.txt`.
- **Conflicting Instructions**: The agent prioritizes the most recent instructions and requests clarification if needed.
- **Timer Failures**: The agent maintains manual awareness and continues monitoring.

## 7. Success Criteria

- All assigned tasks are completed to specification.
- Monitoring intervals are reliably maintained.
- New instructions from `tasks.txt` are seamlessly integrated.
- User experience is smooth and uninterrupted.
- Session ends gracefully after inactivity.

## 8. Best Practices

- **Keep `tasks.txt` in your project root** for easy access and monitoring.
- **Write clear, actionable instructions** in `tasks.txt` for best results.
- **Use corrections and clarifications** in `tasks.txt` to steer the agent without restarting sessions.
- **Leverage the agent for continuous, unattended task execution**—ideal for long-running or multi-step projects.
- **Monitor internal state reports** for transparency and debugging.

## 9. Example Workflow

1. **Start the agent** in your IDE.
2. **Assign a task**: "Refactor the login component for accessibility."
3. **Edit `tasks.txt`**: Add "Switch to OAuth2 for authentication."
4. The agent detects the new instruction, integrates it, and continues.
5. **After 5 minutes of inactivity**, the agent ends the session with a summary.

## 10. Advanced Usage

- **Automate `tasks.txt` updates** via scripts or CI/CD for complex workflows.
- **Chain tasks** by appending new objectives to `tasks.txt` as previous ones complete.
- **Integrate with team workflows**: Multiple users can update `tasks.txt` for collaborative task management.

## 11. Troubleshooting

- **Agent not responding?** Check `tasks.txt` formatting and file permissions.
- **Missed instructions?** Ensure the agent is running and monitoring intervals are not disrupted.
- **Session ended unexpectedly?** Re-initialize the agent and reassign the task.

## 12. Template for `tasks.txt`

```
# Example tasks.txt

Implement user registration with email verification.
# Correction: Use JWT for session management.
# New Task: Add password reset functionality.
```

## 13. Reference: Internal State Example

```
[INTERNAL: Current state - Active]
[INTERNAL: Last tasks.txt check - 2025-07-14T10:00:00Z]
[INTERNAL: Next check scheduled - 2025-07-14T10:01:00Z]
```

## 14. Summary

This protocol empowers you to maximize the value of premium coding IDEs by enabling autonomous, file-driven task execution with robust monitoring, seamless instruction integration, and transparent communication. Use it to automate, accelerate, and enhance your development workflow.

**For best results, always keep `tasks.txt` up to date and use clear, actionable language.**
