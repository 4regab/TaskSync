# TaskSync Examples & Workflows

Complete examples showing how to use TaskSync effectively with your AI coding assistant, featuring PowerShell word count monitoring, task continuation priority system, and the new infinite monitoring protocol.

## 🚀 Example 1: Web Application Development with Word Count Monitoring

### Initial Task Assignment
Start by creating or editing your `.github/tasks.txt` file:

```text
# Project: User Management System
Create a modern web application with:
1. User registration with email verification
2. Login/logout functionality  
3. Password reset feature
4. User profile management
5. Responsive design with modern UI

Tech stack: React, Node.js, MongoDB
```


### PowerShell Word Count Monitoring System (Updated Protocol)
The AI automatically creates and maintains `.github/log.txt` using efficient word count detection and the new infinite monitoring protocol:


```text
=== TASKSYNC MONITORING LOG ===
Session: #1
Baseline word count: 47

--- MONITORING STATUS ---
Check #1: Word count: 47 words (baseline). Initial task received.
Check #2: Word count: 47 words (no change). Task in progress.
Check #3: Word count: 63 words (CHANGE DETECTED). Reading tasks.txt...
Check #4: Word count: 63 words (no change). Implementing changes.
```

**Key Protocol Updates:**
- The agent never ends the session automatically. It continues monitoring and logging indefinitely until you explicitly say "stop", "end", "terminate", or "quit".
- In State 2 (monitoring mode), the agent always executes `Start-Sleep -Seconds 30` before each check, then logs the result, and repeats forever.
- All log entries are written to `log.txt` with incremental check numbers. Each new session increments the session number.
- The agent only reads `tasks.txt` when the word count changes, for efficiency.


### Real-Time Corrections with Task Continuation Priority (Updated)
As the AI works, you can provide corrections by editing `.github/tasks.txt`. The AI will complete its current task before processing new instructions, unless you use urgent override keywords (e.g., "STOP CURRENT TASK"). Corrections are always treated as highest priority after the current task completes.

```text
# CORRECTION: Use TypeScript instead of JavaScript
# CORRECTION: Add input validation for all forms
# CORRECTION: Use bcrypt for password hashing
```


### The log.txt file detects the change:

```text
Check #7: Word count: 63 words (CHANGE DETECTED). Reading tasks.txt...
Check #8: Word count: 63 words (no change). Applying TypeScript conversion and security improvements.
```


### Urgent Override for Immediate Changes
Use urgent override keywords (e.g., "STOP CURRENT TASK") to interrupt current work immediately. The agent will process the urgent instruction as soon as it detects the change in `tasks.txt`.

```text
STOP CURRENT TASK - Fix the authentication bug in login.tsx immediately
```


### Adding New Requirements During Development
Append new tasks as the project evolves by editing `.github/tasks.txt`. The agent will detect the word count change, read the new instructions, and log the update. It will always finish the current task before starting new ones, unless an urgent override is present.

```text
# NEW TASK: Add OAuth2 login (Google, GitHub)
# NEW TASK: Implement role-based access control
# NEW TASK: Add unit tests with Jest
```


### The AI Will Automatically (per Updated Protocol):
- ✅ Use PowerShell `Get-Content .github\tasks.txt | Measure-Object -Word` for efficient monitoring (every 180s in State 1, every 30s with `Start-Sleep` in State 2)
- ✅ Read full file content only when word count changes
- ✅ Complete current tasks before processing new instructions (unless urgent override)
- ✅ Integrate new requirements seamlessly
- ✅ Apply corrections without losing context
- ✅ Log status updates in separate `.github/log.txt` file with check counting
- ✅ **Continue indefinitely** until you manually terminate (never ends session automatically)
- ✅ Always execute `Start-Sleep -Seconds 30` before each monitoring check in State 2
- ✅ Report progress and ask for clarification if needed

---

## 🔄 Example 2: API Development Workflow with Task Priority System

### Project Setup

Edit your `.github/tasks.txt` file:

```text
# Project: E-commerce API
Build a RESTful API with:
- Product catalog management
- Shopping cart functionality
- Order processing
- Payment integration (Stripe)
- Admin dashboard

Requirements:
- OpenAPI/Swagger documentation
- Input validation and sanitization
- JWT authentication
- Rate limiting
- Comprehensive error handling
- Unit and integration tests
```


### Corresponding .github/log.txt monitoring (per Updated Protocol):

```text
=== TASKSYNC MONITORING LOG ===
Session: #1
Baseline word count: 82

--- MONITORING STATUS ---
Check #1: Word count: 82 words (baseline). API project initialization started.
Check #2: Word count: 82 words (no change). Express.js setup complete.
Check #3: Word count: 82 words (no change). JWT authentication middleware complete.
```

