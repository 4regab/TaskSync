# Contributing to TaskSync

Thank you for your interest in contributing to TaskSync! This guide will help you get started with development, coding standards, and submission guidelines for the autonomous agent protocol.

---

## 🚀 Quick Start for Contributors

### Development Setup

1. **Fork and clone the repository:**

   ```bash
   git clone https://github.com/your-username/TaskSync.git
   cd TaskSync
   ```

2. **Create a development branch:**

   ```bash
   git checkout -b feature/your-contribution
   ```

3. **Test the protocol:**

   - Copy the PROTOCOL.md instructions to your AI assistant
   - Create a test `tasks.txt` file
   - Verify infinite monitoring and status logging functionality

### Project Structure

```text
TaskSync/
├── .cursor/          # Cursor IDE implementation files
├── .github/          # GitHub Copilot implementation files  
├── .global/          # Universal implementation files
├── docs/             # Complete protocol documentation
│   ├── PROTOCOL.md   # Core protocol specification
│   ├── USAGE.md      # Implementation guide
│   ├── EXAMPLES.md   # Workflow examples
│   └── CHANGELOG.md  # Version history
├── LICENSE           # MIT License
└── README.md         # Project overview
```

---

## 🔧 Development Guidelines

### Protocol Standards

- **Infinite Monitoring**: All implementations must support continuous operation without automatic termination
- **Dual File System**: Mandatory separation between `tasks.txt` (instructions) and `log.txt` (monitoring)
- **Log File Management**: Automatic creation and maintenance of separate `log.txt` file
- **Complete File Reading**: Minimum 1000 lines per read operation
- **Error Handling**: Robust error recovery with continuous operation
- **Manual Termination**: Only explicit user termination commands allowed

### Documentation Requirements

- **Protocol Compliance**: All changes must align with PROTOCOL.md specifications
- **Example Updates**: Include working examples with dual file system in EXAMPLES.md
- **Usage Documentation**: Update USAGE.md for new features and log file management
- **Changelog Entries**: Document all changes with version numbers

---

## 🔄 Contribution Workflow

### 1. Issue Creation

- **Bug Reports**: Include protocol version and reproduction steps
- **Feature Requests**: Explain compatibility with infinite monitoring
- **Documentation**: Specify which files need updates

### 2. Development Process

- **Protocol First**: Ensure changes align with PROTOCOL.md
- **Documentation Updates**: Update all related documentation files
- **Testing**: Verify functionality with actual AI assistants
- **Status Logging**: Test the count-based monitoring system

### 3. Pull Request Guidelines

#### Required Information

- **Description**: Clear explanation of changes
- **Protocol Impact**: How changes affect core protocol behavior
- **Testing Results**: Evidence of successful protocol testing
- **Documentation**: List of updated documentation files


### 4. Review Process

- **Protocol Compliance Review**: Verification against PROTOCOL.md
- **Documentation Review**: Accuracy and completeness check
- **Testing Verification**: Confirmation of working examples with dual file system

---

## 🧪 Testing Guidelines

### Core Protocol Testing

1. **Initialize agent** with TaskSync protocol
2. **Assign test task** and verify execution
3. **Monitor status logging** in tasks.txt file
4. **Test infinite monitoring** (wait 10+ minutes)
5. **Verify manual termination** works correctly
6. **Check file reading completeness** (1000+ lines)

### Cross-Platform Testing

Test with multiple AI assistants:

- GitHub Copilot (VS Code)
- Cursor IDE
- Windsurf
- Other compatible IDEs

### Edge Case Testing

- File permission errors
- Large tasks.txt files (>1000 lines)
- Rapid task updates
- Network interruptions
- IDE restarts during monitoring

---

## 📚 Documentation Guidelines

### Protocol Documentation

- **Accuracy**: All documentation must reflect current PROTOCOL.md
- **Completeness**: Cover all protocol features and behaviors
- **Examples**: Include working code samples with status logs
- **Clarity**: Use clear, actionable language

---

## 🐛 Bug Reports

### Required Information

1. **Protocol Version**: TaskSync version being used
2. **AI Assistant**: Which coding IDE/assistant (Copilot, Cursor, etc.)
3. **Operating System**: Windows, macOS, Linux
4. **Reproduction Steps**: Exact steps to reproduce the issue
5. **Expected Behavior**: What should happen according to protocol
6. **Actual Behavior**: What actually happened
7. **Status Logs**: Include relevant STATUS LOG entries from tasks.txt
8. **Check Counts**: Report last check number if monitoring failed

---

## 🌟 Feature Requests

### Enhancement Guidelines

- **Protocol Compatibility**: Must work with infinite monitoring
- **Backward Compatibility**: Avoid breaking existing implementations
- **Documentation Impact**: Consider documentation update requirements
- **Cross-Platform**: Should work across all supported IDEs

### Request Template

1. **Feature Description**: Clear explanation of proposed feature
2. **Use Case**: Real-world scenario where feature is needed
3. **Protocol Integration**: How it fits with current protocol
4. **Implementation Ideas**: Suggested approach or solution
5. **Documentation Changes**: Which docs need updates

---

## 📄 License

By contributing to TaskSync, you agree that your contributions will be licensed under the MIT License.

---

## 🤝 Community Guidelines

- **Respectful Communication**: Be kind and professional
- **Collaborative Spirit**: Help others understand the protocol
- **Quality Focus**: Prioritize protocol reliability and accuracy
- **Documentation First**: Always update docs with code changes

Thank you for helping make TaskSync better! 🚀
