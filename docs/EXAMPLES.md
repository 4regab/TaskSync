# TaskSync Examples & Workflows

Complete examples showing how to use TaskSync effectively with your AI coding assistant.

## 🚀 Example 1: Web Application Development

### Initial Task Assignment
Start by creating or editing your `tasks.txt` file:

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

### Real-Time Corrections
As the AI works, you can provide corrections without stopping:

```text
# CORRECTION: Use TypeScript instead of JavaScript
# CORRECTION: Add input validation for all forms
# CORRECTION: Use bcrypt for password hashing
```

### Adding New Requirements
Append new tasks as the project evolves:

```text
# NEW TASK: Add OAuth2 login (Google, GitHub)
# NEW TASK: Implement role-based access control
# NEW TASK: Add unit tests with Jest
```

### The AI Will Automatically:
- ✅ Read your updates every 60 seconds
- ✅ Integrate new requirements seamlessly  
- ✅ Apply corrections without losing context
- ✅ Report progress and ask for clarification if needed

---

## 🔄 Example 2: API Development Workflow

### Project Setup
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

### Iterative Development
```text
# PHASE 1 COMPLETE - Moving to Phase 2
# NEW TASK: Add inventory management
# NEW TASK: Implement search and filtering
# PRIORITY: Fix the authentication middleware bug
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

## 🔍 Understanding AI Internal States

Your AI assistant reports its internal state with each response:

```text
[INTERNAL: Current state - Active]
[INTERNAL: Last tasks.txt check - 2025-07-14T10:00:00Z]
[INTERNAL: Next check scheduled - 2025-07-14T10:01:00Z]
```

### State Meanings

- **Active**: AI is working on tasks and monitoring for updates
- **Monitoring**: AI completed current tasks, waiting for new instructions
- **Terminating**: Session ending due to inactivity (5-minute timeout)

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
- AI not properly monitoring
- File encoding problems
- Tasks.txt not in correct location

**Solutions:**
```text
# Add this to your tasks.txt to test monitoring:
# TEST: If you can read this, monitoring is working
# Current time: [your current time]
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

### Session Ending Unexpectedly

**Check For:**
- 5-minute timeout reached
- AI waiting for clarification
- Error in tasks.txt formatting
- IDE connection issues

**Quick Fix:**
```text
# Add to tasks.txt to restart monitoring:
# RESTART: Continue working on current tasks
# STATUS: Please report current progress
```
Remember: TaskSync works best when you provide clear, detailed instructions and maintain regular communication through your tasks.txt file!