### Iterative Development with Continuous Operation

Update `tasks.txt` for new phases:

```text
# PHASE 1 COMPLETE - Moving to Phase 2
# NEW TASK: Add inventory management
# NEW TASK: Implement search and filtering
# PRIORITY: Fix the authentication middleware bug
```


### Log continues tracking automatically:

```text
Check #28: Word count: 102 words (no change). Inventory management API endpoints 60% complete.
Check #29: Word count: 102 words (no change). Authentication bug fix applied.
Check #30: Word count: 102 words (no change). Search functionality implementation started.
```

---

## 📱 Example 3: Mobile App Development

```text
# Project: Task Management Mobile App
Create a cross-platform mobile application:

Core Features:
- Task creation and management
- Project organization
- Team collaboration
- File attachments
- Offline functionality
- Push notifications

Tech Stack: React Native, Firebase
Design: Material Design 3
Platform: iOS and Android

Sprint 1 Focus:
- Basic CRUD operations
- User authentication
- Local storage
```

---

## 🎯 Example 4: Bug Fixing Session

```text
# BUG REPORT: User login not working
Steps to reproduce:
1. Enter valid email/password
2. Click login button
3. Page refreshes but user not logged in

Debug checklist:
- Check JWT token generation
- Verify database connection
- Test password hashing
- Review session management
- Check browser network tab
- Test with different browsers

PRIORITY: High - blocking production release
```

---

## 💡 Example 5: Code Refactoring Project

```text
# REFACTORING: Legacy codebase modernization
Current issues:
- Mixed JavaScript/TypeScript files
- No type safety
- Inconsistent coding styles
- Missing error handling
- No automated tests

Refactoring goals:
1. Convert all .js files to TypeScript
2. Add comprehensive type definitions
3. Implement ESLint + Prettier
4. Add unit tests (target 80% coverage)
5. Update documentation
6. Remove deprecated dependencies

Timeline: 2 weeks
Priority: Medium (technical debt)
```

---

## 🔍 Understanding AI Internal States and Dual File System


Your AI assistant reports its internal state with each response and maintains separate log file tracking. Example:

```text
[INTERNAL: State - Active]
[INTERNAL: Next check scheduled in 180s (180000ms)]
```


### State Meanings (per Protocol)

- **Active**: AI is working on tasks and monitoring for updates every 180 seconds (no Start-Sleep)
- **Monitoring**: AI completed current tasks, enters monitoring mode, and checks every 30 seconds with `Start-Sleep -Seconds 30` before each check. Never ends session automatically.

### Dual File System Format


**tasks.txt** (clean, user-editable):
```text
# Current Priority
Fix the authentication bug in login.tsx
Add TypeScript types for user profile

# New Feature Request  
Create a dashboard component with charts
```

**log.txt** (agent-managed monitoring):
```text
=== TASKSYNC MONITORING LOG ===
Session: #1
Baseline word count: 27

--- MONITORING STATUS ---
Check #1: Word count: 27 words (baseline). Initial task received.
Check #2: Word count: 27 words (no change). Task in progress.
Check #3: Word count: 35 words (CHANGE DETECTED). Reading tasks.txt...
Check #4: Word count: 35 words (no change). Implementing changes.
```


### Status Log Examples (per Updated Protocol)

```text
=== TASKSYNC MONITORING LOG ===
Session: #1
Baseline word count: 7

--- MONITORING STATUS ---
Check #1: Word count: 7 words (baseline). No new instructions found.
Check #2: Word count: 7 words (no change). No new instructions found.
Check #3: Word count: 12 words (CHANGE DETECTED). NEW INSTRUCTIONS FOUND!
Check #15: Word count: 14 words (no change). Authentication system 90% complete.
Check #42: Word count: 18 words (no change). All tasks completed, monitoring for new instructions.
```


### Key Features (per Updated Protocol)

- **Count-Based Monitoring**: Each check increments from #1 indefinitely
- **Word Count Verification**: Reports exact word count of tasks.txt content (not just line count)
- **Separate File System**: tasks.txt stays clean, log.txt contains all monitoring history
- **Real-Time Updates**: Status written to log.txt with each check
- **Infinite Operation**: AI continues monitoring until manually terminated (never ends session automatically)
- **No Automatic Termination**: You must explicitly say "stop", "end", "terminate", or "quit" to end the session
- **Mandatory Sleep in State 2**: Always executes `Start-Sleep -Seconds 30` before each monitoring check in State 2

---

## 📝 tasks.txt Best Practices

### ✅ Good Examples

