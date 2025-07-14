# Changelog

All notable changes to this project will be documented in this file.

## [2.0.0] - 2025-07-14

### Major Protocol Enhancements
- **Infinite Monitoring**: Agents now operate continuously without automatic termination
- **Status Logging**: Mandatory physical file editing with count-based monitoring system
- **Complete File Reading**: Minimum 1000 lines per read operation for comprehensive analysis
- **Count-Based Monitoring**: Systematic check counting from #1 incrementing indefinitely
- **Enhanced Error Handling**: Robust error recovery with continuous operation
- **Manual Termination Only**: Users must explicitly request session termination

### New Features
- Real-time status logging directly in tasks.txt file
- Active execution protocols with file read/write operations every 30 seconds
- Line count verification for original content (excluding status logs)
- STATUS LOG section management with clean format maintenance
- Enhanced file status update protocol with preservation of original content

### Protocol Changes
- Removed 5-minute timeout limitation
- Added mandatory file editing requirements
- Implemented AI-driven counting protocol
- Enhanced monitoring schedules (60s-5min active, 30s completion monitoring)
- Added explicit termination keywords requirement

### Documentation Updates
- Complete rewrite of USAGE.md with new protocol specifications
- Enhanced EXAMPLES.md with status logging examples
- Updated README.md to reflect infinite monitoring capabilities
- Added troubleshooting section for new protocol features

### Known Issues Added
- Documented AI model early termination behavior in README.md
- Added prevention strategies for maintaining continuous operation
- Enhanced troubleshooting guide with proactive task management techniques
- Provided recovery actions for session interruption scenarios

### Breaking Changes
- Sessions no longer automatically terminate after inactivity
- Status logging is now mandatory - agents must edit tasks.txt file
- Minimum file reading requirement of 1000 lines per operation
- Changed from timestamp-based to count-based monitoring

## [1.0.0] - 2025-07-14

### Initial Release
- First public release
- Complete documentation for agent protocol and usage
- Ready for integration with coding IDEs (Global, Cursor, Copilot)
- Basic file monitoring and task execution capabilities