```text
# Clear, actionable tasks
Create user registration form with:
- Email validation
- Password strength requirements
- Confirm password field
- Terms of service checkbox

# Specific technical requirements
Use React Hook Form for validation
Style with Tailwind CSS
Add loading states and error messages
```

### ❌ Avoid These

```text
# Too vague
Make the app better

# No context
Fix the bug

# Missing requirements
Add authentication
```

### 🎯 Pro Tips

1. **Be Specific**: Include tech stack, requirements, and constraints
2. **Use Comments**: Organize tasks with `#` comments for clarity
3. **Set Priorities**: Use keywords like `URGENT`, `HIGH PRIORITY`, `LATER`
4. **Include Context**: Explain the why, not just the what
5. **Break Down Large Tasks**: Split complex features into smaller steps

---

## 📋 Ready-to-Use Templates

### Frontend Project Template
```text
# Project: [Project Name]
# Framework: [React/Vue/Angular/etc.]
# Styling: [Tailwind/Styled Components/CSS Modules]

Phase 1 - Setup:
- Initialize project with proper folder structure
- Set up linting (ESLint, Prettier)
- Configure build tools and bundler
- Add basic routing

Phase 2 - Core Features:
- Implement main layout and navigation
- Create reusable UI components
- Add state management
- Implement data fetching

Phase 3 - Polish:
- Add loading states and error handling
- Implement responsive design
- Add animations and transitions
- Optimize performance
```

### Backend API Template
```text
# Project: [API Name]
# Framework: [Express/FastAPI/Django/etc.]
# Database: [MongoDB/PostgreSQL/MySQL]

Foundation:
- Set up project structure
- Configure environment variables
- Add authentication middleware
- Set up database connection
- Add input validation

Core Features:
- Implement CRUD operations
- Add API documentation (Swagger/OpenAPI)
- Set up error handling
- Add logging
- Implement rate limiting

Security & Testing:
- Add security headers
- Implement CORS properly
- Write unit tests
- Add integration tests
- Set up CI/CD pipeline
```

---

## 🆘 Troubleshooting Common Issues

### AI Not Responding to tasks.txt Changes

**Possible Causes:**

- File permissions issue
- AI monitoring disrupted 
- File encoding problems
- Tasks.txt not in correct location

**Solutions:**

```text
# Add this to your tasks.txt to test monitoring:
# TEST: If you can read this, monitoring is working
# Current time: [your current time]

# Check STATUS LOG for monitoring activity:
--- STATUS LOG ---
Check #[X]: - Read tasks.txt containing [Y] lines. [Status message]
```

### AI Misunderstanding Instructions

**Improve Your Instructions:**

```text
# Instead of: "Add validation"
# Use this: "Add form validation with these rules:
- Email must be valid format
- Password minimum 8 characters
- Phone number must be 10 digits
- All fields required before submission"
```

### Wanting to End Session

**Remember - No Automatic Termination:**

- AI operates indefinitely until manually stopped
- Check STATUS LOG for ongoing monitoring activity
- Monitor incrementing check numbers to verify operation


**To Stop the AI:**

```text
# Add to tasks.txt or say directly:
# TERMINATE: Stop monitoring and end session
# Or say: "stop", "end", "terminate", or "quit"
```

### Monitoring Issues

**Check For:**

- STATUS LOG entries not incrementing
- File write permission errors
- Missing check count progression
- AI not reading complete file content

**Quick Fix:**

```text
# Add to tasks.txt to restart monitoring:
# RESTART: Continue working on current tasks
# STATUS: Please report current progress
# VERIFY: Read this entire file and log status

--- STATUS LOG ---
Check #1: - Read tasks.txt containing [X] lines. Monitoring restarted.
```


Remember: TaskSync agents operate with infinite monitoring - they never automatically terminate and continue working until you explicitly stop them!
Remember: TaskSync works best when you provide clear, detailed instructions and maintain regular communication through your tasks.txt file!

---

## 🆕 Protocol v2.0: Infinite Monitoring and Logging Example

Below is a new example showing the updated protocol in action:

```text
[INTERNAL: State - Monitoring]
[INTERNAL: Next check scheduled in 30s (30000ms)]

=== TASKSYNC MONITORING LOG ===
Session: #2
Baseline word count: 35

--- MONITORING STATUS ---
Check #1: Word count: 35 words (baseline). New session started - no conversation history found.
Check #2: Word count: 35 words (no change). Task in progress.
Check #3: Word count: 47 words (CHANGE DETECTED). Reading tasks.txt...
Check #4: Word count: 47 words (no change). Task complete - monitoring mode.
Check #5: Word count: 47 words (no change). No file read needed.
Check #6: Word count: 63 words (CHANGE DETECTED). Reading tasks.txt...
```
